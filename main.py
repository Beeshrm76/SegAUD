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
import diarization
from vad import segment_audio, _load_wav, SAMPLE_RATE
import soundfile as sf

FIELDS = ["segment_id", "source", "file", "start", "end", "speaker", "transcript", "domain", "verified"]


def process_audio(
    audio_path: str,
    output_dir: str = "segments",
    audio_name: str = None,
    domain: str = "",
    token: str = None,
    asr_model: str = None,
    run_asr: bool = True,
    progress_callback = None
):
    """Pipeline: Phase 1 (VAD) -> Phase 2 (ASR) -> Phase 3 (Speaker Annotation) -> CSVs."""
    if not domain or not domain.strip():
        raise ValueError("Domain is compulsory.")

    source = Path(audio_path)
    stem = audio_name.strip() if (audio_name and audio_name.strip()) else source.stem
    stem = Path(stem).stem

    # Phase 1: Voice Activity Detection (Silero VAD)
    if progress_callback:
        progress_callback("vad", 0, 0, "01/03: Voice Activity Detection (Silero VAD detecting speech)...", 15)

    raw_segments, out = segment_audio(audio_path, output_dir=output_dir, audio_name=audio_name, domain=domain)
    total_clips = len(raw_segments)

    # Phase 2: Speech Recognition (Devanagari ASR)
    transcribed_segments = []
    if run_asr:
        torch.set_num_threads(asr.ASR_THREADS)
        for index, segment in enumerate(raw_segments, start=1):
            pct = int(20 + (index / max(1, total_clips)) * 60)
            msg = f"02/03: Transcribing clip {index}/{total_clips} ({segment['segment_id']})..."
            print(f"[{source.name}] clip {index}/{total_clips} ({segment['segment_id']})...")
            if progress_callback:
                progress_callback("asr", index, total_clips, msg, pct)
            try:
                transcript = asr.transcribe(segment["file"], token=token, domain=domain, model_name=asr_model)
            except Exception as exc:
                print(f"  failed: {exc}")
                transcript = ""
            transcribed_segments.append({
                **segment,
                "transcript": transcript,
                "verified": ""
            })
    else:
        for segment in raw_segments:
            transcribed_segments.append({
                **segment,
                "transcript": "",
                "verified": ""
            })

    # Phase 3: Speaker Annotation & Diarization
    if progress_callback:
        progress_callback("diarization", 0, total_clips, f"03/03: Speaker Diarization annotating {total_clips} speech turns...", 82)

    try:
        final_segments = diarization.diarize_and_assign_speakers(
            audio_path,
            transcribed_segments,
            token=token,
            progress_callback=progress_callback
        )
    except Exception as d_exc:
        print(f"[SegAUD Pipeline] Diarization notice ({d_exc}). Defaulting to single speaker.")
        final_segments = transcribed_segments

    if progress_callback:
        progress_callback("done", total_clips, total_clips, f"✓ Processed {len(final_segments)}/{total_clips} clips!", 100)

    # Save segments.csv, transcriptions.csv, unverified.csv (plain text speaker labels, NO HTML badges)
    with (out / "segments.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["segment_id", "source", "file", "start", "end", "speaker", "domain"])
        writer.writeheader()
        writer.writerows([{k: v for k, v in r.items() if k in ["segment_id", "source", "file", "start", "end", "speaker", "domain"]} for r in final_segments])

    output_csv = out / "transcriptions.csv"
    with output_csv.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(final_segments)

    unverified_csv = out / "unverified.csv"
    unverified_results = [r for r in final_segments if not r.get("verified")]
    with unverified_csv.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(unverified_results)

    return final_segments, output_csv, unverified_csv


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
