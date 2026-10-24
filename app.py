#!/usr/bin/env python3
"""
SegAUD — PC Desktop Application & Local Backend Server
Provides local Python execution for Silero VAD, SraVaani-1.0 ASR, and audio serving.
"""

import email
import io
import json
import mimetypes
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# Ensure UTF-8 stdout on Windows console safely without closing streams
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Ensure local project modules can be imported
ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR))

import asr
import vad
from main import process_audio

PORT = 8080
DOCS_DIR = ROOT_DIR / "docs"
SEGMENTS_DIR = ROOT_DIR / "segments"
SEGMENTS_DIR.mkdir(parents=True, exist_ok=True)

# Thread-safe pipeline progress tracking
PIPELINE_STATUS = {
    "running": False,
    "phase": "idle",
    "current": 0,
    "total": 0,
    "message": "",
    "percent": 0,
    "start_time": 0.0,
    "elapsed_s": 0.0
}
_status_lock = threading.Lock()


def update_pipeline_progress(phase, current, total, message, percent):
    """Callback passed to main.process_audio to update live pipeline status."""
    with _status_lock:
        now = time.time()
        start = PIPELINE_STATUS.get("start_time") or now
        elapsed = round(now - start, 1)
        PIPELINE_STATUS.update({
            "running": phase != "done",
            "phase": phase,
            "current": current,
            "total": total,
            "message": message,
            "percent": percent,
            "elapsed_s": elapsed
        })


def parse_multipart_data(rfile, headers):
    """Parse multipart/form-data using Python 3.13 standard email parser."""
    ctype = headers.get("Content-Type", "")
    length = int(headers.get("Content-Length", 0))
    body = rfile.read(length)

    msg = email.message_from_bytes(b"Content-Type: " + ctype.encode("utf-8") + b"\r\n\r\n" + body)
    fields = {}
    files = {}

    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        disp = part.get("Content-Disposition", "")
        name = None
        filename = None
        for item in disp.split(";"):
            item = item.strip()
            if item.startswith("name="):
                name = item[5:].strip('"\'')
            elif item.startswith("filename="):
                filename = item[9:].strip('"\'')

        payload = part.get_payload(decode=True)
        if filename and payload is not None:
            files[name] = {"filename": filename, "data": payload}
        elif name and payload is not None:
            fields[name] = payload.decode(part.get_content_charset() or "utf-8", errors="replace")

    return fields, files


class SegAudRequestHandler(SimpleHTTPRequestHandler):
    """Custom request handler serving static UI and SegAUD API endpoints."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DOCS_DIR), **kwargs)

    def end_headers(self):
        # Enable CORS for local dev flexibility
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # 1. API Status
        if path == "/api/status":
            info = asr.get_active_model_info()
            info["status"] = "ok"
            info["engine"] = "Python Native Backend"
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(info).encode("utf-8"))
            return

        # 1b. Live Pipeline Progress Polling Endpoint
        if path == "/api/pipeline_progress":
            with _status_lock:
                status_copy = dict(PIPELINE_STATUS)
                if status_copy.get("running") and status_copy.get("start_time"):
                    status_copy["elapsed_s"] = round(time.time() - status_copy["start_time"], 1)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(status_copy).encode("utf-8"))
            return

        # 2. Serve Segment Audio Files from /segments/...
        if path.startswith("/segments/"):
            rel_path = path[len("/segments/"):]
            file_path = SEGMENTS_DIR / rel_path
            if file_path.is_file():
                self.send_response(200)
                mime_type, _ = mimetypes.guess_type(str(file_path))
                self.send_header("Content-Type", mime_type or "audio/wav")
                self.send_header("Content-Length", str(file_path.stat().st_size))
                self.end_headers()
                with open(file_path, "rb") as f:
                    shutil.copyfileobj(f, self.wfile)
                return
            else:
                self.send_error(404, f"Segment file not found: {rel_path}")
                return

        # Default static file handling from docs/
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/set_token":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8")
                data = json.loads(body)
                token = data.get("token", "").strip()
                if token:
                    os.environ["HF_TOKEN"] = token
                    # Reset models so next call reloads SraVaani and PyAnnote with token
                    asr._loaded_models.clear()
                    import diarization
                    diarization._pipeline = None
                    diarization._pipeline_token = None
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "token_set": bool(token)}).encode("utf-8"))
            except Exception as e:
                self.send_error(500, str(e))
            return

        if path == "/api/process_audio":
            try:
                ctype = self.headers.get("Content-Type", "")
                if "multipart/form-data" not in ctype:
                    self.send_error(400, "Expected multipart/form-data")
                    return

                # Parse multipart form data
                fields, files = parse_multipart_data(self.rfile, self.headers)

                if "audio" not in files:
                    self.send_error(400, "Missing 'audio' file upload")
                    return

                audio_file = files["audio"]
                filename = audio_file.get("filename") or "upload.wav"
                custom_name = fields.get("custom_name", "").strip() or Path(filename).stem
                domain = fields.get("domain", "").strip()
                hf_token = fields.get("hf_token", "").strip()
                selected_model = fields.get("model", "").strip()
                run_asr_val = fields.get("run_asr", "true").strip().lower()
                should_run_asr = run_asr_val not in ["false", "0", "no"]

                if not domain:
                    self.send_error(400, "Domain is compulsory")
                    return

                if hf_token:
                    os.environ["HF_TOKEN"] = hf_token

                # Save uploaded file temporarily to root uploads/
                uploads_dir = ROOT_DIR / "uploads"
                uploads_dir.mkdir(parents=True, exist_ok=True)
                temp_file = uploads_dir / filename
                with open(temp_file, "wb") as f:
                    f.write(audio_file["data"])

                print(f"[SegAUD Server] Processing audio: {filename} (Domain: {domain}, Model: {selected_model or 'Default'}, Run ASR: {should_run_asr}, Stem: {custom_name})")

                # Initialize live pipeline progress
                with _status_lock:
                    PIPELINE_STATUS.update({
                        "running": True,
                        "phase": "init",
                        "current": 0,
                        "total": 0,
                        "message": "01/03: Preparing audio for processing...",
                        "percent": 5,
                        "start_time": time.time(),
                        "elapsed_s": 0.0
                    })

                # Run Python pipeline: Silero VAD -> Diarization & Split -> ASR -> CSVs
                results, csv_path, unv_path = process_audio(
                    str(temp_file),
                    output_dir=str(SEGMENTS_DIR),
                    audio_name=custom_name,
                    domain=domain,
                    token=hf_token or None,
                    asr_model=selected_model or None,
                    run_asr=should_run_asr,
                    progress_callback=update_pipeline_progress
                )

                with _status_lock:
                    PIPELINE_STATUS.update({
                        "running": False,
                        "phase": "done",
                        "percent": 100,
                        "message": f"Complete: {len(results)} segments generated"
                    })

                # Format response with clip URLs and speaker labels for UI playback
                formatted_segments = []
                for item in results:
                    seg_id = item["segment_id"]
                    wav_file = Path(item["file"])
                    rel_url = f"/segments/{custom_name}/{wav_file.name}"
                    formatted_segments.append({
                        "id": seg_id,
                        "start": item["start"],
                        "end": item["end"],
                        "duration": round(item["end"] - item["start"], 2),
                        "conf": 0.95,
                        "domain": item["domain"],
                        "speaker": item.get("speaker", "Speaker 1"),
                        "text": item.get("transcript", ""),
                        "verified": False,
                        "audio_url": rel_url
                    })

                active_repo = asr._current_active_info.get("repo", "openai/whisper-base")
                response_payload = {
                    "success": True,
                    "audio_name": custom_name,
                    "domain": domain,
                    "segments": formatted_segments,
                    "model_used": selected_model or active_repo or "Whisper-Base",
                    "csv_path": str(csv_path),
                    "unverified_csv_path": str(unv_path)
                }

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps(response_payload, ensure_ascii=False).encode("utf-8"))

            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_error(500, f"Pipeline Error: {str(e)}")
            return

        self.send_error(404, "Unknown endpoint")


def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def launch_desktop_window(url):
    """Launch SegAUD in a native PC standalone app window using Edge or Chrome."""
    # Look for Edge or Chrome
    candidates = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]

    for exe in candidates:
        if os.path.isfile(exe):
            try:
                subprocess.Popen([exe, f"--app={url}", "--window-size=1366,850"])
                return
            except Exception:
                pass

    # Fallback to standard default web browser
    webbrowser.open(url)


def main():
    port = PORT
    if is_port_in_use(port):
        print(f"[SegAUD] Port {port} in use. Attempting port 8085...")
        port = 8085

    server_address = ("127.0.0.1", port)

    class ReusableThreadingServer(ThreadingHTTPServer):
        daemon_threads = True

        def server_bind(self):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            super().server_bind()

    try:
        httpd = ReusableThreadingServer(server_address, SegAudRequestHandler)
    except Exception:
        httpd = ThreadingHTTPServer(server_address, SegAudRequestHandler)

    app_url = f"http://127.0.0.1:{port}/"

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    model_info = asr.get_active_model_info()
    model_name_disp = "ARTPARK-IISc/SraVaani-1.0" if model_info.get("has_token") else "OpenAI Whisper-Base (Hindi / Awadhi Devanagari)"

    print("=" * 65)
    print("   [SegAUD] Audio Segmentation & Transcription PC App")
    print("=" * 65)
    print(f" * Server running on: {app_url}")
    print(f" * Speech Segmentation: Silero VAD (PyTorch, max 8s per phrase)")
    print(f" * Speech Recognition:  {model_name_disp}")
    print(f" * Segment Output:      {SEGMENTS_DIR.resolve()}")
    print("=" * 65)
    print(" Opening desktop application window...")

    # Launch desktop window after 0.6 second
    threading.Timer(0.6, lambda: launch_desktop_window(app_url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[SegAUD] Shutting down server.")
        httpd.server_close()


if __name__ == "__main__":
    main()
