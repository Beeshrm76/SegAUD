import csv
import io
import sys
from pathlib import Path

# Ensure UTF-8 stdout on Windows console safely without closing streams
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import torch

import asr
from vad import segment_audio

FIELDS = ["segment_id", "source", "file", "start", "end", "transcript", "domain", "verified"]


def process_audio(audio_path: str, output_dir: str = "segments", audio_name: str = None, domain: str = ""):
    """VAD -> transcribe each segment -> transcriptions.csv in the file's folder."""
    if not domain or not domain.strip():
        raise ValueError("Domain is compulsory.")

    segments, out = segment_audio(audio_path, output_dir=output_dir, audio_name=audio_name, domain=domain)
    results = []

    torch.set_num_threads(asr.ASR_THREADS)  # VAD lowered it; restore for ASR
    for index, segment in enumerate(segments, start=1):
        print(f"[{Path(audio_path).name}] segment {index}/{len(segments)} ({segment['segment_id']})...")
        try:
            transcript = asr.transcribe(segment["file"], domain=domain)
        except Exception as exc:  # keep going if one clip fails
            print(f"  failed: {exc}")
            transcript = ""
        # transcripts are ASR drafts: verified stays empty until a native
        # speaker checks them (put e.g. "yes" / corrected text elsewhere)
        results.append({**segment, "transcript": transcript, "domain": domain, "verified": ""})

    output_csv = out / "transcriptions.csv"
    with output_csv.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(results)

    unverified_csv = out / "unverified.csv"
    unverified_results = [r for r in results if not r.get("verified")]
    with unverified_csv.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(unverified_results)

    return results, output_csv, unverified_csv


def main():
    paths = [p.strip().strip('"') for p in sys.argv[1:]]
    if not paths:
        paths = [input("Enter audio file path: ").strip().strip('"')]

    # Domain is compulsory
    domain = ""
    while not domain:
        domain = input("Enter audio domain (compulsory, e.g. Agriculture, Healthcare): ").strip()

    for audio_file in paths:
        if not Path(audio_file).is_file():
            print(f"Skipping, not found: {audio_file}")
            continue

        default_stem = Path(audio_file).stem
        custom_name = input(f"Enter custom name for '{Path(audio_file).name}' [default: {default_stem}]: ").strip() or default_stem

        results, csv_path, unv_path = process_audio(audio_file, audio_name=custom_name, domain=domain)
        print(f"\nCompleted {audio_file}: {len(results)} segments")
        print(f"Transcript CSV: {csv_path.resolve()}")
        print(f"Unverified CSV: {unv_path.resolve()}")
        for item in results:
            print(f"[{item['segment_id']} | {item['start']:.2f}s - {item['end']:.2f}s | {item['domain']}] {item['transcript']}")


if __name__ == "__main__":
    main()
