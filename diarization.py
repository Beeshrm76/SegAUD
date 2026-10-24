"""
SegAUD — Speaker Diarization Module
Powered by pyannote.audio for speaker turn detection and multi-speaker segment splitting.
"""

import os
import sys
import warnings
from pathlib import Path
from typing import Dict, List, Tuple

warnings.filterwarnings("ignore", category=UserWarning)

_pipeline = None
_pipeline_token = None
_embedding_inference = None
_embedding_token = None


def get_embedding_inference(token: str = None):
    """Load neural speaker embedding inference model (wespeaker or pyannote/embedding)."""
    global _embedding_inference, _embedding_token
    access_token = token or os.environ.get("HF_TOKEN")

    if _embedding_inference is not None and _embedding_token == access_token:
        return _embedding_inference

    try:
        from pyannote.audio import Model, Inference

        # Try pyannote/wespeaker-voxceleb-resnet34-LM first (fast, open, highly accurate biometrics)
        candidates = [
            "pyannote/wespeaker-voxceleb-resnet34-LM",
            "pyannote/embedding",
        ]
        for repo in candidates:
            try:
                print(f"[SegAUD Diarization] Initializing embedding model {repo}...", flush=True)
                model_kwargs = {}
                if access_token:
                    model_kwargs["token"] = access_token
                model = Model.from_pretrained(repo, **model_kwargs)
                if model is not None:
                    inf = Inference(model, window="whole")
                    _embedding_inference = inf
                    _embedding_token = access_token
                    print(f"[SegAUD Diarization] Whole-segment embedding inference ready ({repo}).", flush=True)
                    return _embedding_inference
            except Exception as e:
                print(f"[SegAUD Diarization] {repo} notice: {e}", flush=True)
    except Exception as exc:
        print(f"[SegAUD Diarization] pyannote.audio import notice: {exc}", flush=True)

    return None


def get_diarization_pipeline(token: str = None):
    """Load pyannote speaker diarization pipeline with authenticated Hugging Face token."""
    global _pipeline, _pipeline_token
    access_token = token or os.environ.get("HF_TOKEN")

    if _pipeline is not None and _pipeline_token == access_token:
        return _pipeline

    try:
        from pyannote.audio import Pipeline
        if access_token:
            candidates = [
                ("pyannote/speaker-diarization-3.1", None),
                ("pyannote/speaker-diarization", "2.1.1"),
                ("pyannote/speaker-diarization", None)
            ]
            for repo, rev in candidates:
                try:
                    kwargs = {"token": access_token}
                    if rev:
                        kwargs["revision"] = rev
                    p = Pipeline.from_pretrained(repo, **kwargs)
                    if p is not None:
                        _pipeline = p
                        _pipeline_token = access_token
                        return _pipeline
                except Exception:
                    pass
    except Exception:
        pass

    return None


def extract_acoustic_features(waveform, sr=16000):
    """Extract fast acoustic feature representations (MFCCs, deltas, spectral centroid, energy)."""
    import numpy as np
    import torch
    import torchaudio

    if len(waveform) < 1600:
        waveform = torch.nn.functional.pad(waveform, (0, 1600 - len(waveform)))
    if waveform.ndim == 1:
        waveform = waveform.unsqueeze(0)

    # 1. 20 Mel-Frequency Cepstral Coefficients
    mfcc_transform = torchaudio.transforms.MFCC(
        sample_rate=sr,
        n_mfcc=20,
        melkwargs={"n_fft": 512, "hop_length": 160, "n_mels": 40, "center": False}
    )
    mfcc = mfcc_transform(waveform).squeeze(0)  # (20, frames)
    mfcc_mean = mfcc.mean(dim=1).cpu().numpy()
    mfcc_std = mfcc.std(dim=1).cpu().numpy()

    # 2. Delta MFCC
    delta = torchaudio.functional.compute_deltas(mfcc)
    delta_mean = delta.mean(dim=1).cpu().numpy()
    delta_std = delta.std(dim=1).cpu().numpy()

    # 3. Spectral Centroid
    hann = torch.hann_window(512, device=waveform.device)
    spec = torch.abs(torch.stft(waveform, n_fft=512, hop_length=160, window=hann, return_complex=True)).squeeze(0)
    spec_sum = torch.sum(spec, dim=0) + 1e-8
    freqs = torch.linspace(0, sr / 2, spec.shape[0], device=waveform.device).unsqueeze(1)
    sc = torch.sum(freqs * spec, dim=0) / spec_sum
    sc_mean = sc.mean().item()
    sc_std = sc.std().item()

    # 4. Energy RMS
    rms = torch.sqrt(torch.mean(waveform ** 2)).item()

    return np.hstack([mfcc_mean, mfcc_std, delta_mean, delta_std, [sc_mean, sc_std, rms]])


def extract_clip_features(clip, sr=16000, inference=None):
    """Extract either neural speaker embedding or acoustic feature vector for an audio clip."""
    import numpy as np
    import torch

    if inference is not None and len(clip) >= 3200:
        try:
            waveform = clip
            if waveform.ndim == 1:
                waveform = waveform.unsqueeze(0)
            if waveform.shape[1] < 8000:  # Pad to at least 0.5s for neural stability
                waveform = torch.nn.functional.pad(waveform, (0, 8000 - waveform.shape[1]))
            emb = inference({"waveform": waveform, "sample_rate": sr})
            if hasattr(emb, "cpu"):
                emb = emb.cpu().numpy()
            arr = np.asarray(emb).flatten()
            norm = np.linalg.norm(arr)
            if norm > 1e-8:
                arr = arr / norm
            return arr
        except Exception:
            pass

    return extract_acoustic_features(clip, sr=sr)


def diarize_and_assign_speakers(
    audio_path: str,
    vad_segments: List[Dict],
    token: str = None,
    progress_callback = None
) -> List[Dict]:
    """Fast, segment-level speaker diarization and assignment.
    Processes each speech segment in ~0.05-0.1s on CPU with live progress updates.
    Clusters embeddings into Speaker 1, Speaker 2, etc. using cosine agglomerative clustering.
    """
    import numpy as np
    import torch
    from sklearn.cluster import AgglomerativeClustering
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import silhouette_score
    from vad import _load_wav, SAMPLE_RATE

    if not vad_segments:
        return []

    if len(vad_segments) <= 1:
        return [{**s, "speaker": "Speaker 1"} for s in vad_segments]

    full_wav = _load_wav(audio_path)
    sr = SAMPLE_RATE
    total = len(vad_segments)

    # Initialize neural embedding inference or fall back to acoustic features
    inference = get_embedding_inference(token=token)
    mode_name = "Neural Biometrics (wespeaker/pyannote)" if inference is not None else "Acoustic Cepstral Clustering"
    print(f"[SegAUD Diarization] Starting segment-level speaker annotation via {mode_name} for {total} clips...", flush=True)

    features = []
    valid_indices = []

    for idx, seg in enumerate(vad_segments):
        s_sample = int(seg["start"] * sr)
        e_sample = int(seg["end"] * sr)
        clip = full_wav[s_sample:e_sample]

        if len(clip) >= 1600:  # At least 100ms
            f = extract_clip_features(clip, sr=sr, inference=inference)
            features.append(f)
            valid_indices.append(idx)

        if progress_callback:
            pct = 82 + int(16 * (idx + 1) / total)
            progress_callback("diarization", idx + 1, total, f"03/03: Annotating speaker {idx + 1}/{total}...", pct)

    if len(features) < 2:
        return [{**s, "speaker": "Speaker 1"} for s in vad_segments]

    features_arr = np.array(features)
    scaler = StandardScaler()
    norm_feats = scaler.fit_transform(features_arr)

    # Evaluate 2-cluster separation
    labels_2 = AgglomerativeClustering(n_clusters=2, metric="cosine", linkage="average").fit_predict(norm_feats)
    sil_2 = 0.0
    try:
        sil_2 = silhouette_score(norm_feats, labels_2, metric="cosine")
    except Exception:
        pass

    # Evaluate 3-cluster separation if sufficient segments exist
    sil_3 = -1.0
    labels_3 = None
    if len(features) >= 9:
        try:
            labels_3 = AgglomerativeClustering(n_clusters=3, metric="cosine", linkage="average").fit_predict(norm_feats)
            sil_3 = silhouette_score(norm_feats, labels_3, metric="cosine")
        except Exception:
            pass

    # Select optimal speaker clustering
    if sil_3 > 0.12 and sil_3 >= sil_2:
        chosen_labels = labels_3
        num_speakers = 3
    elif sil_2 >= 0.07:
        chosen_labels = labels_2
        num_speakers = 2
    else:
        if len(features) >= 4:
            chosen_labels = labels_2
            num_speakers = 2
        else:
            chosen_labels = np.zeros(len(features), dtype=int)
            num_speakers = 1

    # Canonicalize speaker labels: first speaker to speak is "Speaker 1", next is "Speaker 2"
    speaker_map = {}
    canonical_labels = []
    for lbl in chosen_labels:
        if lbl not in speaker_map:
            speaker_map[lbl] = f"Speaker {len(speaker_map) + 1}"
        canonical_labels.append(speaker_map[lbl])

    print(f"[SegAUD Diarization] Identified {num_speakers} speaker(s) across {total} segments (silhouette={max(sil_2, sil_3):.3f}).", flush=True)

    assigned_segments = []
    feat_ptr = 0
    for idx, seg in enumerate(vad_segments):
        if idx in valid_indices:
            spk = canonical_labels[feat_ptr]
            feat_ptr += 1
        else:
            spk = "Speaker 1"
        assigned_segments.append({**seg, "speaker": spk})

    return assigned_segments


def cluster_segments_acoustically(audio_path: str, vad_segments: List[Dict]) -> List[Dict]:
    """Compatibility alias for diarize_and_assign_speakers."""
    return diarize_and_assign_speakers(audio_path, vad_segments)


def diarize_audio(audio_path: str, token: str = None, vad_segments: List[Dict] = None) -> List[Dict]:
    """Compatibility function returning timestamped speaker turns."""
    if vad_segments:
        clustered = diarize_and_assign_speakers(audio_path, vad_segments, token=token)
        return [{"start": s["start"], "end": s["end"], "speaker": s["speaker"]} for s in clustered]
    return [{"start": 0.0, "end": 999999.0, "speaker": "Speaker 1"}]


def split_multispeaker_segments(audio_path: str, segments: List[Dict]) -> List[Dict]:
    """Inspect each VAD segment (especially longer segments >= 2.5s).
    If a segment contains two distinct speakers (e.g. head belongs to Speaker 1,
    tail belongs to Speaker 2), split it at the transition point / silence dip.
    NEVER merge segments! Only split when a single segment contains two speakers.
    """
    import numpy as np
    import torch
    from vad import _load_wav, SAMPLE_RATE

    if not segments or len(segments) <= 1:
        return segments

    full_wav = _load_wav(audio_path)
    sr = SAMPLE_RATE

    # 1. Compute speaker centroids across already-labeled segments
    spk_features = {}
    for seg in segments:
        s_s = int(seg["start"] * sr)
        e_s = int(seg["end"] * sr)
        clip = full_wav[s_s:e_s]
        if len(clip) >= 1600:
            f = extract_acoustic_features(clip, sr=sr)
            spk = seg.get("speaker", "Speaker 1")
            if spk not in spk_features:
                spk_features[spk] = []
            spk_features[spk].append(f)

    speaker_centroids = {}
    for spk, feats in spk_features.items():
        centroid = np.mean(feats, axis=0)
        norm = np.linalg.norm(centroid)
        if norm > 1e-8:
            centroid /= norm
        speaker_centroids[spk] = centroid

    if len(speaker_centroids) < 2:
        return segments

    spk_keys = list(speaker_centroids.keys())
    spk_A, spk_B = spk_keys[0], spk_keys[1]

    final_segments = []
    split_count = 0

    for seg in segments:
        dur = seg["end"] - seg["start"]
        # Only inspect segments that are long enough to hold two distinct utterances (>= 2.5s)
        if dur < 2.5:
            final_segments.append(seg)
            continue

        s_s = int(seg["start"] * sr)
        e_s = int(seg["end"] * sr)
        clip = full_wav[s_s:e_s]

        # Extract features for head (first 1.2s) and tail (last 1.2s)
        head_len = min(int(1.2 * sr), len(clip) // 2)
        head_clip = clip[:head_len]
        tail_clip = clip[-head_len:]

        if len(head_clip) < 1600 or len(tail_clip) < 1600:
            final_segments.append(seg)
            continue

        f_head = extract_acoustic_features(head_clip, sr=sr)
        f_tail = extract_acoustic_features(tail_clip, sr=sr)

        norm_h = np.linalg.norm(f_head)
        norm_t = np.linalg.norm(f_tail)
        if norm_h > 1e-8:
            f_head = f_head / norm_h
        if norm_t > 1e-8:
            f_tail = f_tail / norm_t

        # Cosine similarity between head and tail
        sim_ht = float(np.dot(f_head, f_tail))

        # Check similarity of head and tail to each speaker centroid
        sim_h_A = float(np.dot(f_head, speaker_centroids[spk_A]))
        sim_h_B = float(np.dot(f_head, speaker_centroids[spk_B]))
        sim_t_A = float(np.dot(f_tail, speaker_centroids[spk_A]))
        sim_t_B = float(np.dot(f_tail, speaker_centroids[spk_B]))

        head_spk = spk_A if sim_h_A >= sim_h_B else spk_B
        tail_spk = spk_A if sim_t_A >= sim_t_B else spk_B

        # If head and tail indicate different speakers AND cosine similarity is distinct (sim_ht < 0.88)
        if head_spk != tail_spk and sim_ht < 0.88:
            # Find the best split point: scan in the middle region [0.8s, dur - 0.8s] for the minimum energy dip
            mid_start = int(0.8 * sr)
            mid_end = int((dur - 0.8) * sr)
            mid_clip = clip[mid_start:mid_end]

            # RMS energy in 80ms frames
            frame_len = int(0.08 * sr)
            hop_len = int(0.04 * sr)
            num_frames = (len(mid_clip) - frame_len) // hop_len

            if num_frames > 0:
                energies = []
                for fi in range(num_frames):
                    sub = mid_clip[fi * hop_len : fi * hop_len + frame_len]
                    energies.append(torch.mean(sub ** 2).item())
                min_idx = int(np.argmin(energies))
                split_offset_sec = 0.8 + (min_idx * hop_len) / sr
            else:
                split_offset_sec = dur / 2.0

            split_time = round(seg["start"] + split_offset_sec, 3)

            # Ensure both halves are at least 0.6s
            if (split_time - seg["start"] >= 0.6) and (seg["end"] - split_time >= 0.6):
                split_count += 1
                seg_a = dict(seg)
                seg_a["end"] = split_time
                seg_a["speaker"] = head_spk

                seg_b = dict(seg)
                seg_b["start"] = split_time
                seg_b["speaker"] = tail_spk

                final_segments.append(seg_a)
                final_segments.append(seg_b)
                continue

        final_segments.append(seg)

    if split_count > 0:
        print(f"[SegAUD Diarization] Intra-segment split: {split_count} multi-speaker segments split.", flush=True)

    return final_segments


def split_and_assign_speakers(
    audio_path: str,
    vad_segments: List[Dict],
    diarization_turns: List[Dict] = None
) -> List[Dict]:
    """Assign speaker labels to VAD segments.
    If PyAnnote diarization turns are available, map them onto segments.
    Otherwise, use acoustic clustering across the segments.
    Preserves all transcripts and segment attributes.
    """
    if not vad_segments:
        return []

    # Check if diarization_turns came from full pyannote pipeline with multiple speakers
    unique_turn_speakers = set(t.get("speaker") for t in (diarization_turns or []))

    if len(unique_turn_speakers) >= 2:
        # PyAnnote multi-speaker mapping: assign predominant speaker for each segment
        final_segments = []
        for seg in vad_segments:
            s_start = seg["start"]
            s_end = seg["end"]
            spk_dur = {}
            for t in diarization_turns:
                overlap = min(s_end, t["end"]) - max(s_start, t["start"])
                if overlap > 0:
                    spk = t["speaker"]
                    spk_dur[spk] = spk_dur.get(spk, 0.0) + overlap
            if spk_dur:
                best_spk = max(spk_dur, key=spk_dur.get)
            else:
                best_spk = "Speaker 1"
            final_segments.append({**seg, "speaker": best_spk})
        return final_segments

    # Acoustic clustering across cohesive sentence segments
    return cluster_segments_acoustically(audio_path, vad_segments)
