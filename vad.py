from pathlib import Path
import csv

import torch
from silero_vad import (
    load_silero_vad,
    read_audio,
    get_speech_timestamps,
    save_audio,
)

SAMPLE_RATE = 16000
VAD_THREADS = 1
vad_model = load_silero_vad()


def _load_wav(audio_path: str) -> torch.Tensor:
    """Read any audio format (M4A, MP3, MP4, WAV, FLAC, OGG, AAC) as mono 16 kHz."""
    # 1. Try PyAV first: decodes all formats (M4A, AAC, MP3, MP4, etc.) reliably without external dependencies
    try:
        import av
        import numpy as np

        container = av.open(str(audio_path))
        resampler = av.audio.resampler.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
        chunks = []
        for frame in container.decode(audio=0):
            for rf in resampler.resample(frame):
                chunks.append(rf.to_ndarray())
        for rf in resampler.resample(None):
            chunks.append(rf.to_ndarray())
        container.close()
        if chunks:
            arr = np.concatenate(chunks, axis=1).squeeze(0)
            return torch.from_numpy(arr)
    except Exception:
        pass

    # 2. Try soundfile
    try:
        import soundfile as sf
        import torchaudio.functional as AF

        data, sr = sf.read(str(audio_path), dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        wav = torch.from_numpy(data)
        if sr != SAMPLE_RATE:
            wav = AF.resample(wav, sr, SAMPLE_RATE)
        return wav
    except Exception:
        pass

    # 3. Fallback to silero_vad read_audio
    return read_audio(str(audio_path), sampling_rate=SAMPLE_RATE)


def merge_adjacent_phrases(intervals, max_gap=0.55, max_duration=9.0):
    """Merge short pauses between connected words/phrases of the same speaker (e.g. 'I am ... Bee')."""
    if not intervals:
        return []
    merged = [dict(intervals[0])]
    for curr in intervals[1:]:
        prev = merged[-1]
        gap = curr["start"] - prev["end"]
        combined_dur = curr["end"] - prev["start"]
        # If thinking/breath pause is under 550ms and combined phrase is <= 9s, keep in one segment
        if gap <= max_gap and combined_dur <= max_duration:
            prev["end"] = curr["end"]
        else:
            merged.append(dict(curr))
    return merged


def segment_audio(audio_path: str, output_dir: str = "segments", audio_name: str = None, domain: str = ""):
    """Split one audio file into speech regions (own sub-folder per source file)."""
    torch.set_num_threads(VAD_THREADS)

    source = Path(audio_path)
    stem = audio_name.strip() if (audio_name and audio_name.strip()) else source.stem
    stem = Path(stem).stem  # strip extension if present
    output = Path(output_dir) / stem  # no overwriting between files
    output.mkdir(parents=True, exist_ok=True)

    wav = _load_wav(audio_path)
    raw_timestamps = get_speech_timestamps(
        wav,
        vad_model,
        sampling_rate=SAMPLE_RATE,
        return_seconds=True,
        threshold=0.5,
        min_speech_duration_ms=250,
        min_silence_duration_ms=450,  # 450ms avoids breaking mid-sentence pauses (e.g. 'I am ... Bee')
        speech_pad_ms=150,           # Smoothly capture word onsets and fading consonants
        max_speech_duration_s=9.0,   # Keep cohesive sentence units under 9s
    )

    timestamps = merge_adjacent_phrases(raw_timestamps, max_gap=0.55, max_duration=9.0)

    results = []
    seg_idx = 1
    for item in timestamps:
        start, end = item["start"], item["end"]
        # Skip micro noise clicks (< 400ms)
        if (end - start) < 0.4:
            continue
        clip = wav[int(start * SAMPLE_RATE):int(end * SAMPLE_RATE)]
        seg_id = f"{stem}_seg{seg_idx:05d}"
        seg_idx += 1
        filename = output / f"{seg_id}.wav"
        # Save 16-bit PCM WAV directly using soundfile
        try:
            import soundfile as sf
            sf.write(str(filename), clip.cpu().numpy(), SAMPLE_RATE, subtype="PCM_16")
        except Exception:
            save_audio(str(filename), clip, SAMPLE_RATE)
        results.append({
            "segment_id": seg_id,
            "source": source.name,
            "file": str(filename),
            "start": round(start, 3),
            "end": round(end, 3),
            "domain": domain,
        })

    with (output / "segments.csv").open(
        "w", newline="", encoding="utf-8-sig"
    ) as f:
        writer = csv.DictWriter(f, fieldnames=["segment_id", "source", "file", "start", "end", "domain"])
        writer.writeheader()
        writer.writerows(results)

    return results, output
