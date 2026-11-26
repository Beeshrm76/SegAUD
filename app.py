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

try:
    import torch
except Exception:
    torch = None

import asr
import vad
from main import process_audio

PORT = 8080
DOCS_DIR = ROOT_DIR / "docs"
SEGMENTS_DIR = ROOT_DIR / "segments"
SEGMENTS_DIR.mkdir(parents=True, exist_ok=True)
VTR_DIR = ROOT_DIR / "Voice-Transcription-Reviewer"
VTR_PORT = 3000


def start_vtr_server():
    """Start the Node.js Voice-Transcription-Reviewer server in background if not already running."""
    if is_port_in_use(VTR_PORT):
        return True, f"http://127.0.0.1:{VTR_PORT}/"
    if not (VTR_DIR / "server.js").is_file():
        return False, "server.js not found in Voice-Transcription-Reviewer"
    node_exe = shutil.which("node")
    if not node_exe:
        return False, "Node.js executable not found on system PATH"
    try:
        kwargs = {}
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        subprocess.Popen(
            [node_exe, "server.js"],
            cwd=str(VTR_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            **kwargs
        )
        for _ in range(15):
            time.sleep(0.2)
            if is_port_in_use(VTR_PORT):
                return True, f"http://127.0.0.1:{VTR_PORT}/"
        return True, f"http://127.0.0.1:{VTR_PORT}/"
    except Exception as e:
        return False, str(e)


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

        # 1. API Status & Hardware Telemetry
        if path in ["/api/status", "/api/hardware_info"]:
            info = asr.get_active_model_info()
            info["status"] = "ok"
            info["engine"] = "Python Native Backend"
            cuda_avail = False
            device_name = "CPU (x86_64)"
            device_count = 0
            vram_gb = 0.0

            try:
                import torch as _th
                if _th is not None and hasattr(_th, "cuda") and _th.cuda.is_available():
                    cuda_avail = True
                    device_name = _th.cuda.get_device_name(0)
                    device_count = _th.cuda.device_count()
                    try:
                        vram_gb = round(_th.cuda.get_device_properties(0).total_memory / (1024**3), 2)
                    except Exception:
                        vram_gb = 0.0
            except Exception:
                pass

            info["cuda_available"] = cuda_avail
            info["device_name"] = device_name
            info["device_count"] = device_count
            info["vram_gb"] = vram_gb
            info["cpu_count"] = os.cpu_count() or 4
            info["asr_threads"] = getattr(asr, "ASR_THREADS", 4)
            info["vad_threads"] = getattr(vad, "VAD_THREADS", 1)
            info["active_device"] = getattr(asr, "DEVICE", "cpu")
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

        # 3. Installer & Launcher Download Endpoints
        if path == "/api/download/installer_bat":
            bat_file = ROOT_DIR / "install.bat"
            if bat_file.is_file():
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Disposition", 'attachment; filename="install.bat"')
                self.send_header("Content-Length", str(bat_file.stat().st_size))
                self.end_headers()
                with open(bat_file, "rb") as f:
                    shutil.copyfileobj(f, self.wfile)
                return
            self.send_error(404, "install.bat not found")
            return

        if path == "/api/download/installer_exe":
            exe_file = ROOT_DIR / "Install_SegAUD.exe"
            if exe_file.is_file():
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Disposition", 'attachment; filename="Install_SegAUD.exe"')
                self.send_header("Content-Length", str(exe_file.stat().st_size))
                self.end_headers()
                with open(exe_file, "rb") as f:
                    shutil.copyfileobj(f, self.wfile)
                return
            self.send_error(404, "Install_SegAUD.exe not found")
            return

        if path == "/api/download/app_exe":
            exe_file = ROOT_DIR / "SegAUD.exe"
            if exe_file.is_file():
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Disposition", 'attachment; filename="SegAUD.exe"')
                self.send_header("Content-Length", str(exe_file.stat().st_size))
                self.end_headers()
                with open(exe_file, "rb") as f:
                    shutil.copyfileobj(f, self.wfile)
                return
            self.send_error(404, "SegAUD.exe not found")
            return

        # 4. Local Actions Trigger Endpoints
        if path == "/api/run_install_locally":
            try:
                subprocess.Popen(["cmd.exe", "/c", "start", "cmd.exe", "/k", str(ROOT_DIR / "install.bat")], cwd=str(ROOT_DIR))
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "message": "Installer launched in terminal"}).encode("utf-8"))
            except Exception as e:
                self.send_error(500, str(e))
            return

        if path == "/api/launch_app_window":
            try:
                launch_desktop_window(f"http://127.0.0.1:{self.server.server_address[1]}/")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
            except Exception as e:
                self.send_error(500, str(e))
            return

        if path == "/api/vtr_status":
            in_use = is_port_in_use(VTR_PORT)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"running": in_use, "url": f"http://127.0.0.1:{VTR_PORT}/"}).encode("utf-8"))
            return

        if path == "/api/launch_vtr":
            started, vtr_url = start_vtr_server()
            target_url = f"http://127.0.0.1:{VTR_PORT}/auth/segaud-admin?target=/"
            webbrowser.open(target_url)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "url": target_url}).encode("utf-8"))
            return

        if path == "/api/launch_vtr_admin":
            started, vtr_url = start_vtr_server()
            target_url = f"http://127.0.0.1:{VTR_PORT}/auth/segaud-admin?target=/?tab=upload"
            webbrowser.open(target_url)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "url": target_url}).encode("utf-8"))
            return

        # Default static file handling from docs/
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/set_hardware":
            try:
                body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8")
                data = json.loads(body)
                active_dev = asr.DEVICE
                if "device" in data:
                    active_dev = asr.set_device(data["device"])
                if "asr_threads" in data:
                    asr.set_threads(int(data["asr_threads"]))
                if "vad_threads" in data:
                    vad.set_threads(int(data["vad_threads"]))
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "device": active_dev,
                    "asr_threads": asr.ASR_THREADS,
                    "vad_threads": vad.VAD_THREADS
                }).encode("utf-8"))
            except Exception as e:
                self.send_error(500, str(e))
            return

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
                device_val = fields.get("device", "").strip()
                asr_threads_val = fields.get("asr_threads", "").strip()
                vad_threads_val = fields.get("vad_threads", "").strip()
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

                parsed_asr_threads = int(asr_threads_val) if asr_threads_val.isdigit() else None
                parsed_vad_threads = int(vad_threads_val) if vad_threads_val.isdigit() else None

                print(f"[SegAUD Server] Processing audio: {filename} (Domain: {domain}, Model: {selected_model or 'Default'}, Device: {device_val or 'auto'}, Threads: VAD={parsed_vad_threads or 1}/ASR={parsed_asr_threads or 4}, Run ASR: {should_run_asr}, Stem: {custom_name})")

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
                    progress_callback=update_pipeline_progress,
                    device=device_val or None,
                    asr_threads=parsed_asr_threads,
                    vad_threads=parsed_vad_threads
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

        if path == "/api/sync_to_vtr":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
                payload = json.loads(body) if body else {}

                audio_name = payload.get("audio_name", "").strip() or "audio"
                segments_data = payload.get("segments", [])

                started, vtr_url = start_vtr_server()
                if not started:
                    self.send_response(500)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": f"Failed to start VTR server: {vtr_url}"}).encode("utf-8"))
                    return

                vtr_uploads = VTR_DIR / "uploads"
                vtr_originals = VTR_DIR / "originals"
                vtr_data = VTR_DIR / "data"
                vtr_uploads.mkdir(parents=True, exist_ok=True)
                vtr_originals.mkdir(parents=True, exist_ok=True)
                vtr_data.mkdir(parents=True, exist_ok=True)

                # Copy WAV segments into VTR
                seg_folder = SEGMENTS_DIR / audio_name
                if seg_folder.is_dir():
                    for wav_file in seg_folder.glob("*.wav"):
                        shutil.copy2(str(wav_file), str(vtr_uploads / wav_file.name))
                        shutil.copy2(str(wav_file), str(vtr_originals / wav_file.name))

                # Build VTR records
                vtr_records = []
                for idx, seg in enumerate(segments_data):
                    seg_id = seg.get("id") or f"{audio_name}_seg{idx+1:05d}"
                    voice_name = f"{seg_id}.wav" if not seg_id.endswith(".wav") else seg_id
                    vtr_records.append({
                        "id": idx,
                        "voice": voice_name,
                        "transcription": (seg.get("text") or seg.get("transcript") or "").strip(),
                        "normalizedTranscription": (seg.get("text") or seg.get("transcript") or "").strip(),
                        "speaker": seg.get("speaker") or "Speaker 1",
                        "domain": seg.get("domain") or "",
                        "backgroundNoise": "",
                        "audioComplete": "",
                        "silenceAtBeginning": "",
                        "silenceAtEnd": "",
                        "speakingRate": "",
                        "emotion": "",
                        "volume": "",
                        "accent": "",
                        "status": "verified" if seg.get("verified") else "pending",
                        "verifiedBy": "SegAUD" if seg.get("verified") else None,
                        "updatedAt": None
                    })

                if vtr_records:
                    records_file = vtr_data / "records.json"
                    orig_records_file = vtr_data / "records_original.json"
                    with open(records_file, "w", encoding="utf-8") as f:
                        json.dump(vtr_records, f, ensure_ascii=False, indent=2)
                    with open(orig_records_file, "w", encoding="utf-8") as f:
                        json.dump(vtr_records, f, ensure_ascii=False, indent=2)

                    mapping_csv = vtr_uploads / "mapping.csv"
                    with open(mapping_csv, "w", encoding="utf-8-sig", newline="") as f:
                        import csv
                        writer = csv.DictWriter(f, fieldnames=[
                            "voice", "orthographic_transcription", "normalized_transcription",
                            "speaker", "domain", "status", "verified_by"
                        ])
                        writer.writeheader()
                        for r in vtr_records:
                            writer.writerow({
                                "voice": r["voice"],
                                "orthographic_transcription": r["transcription"],
                                "normalized_transcription": r["normalizedTranscription"],
                                "speaker": r["speaker"],
                                "domain": r["domain"],
                                "status": r["status"],
                                "verified_by": r["verifiedBy"] or ""
                            })

                vtr_target_url = f"http://127.0.0.1:{VTR_PORT}/?idx=0"
                webbrowser.open(vtr_target_url)

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "url": vtr_target_url,
                    "count": len(vtr_records),
                    "message": f"Synced {len(vtr_records)} segments to Voice Transcription Reviewer!"
                }).encode("utf-8"))
            except Exception as e:
                self.send_error(500, f"Sync error: {str(e)}")
            return

        self.send_error(404, "Unknown endpoint")


def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def start_native_app_window(url):
    """Launch SegAUD in a genuine native desktop application window (WebView2)."""
    try:
        import webview
        window = webview.create_window(
            title="SegAUD — Audio Segmentation & Transcription Platform",
            url=url,
            width=1366,
            height=850,
            min_size=(920, 620),
            resizable=True,
            text_select=True,
            confirm_close=False
        )
        webview.start()
        return True
    except Exception as e:
        print(f"[SegAUD] Native window note: {e}")
        return False


def launch_desktop_window(url):
    """Fallback: Launch SegAUD with isolated user profile (no browser cache sharing)."""
    profile_dir = Path(os.environ.get("LOCALAPPDATA", str(ROOT_DIR))) / "SegAUD" / "isolated_profile"
    profile_dir.mkdir(parents=True, exist_ok=True)

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
                subprocess.Popen([
                    exe,
                    f"--app={url}",
                    f"--user-data-dir={profile_dir}",
                    "--window-size=1366,850",
                    "--no-first-run",
                    "--no-default-browser-check"
                ])
                return
            except Exception:
                pass

    # Fallback to standard web browser
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
    vtr_ok, vtr_msg = start_vtr_server()
    if vtr_ok:
        print(f" * Transcription Review: http://127.0.0.1:{VTR_PORT}/ (Active)")
    else:
        print(f" * Transcription Review: Standby ({vtr_msg})")
    print(" Opening desktop application window...")

    # Start HTTP server on background daemon thread
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()

    # Launch native desktop application window (WebView2) on main thread
    launched_native = False
    try:
        launched_native = start_native_app_window(app_url)
    except Exception as e:
        print(f"[SegAUD] Native window note: {e}")

    # Fallback if pywebview window could not be opened or ran headless
    if not launched_native:
        threading.Timer(0.3, lambda: launch_desktop_window(app_url)).start()
        try:
            while server_thread.is_alive():
                time.sleep(1)
        except KeyboardInterrupt:
            pass

    print("\n[SegAUD] Shutting down server.")
    try:
        httpd.shutdown()
        httpd.server_close()
    except Exception:
        pass


if __name__ == "__main__":
    main()
