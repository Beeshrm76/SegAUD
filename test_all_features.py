import os
import sys
import json
import time
import subprocess
import urllib.request
import urllib.parse
import http.cookiejar
from pathlib import Path

BASE_VTR = "http://127.0.0.1:3000"

cookie_jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))

def log_test(name, success, detail=""):
    mark = "PASS [✓]" if success else "FAIL [✗]"
    print(f"{mark} {name}: {detail}")
    if not success:
        raise AssertionError(f"Test failed: {name} - {detail}")

def test_1_speaker_editable_code():
    print("\n--- Testing Task 1: Editable Speakers in SegAUD Frontend ---")
    app_js_path = Path("docs/app.js")
    style_css_path = Path("docs/style.css")

    with open(app_js_path, "r", encoding="utf-8") as f:
        app_js = f.read()
    with open(style_css_path, "r", encoding="utf-8") as f:
        style_css = f.read()

    log_test("speakerList initialized", "let speakerList = ['Speaker 1', 'Speaker 2'];" in app_js)
    log_test("speaker auto-population from detected segments", "const detectedSpeakers = [...new Set(activeSegments.map" in app_js)
    log_test("speaker select dropdown in table", "class=\"speaker-select\"" in app_js and "+ Add Speaker" in app_js)
    log_test("add speaker prompt handler", "val === '__add_new__'" in app_js and "Enter new speaker name" in app_js)
    log_test("speaker dropdown CSS styling", ".speaker-select" in style_css)

def test_2_vtr_server_and_auth():
    print("\n--- Testing Task 2 & 3: VTR Server, Auth & Modes ---")
    # Test GET login
    req = urllib.request.Request(f"{BASE_VTR}/login")
    with opener.open(req) as resp:
        html = resp.read().decode("utf-8")
        log_test("VTR Login page accessible", resp.status == 200 and "Shruti-Lekhan" in html)

    # Test POST login with admin
    login_data = urllib.parse.urlencode({"username": "admin", "password": "Admin@76"}).encode("utf-8")
    req = urllib.request.Request(f"{BASE_VTR}/login", data=login_data, method="POST")
    with opener.open(req) as resp:
        log_test("Admin login successful", resp.status == 200)

    # Test GET / (workspace review mode)
    req = urllib.request.Request(f"{BASE_VTR}/")
    with opener.open(req) as resp:
        html = resp.read().decode("utf-8")
        log_test("Workspace review accessible", resp.status == 200)

    # Test GET /?tab=upload (accessible for dataset upload in SegAUD format)
    req = urllib.request.Request(f"{BASE_VTR}/?tab=upload")
    with opener.open(req) as resp:
        html = resp.read().decode("utf-8")
        log_test("Upload tab accessible in SegAUD format", resp.status == 200 and "SegAUD Format" in html)

def test_3_segaud_import_and_sync():
    print("\n--- Testing SegAUD Format Import & Sync ---")
    sample_segments = [
        {
            "id": "test_sample_seg00001",
            "voice": "test_sample_seg00001.wav",
            "transcript": "सिया राममे सब जग जानी करहु प्रणाम जोड़ि जुटबानी",
            "speaker": "Speaker 1",
            "domain": "Devotional",
            "verified": False
        },
        {
            "id": "test_sample_seg00002",
            "voice": "test_sample_seg00002.wav",
            "transcript": "अवधि बानी के मेहमान बानी कार्यक्रम",
            "speaker": "Speaker 2",
            "domain": "Interview",
            "verified": True
        }
    ]

    import_data = json.dumps({
        "projectName": "Test_Project",
        "segments": sample_segments
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{BASE_VTR}/api/import-segaud",
        data=import_data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with opener.open(req) as resp:
        res_json = json.loads(resp.read().decode("utf-8"))
        log_test("POST /api/import-segaud", res_json.get("success") is True and res_json.get("count") == 2, f"{res_json.get('message')}")

    # Verify records.json and records_original.json were created and matched
    vtr_data_dir = Path("Voice-Transcription-Reviewer/data")
    with open(vtr_data_dir / "records.json", "r", encoding="utf-8") as f:
        recs = json.load(f)
    with open(vtr_data_dir / "records_original.json", "r", encoding="utf-8") as f:
        orig_recs = json.load(f)

    log_test("Baseline records_original.json saved", len(orig_recs) == 2)
    log_test("Active records.json saved", len(recs) == 2 and recs[0]["transcription"] == sample_segments[0]["transcript"])

def test_4_audio_trim_and_revert():
    print("\n--- Testing Audio Trimming & Revert to Original ---")
    vtr_uploads = Path("Voice-Transcription-Reviewer/uploads")
    vtr_originals = Path("Voice-Transcription-Reviewer/originals")
    vtr_uploads.mkdir(parents=True, exist_ok=True)
    vtr_originals.mkdir(parents=True, exist_ok=True)

    test_wav = vtr_uploads / "test_sample_seg00001.wav"
    orig_wav = vtr_originals / "test_sample_seg00001.wav"

    dummy_wav_content = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00" + b"\x01\x02\x03\x04" * 100
    with open(test_wav, "wb") as f:
        f.write(dummy_wav_content)
    with open(orig_wav, "wb") as f:
        f.write(dummy_wav_content)

    # Simulate trimmed audio (different size/content)
    trimmed_content = b"RIFF\x14\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00" + b"\x09\x09\x09\x09" * 20
    with open(test_wav, "wb") as f:
        f.write(trimmed_content)

    log_test("Trimmed audio simulated", os.path.getsize(test_wav) != len(dummy_wav_content))

    # Call POST /revert-audio
    revert_data = json.dumps({"idx": 0}).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_VTR}/revert-audio",
        data=revert_data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with opener.open(req) as resp:
        res_json = json.loads(resp.read().decode("utf-8"))
        log_test("POST /revert-audio succeeded", res_json.get("success") is True, f"{res_json.get('message')}")

    # Check that original content was restored
    with open(test_wav, "rb") as f:
        restored = f.read()
    log_test("Audio file reverted to original bytes", restored == dummy_wav_content)

def test_5_record_edit_and_revert():
    print("\n--- Testing Single Record Edit & Revert ---")
    save_data = urllib.parse.urlencode({
        "idx": "0",
        "action": "save",
        "transcription": "EDITED MISTAKE TRANSCRIPTION",
        "normalizedTranscription": "EDITED MISTAKE NORMALIZED"
    }).encode("utf-8")

    req = urllib.request.Request(f"{BASE_VTR}/save", data=save_data, method="POST")
    with opener.open(req) as resp:
        log_test("POST /save (edit record)", resp.status == 200)

    # Verify records.json reflects the edit while records_original.json is untouched
    vtr_data_dir = Path("Voice-Transcription-Reviewer/data")
    with open(vtr_data_dir / "records.json", "r", encoding="utf-8") as f:
        recs = json.load(f)
    with open(vtr_data_dir / "records_original.json", "r", encoding="utf-8") as f:
        orig = json.load(f)

    log_test("Edit saved to records.json", recs[0]["transcription"] == "EDITED MISTAKE TRANSCRIPTION")
    log_test("Original records_original.json unchanged", orig[0]["transcription"] != "EDITED MISTAKE TRANSCRIPTION")

    # Verify edits history log exists
    edits_log = Path("Voice-Transcription-Reviewer/edits/edits_log.json")
    log_test("Edits history log populated", edits_log.is_file() and os.path.getsize(edits_log) > 0)

    # Revert the single record using POST /revert-record
    revert_data = json.dumps({"idx": 0}).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_VTR}/revert-record",
        data=revert_data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with opener.open(req) as resp:
        res_json = json.loads(resp.read().decode("utf-8"))
        log_test("POST /revert-record succeeded", res_json.get("success") is True, f"{res_json.get('message')}")

    # Verify records.json was reverted
    with open(vtr_data_dir / "records.json", "r", encoding="utf-8") as f:
        recs_after = json.load(f)
    log_test("Record restored to original baseline", recs_after[0]["transcription"] == orig[0]["transcription"])

def test_6_revert_all_dataset():
    print("\n--- Testing Full Dataset Revert ---")
    vtr_data_dir = Path("Voice-Transcription-Reviewer/data")
    with open(vtr_data_dir / "records.json", "r", encoding="utf-8") as f:
        recs = json.load(f)
    recs[0]["transcription"] = "Corrupted 1"
    recs[1]["transcription"] = "Corrupted 2"
    with open(vtr_data_dir / "records.json", "w", encoding="utf-8") as f:
        json.dump(recs, f)

    # Call POST /revert-all
    req = urllib.request.Request(
        f"{BASE_VTR}/revert-all",
        data=b"{}",
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with opener.open(req) as resp:
        res_json = json.loads(resp.read().decode("utf-8"))
        log_test("POST /revert-all succeeded", res_json.get("success") is True, f"{res_json.get('message')}")

    with open(vtr_data_dir / "records.json", "r", encoding="utf-8") as f:
        recs_after = json.load(f)
    log_test("All records restored from original", recs_after[0]["transcription"] != "Corrupted 1" and recs_after[1]["transcription"] != "Corrupted 2")

def test_7_segaud_ui_integration():
    print("\n--- Testing SegAUD UI & Integration Files ---")
    with open("docs/index.html", "r", encoding="utf-8") as f:
        html = f.read()
    with open("docs/app.js", "r", encoding="utf-8") as f:
        js = f.read()

    log_test("Nav header has Transcription Review link", "href=\"#transcription-review\"" in html)
    log_test("Results has 'Open in Reviewer' button", "id=\"open-vtr-results-btn\"" in html)
    log_test("Dedicated Transcription Review section present", "id=\"transcription-review\"" in html)
    log_test("app.js has initTranscriptionReview", "function initTranscriptionReview()" in js)
    log_test("app.js has openVtrResultsBtn sync handler", "openVtrResultsBtn" in js and "/api/sync_to_vtr" in js)

def main():
    print("=" * 60)
    print("      RUNNING INTEGRATION TESTS FOR TASKS 1 - 4")
    print("=" * 60)

    # Start Node VTR process inside this command
    vtr_dir = Path("Voice-Transcription-Reviewer")
    node_proc = subprocess.Popen(
        ["node", "server.js"],
        cwd=str(vtr_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    try:
        # Wait up to 5 seconds for VTR to be ready
        ready = False
        for _ in range(25):
            time.sleep(0.2)
            try:
                urllib.request.urlopen(f"{BASE_VTR}/login", timeout=1)
                ready = True
                break
            except Exception:
                pass

        if not ready:
            stdout, stderr = node_proc.communicate(timeout=2)
            raise RuntimeError(f"VTR server failed to start: {stderr.decode('utf-8', errors='replace')}")

        print("VTR Server active on port 3000. Proceeding with tests...")

        test_1_speaker_editable_code()
        test_2_vtr_server_and_auth()
        test_3_segaud_import_and_sync()
        test_4_audio_trim_and_revert()
        test_5_record_edit_and_revert()
        test_6_revert_all_dataset()
        test_7_segaud_ui_integration()

        print("\n" + "=" * 60)
        print("   ALL TESTS PASSED SUCCESSFULLY! (Tasks 1, 2, 3, 4)")
        print("=" * 60)
    finally:
        node_proc.terminate()
        node_proc.wait(timeout=3)

if __name__ == "__main__":
    main()
