import copy
import io
import os
import re
import sys
import warnings
from pathlib import Path
import torch

# Suppress harmless PyTorch multiprocessing and HuggingFace generation warnings
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", message=".*Redirects are currently not supported.*")
warnings.filterwarnings("ignore", message=".*max_new_tokens.*")
warnings.filterwarnings("ignore", message=".*generation_config.*")
warnings.filterwarnings("ignore", message=".*clean_up_tokenization_spaces.*")

# Ensure UTF-8 stdout on Windows console safely without closing streams
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REPO = "ARTPARK-IISc/SraVaani-1.0"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
ASR_THREADS = 4

_model_obj = None
_model_type = None  # "sravaani" or "whisper"


def clean_transcript(text: str) -> str:
    """Sanitize transcript, collapse repetitive loops and strip silence noise."""
    if not text:
        return ""
    t = text.strip()
    # Remove repetitive punctuation like " . . . . . "
    if re.match(r'^[ ._,\-;:!?]+$', t):
        return ""
    # Collapse repetitive word loops (e.g. "word word word" or "दिदिदिदि...")
    t = re.sub(r'([^\s]+(?:\s+[^\s]+){0,3}?)\s*(?:(?:\1|\b\1\b)[.,;!?\- ]*){2,}', r'\1', t, flags=re.IGNORECASE)
    # Collapse character repeating loops > 3 times (e.g. "दिदिदिदिदिदि...")
    t = re.sub(r'(..+?)\1{3,}', r'\1\1', t)
    t = re.sub(r'\s{2,}', ' ', t).strip()
    return t


def get_model(token: str = None):
    """Lazy load SraVaani-1.0 with HF token, or fallback to high-quality Whisper Base Devanagari."""
    global _model_obj, _model_type
    if _model_obj is not None:
        return _model_obj, _model_type

    access_token = token or os.environ.get("HF_TOKEN")
    if not access_token:
        try:
            import huggingface_hub
            access_token = huggingface_hub.get_token()
        except Exception:
            pass

    # 1. Attempt loading ARTPARK-IISc/SraVaani-1.0 if HF access token is provided
    if access_token:
        try:
            from transformers import AutoModel
            print(f"[SegAUD ASR] Attempting to load {REPO} on {DEVICE}...", flush=True)
            model = AutoModel.from_pretrained(
                REPO,
                trust_remote_code=True,
                token=access_token,
            ).to(DEVICE).eval()
            _model_obj = model
            _model_type = "sravaani"
            print("[SegAUD ASR] SraVaani-1.0 loaded successfully.", flush=True)
            return _model_obj, _model_type
        except Exception as exc:
            print(f"[SegAUD ASR] Note: SraVaani-1.0 requires approved access ({exc}). Using Whisper Devanagari.", flush=True)

    # 2. High-performance Whisper Base in Devanagari (vastly higher accuracy than Tiny)
    try:
        from transformers import AutoProcessor, WhisperForConditionalGeneration
        model_name = "openai/whisper-base"
        print(f"[SegAUD ASR] Initializing PyTorch Whisper-Base engine for Devanagari transcription...", flush=True)
        processor = AutoProcessor.from_pretrained(model_name)
        model = WhisperForConditionalGeneration.from_pretrained(model_name).to(DEVICE).eval()
        _model_obj = (processor, model)
        _model_type = "whisper"
        print(f"[SegAUD ASR] PyTorch Whisper-Base engine ready on {DEVICE}.", flush=True)
        return _model_obj, _model_type
    except Exception as e2:
        print(f"[SegAUD ASR] Fallback error: {e2}", flush=True)
        raise e2


def _hyp_text(hyp) -> str:
    """Handle both Hypothesis objects (.text) and plain strings."""
    return hyp if isinstance(hyp, str) else getattr(hyp, "text", str(hyp))


def transcribe(audio_path: str, token: str = None, lang: str = "hi", domain: str = "") -> str:
    """Transcribe an audio clip using SraVaani or Whisper into authentic Devanagari script."""
    torch.set_num_threads(ASR_THREADS)
    model_obj, model_type = get_model(token=token)

    if model_type == "sravaani":
        with torch.inference_mode():
            hyps = model_obj.transcribe(str(audio_path), return_hypotheses=True)
        if not isinstance(hyps, (list, tuple)):
            hyps = [hyps]
        raw = "\n".join(_hyp_text(h) for h in hyps).strip()
        return clean_transcript(raw)
    else:
        # Load audio into memory as float32 array
        import soundfile as sf
        try:
            data, sr = sf.read(str(audio_path), dtype="float32")
        except Exception:
            import av
            import numpy as np
            container = av.open(str(audio_path))
            resampler = av.audio.resampler.AudioResampler(format="fltp", layout="mono", rate=16000)
            chunks = []
            for frame in container.decode(audio=0):
                for rf in resampler.resample(frame):
                    chunks.append(rf.to_ndarray())
            for rf in resampler.resample(None):
                chunks.append(rf.to_ndarray())
            container.close()
            data = np.concatenate(chunks, axis=1).squeeze(0)
            sr = 16000

        if data.ndim > 1:
            data = data.mean(axis=1)

        # Skip silence / near zero energy clips (< 0.003 RMS)
        rms = float((data ** 2).mean() ** 0.5) if len(data) > 0 else 0.0
        if len(data) == 0 or rms < 0.003:
            return ""

        processor, model = model_obj
        input_features = processor(data, sampling_rate=sr, return_tensors="pt").input_features.to(DEVICE)

        # Build clean generation config with no conflicting arguments
        gen_config = copy.deepcopy(model.generation_config)
        gen_config.language = "hi"
        gen_config.task = "transcribe"
        gen_config.max_new_tokens = 220
        gen_config.max_length = None
        gen_config.no_repeat_ngram_size = 3
        try:
            gen_config.forced_decoder_ids = processor.get_decoder_prompt_ids(language="hi", task="transcribe")
        except Exception:
            pass

        # Domain-aware prompt conditioning to guide Devanagari script output
        prompt_text = f"यह {domain or 'अवधी और हिंदी'} भाषा में बातचीत और संवाद है।"
        try:
            raw_p_ids = processor.get_prompt_ids(prompt_text)
            p_ids = torch.tensor(raw_p_ids, dtype=torch.long).to(DEVICE)
        except Exception:
            p_ids = None

        with torch.no_grad():
            gen_kwargs = {"generation_config": gen_config}
            if p_ids is not None:
                gen_kwargs["prompt_ids"] = p_ids
            predicted_ids = model.generate(input_features, **gen_kwargs)

        raw = processor.batch_decode(
            predicted_ids,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False
        )[0].strip()

        # If model outputs Latin transliteration, convert directly to authentic Devanagari script
        if raw and not re.search(r'[\u0900-\u097F]', raw):
            try:
                from indic_transliteration import sanscript
                raw = sanscript.transliterate(raw.lower(), sanscript.ITRANS, sanscript.DEVANAGARI)
            except Exception:
                pass

        return clean_transcript(raw)


def get_active_model_info():
    """Return info about current model."""
    return {
        "device": DEVICE,
        "repo": REPO if _model_type == "sravaani" else "openai/whisper-base (Devanagari)",
        "model_type": _model_type or "pending",
        "has_token": bool(os.environ.get("HF_TOKEN"))
    }
