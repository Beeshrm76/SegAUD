# SegAUD — Speech Segmentation, Speaker Diarization & Transcription Toolkit

SegAUD is a specialized, open-source audio segmentation, speaker diarization, and automatic speech recognition (ASR) toolkit designed specifically for **low-resource languages and regional dialects** (such as Awadhi, Bhojpuri, Maithili, Hindi, and 20+ Indic language variants).

The toolkit unites **Silero VAD** for voice activity boundary detection, **pyannote.audio** for speaker diarization and turn-splitting, and **Devanagari ASR** (OpenAI Whisper-Base, Whisper-Small, ARTPARK-IISc SraVaani-1.0, and custom Hugging Face models), offering both an **interactive Web Application / PWA / PC App** and a **Python CLI pipeline**.

---

## Key Features

- **Low-Resource Language Focus**: Optimized for regional dialects with custom exception modes for edge-case audio.
- **pyannote Speaker Diarization & Turn-Splitting**: Automatically detects speaker turns and splits segments where multiple speakers talk into distinct sub-segments labeled `Speaker 1`, `Speaker 2`, etc.
- **Configurable Models & Credentials (⚙️ Settings)**:
  - Hugging Face token stored securely in `localStorage` by default (unlocks gated models like SraVaani-1.0 and pyannote community pipelines).
  - Add custom Hugging Face model repositories (e.g. *Whisper Large v3*, *IndicWav2Vec Hindi*, *Meta MMS 1B*) code-free.
  - Dynamic model selector dropdown before the `▶ Run` button automatically reflects all configured models.
  - Clear workspace data button to reset audio, segments, and table results in one click.
- **Strict Standardized Naming Convention**: Audio clips and segment rows are uniformly identified as `<filename>_seg00001`, `<filename>_seg00002`, etc.
- **Compulsory Domain Tagging**: Mandatory domain categorization (e.g., *Agriculture, Healthcare, Oral History, Folk Tales, Education*) included in all generated datasets and CSV exports.
- **Verification Workflow**:
  - `✓ Verify All` one-click toggle in the results table.
  - Plain-text `speaker` column in all CSV exports (`segments.csv`, `transcriptions.csv`, `unverified.csv`) with zero HTML or styling tags.
  - Export separate `unverified.csv` for targeted human review.
- **Expandable / Collapsible Documentation**: Component Feature Comparison matrix can be collapsed or expanded to keep the workspace streamlined.
- **Two Flexible Run Modes**:
  1. **PC Desktop Application & Web PWA**: Visual waveform inspection, parameter exception controls, audio preview player, direct CSV exports, and local Python server integration.
  2. **Python CLI Pipeline**: High-throughput batch processing for servers and workstations.

---

## 1. Web Application & Desktop PC App

The web interface is located in the `docs/` folder and can be accessed directly in any modern browser or launched as a native standalone desktop app window.

### Running the PC Desktop Application (Recommended)

Double-click `run_segaud.bat` or run:

```powershell
python app.py
```

- **Features**: Automatically binds PyTorch, Silero VAD, pyannote diarization, and Devanagari ASR to a clean desktop window.
- **Local Audio Storage**: Slices audio segments directly into `segments/<audio_name>/`.
- **Instant Playback**: Plays sliced WAV files straight from disk with interactive `▶ Play` / `⏸ Pause` buttons.
- **Model Credentials**: Click **⚙️ Settings** in the top navigation bar to save your Hugging Face token or add custom models.

---

## 2. Python CLI Pipeline

### Prerequisites & Setup

- **Python**: 3.11, 3.12, or 3.13
- **Hardware**: CPU-first inference supported; CUDA auto-detected when available.
- **Hugging Face Account**: Access to Hugging Face models (e.g., [`pyannote/speaker-diarization-community-1`](https://huggingface.co/pyannote/speaker-diarization-community-1), [`ARTPARK-IISc/SraVaani-1.0`](https://huggingface.co/ARTPARK-IISc/SraVaani-1.0)).

#### Installation (PowerShell)

```powershell
# Create and activate virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install PyTorch
pip install torch torchaudio soundfile

# Install pyannote.audio & SegAUD dependencies
pip install pyannote.audio transformers accelerate av
```

Set your Hugging Face token in your environment (optional, or configure via ⚙️ Settings in the app):
```powershell
$env:HF_TOKEN = "hf_your_token_here"
```

### Running via Terminal CLI (Batch Mode)

Execute `main.py` directly from PowerShell / terminal:

```powershell
# Process one or more audio files via CLI
python main.py "C:\path\recording1.wav" "C:\path\recording2.mp3"

# Interactive CLI mode
python main.py
```

#### Interactive CLI Prompts:
1. **Audio Domain (Compulsory)**: Enter domain (e.g. `Agriculture`, `Healthcare`).
2. **Audio File Name**: Press Enter to keep default file name or specify a custom stem name.

---

## Output Structure

For each processed audio file, SegAUD creates an isolated output folder under `segments/`:

```
segments/
└── <audio_name>/
    ├── <audio_name>_seg00001.wav
    ├── <audio_name>_seg00002.wav
    ├── <audio_name>_seg00003.wav
    ├── segments.csv
    ├── transcriptions.csv
    └── unverified.csv
```

### CSV Schemas (Plain Text Columns)

- **`segments.csv`**:
  ```csv
  segment_id,source,file,start,end,speaker,domain
  interview_01_seg00001,recording.wav,segments/interview_01/interview_01_seg00001.wav,0.65,4.2,Speaker 1,Agriculture
  ```

- **`transcriptions.csv`**:
  ```csv
  segment_id,source,file,start,end,speaker,transcript,domain,verified
  interview_01_seg00001,recording.wav,segments/interview_01/interview_01_seg00001.wav,0.65,4.2,Speaker 1,"ई कवन बाति भवा भइया",Agriculture,
  ```

- **`unverified.csv`** (Contains only segments pending verification / `verified = no`):
  ```csv
  segment_id,source,file,start,end,speaker,transcript,domain,verified
  interview_01_seg00001,recording.wav,segments/interview_01/interview_01_seg00001.wav,0.65,4.2,Speaker 1,"ई कवन बाति भवा भइया",Agriculture,
  ```

---

## Project Structure

```
SegAUD/
├── docs/                      # Web Application & Desktop UI
│   ├── index.html             # Dashboard UI, Settings Modal & Model Selector
│   ├── style.css              # Dark theme styling, speaker badges & modal layout
│   ├── app.js                 # UI logic, Settings manager, table rendering & exports
│   ├── manifest.json          # Web app manifest for desktop PWA installation
│   ├── sw.js                  # Service worker for offline capability (v12)
│   ├── icon.svg               # Vector brand icon
│   ├── icon-192.png           # 192x192 app icon
│   ├── icon-512.png           # 512x512 app icon
│   └── favicon.ico            # Favicon
├── app.py                     # Native PC Desktop Server & API orchestrator (port 8080)
├── run_segaud.bat             # One-click Windows desktop launcher
├── diarization.py             # pyannote speaker diarization & turn-splitting engine
├── asr.py                     # Devanagari ASR inference engine (Whisper / SraVaani)
├── vad.py                     # Silero VAD segmentation & audio slicing module
├── main.py                    # Python pipeline orchestrator (VAD -> Diarize -> ASR -> CSVs)
├── requirements.txt           # Python package dependencies
└── README.md                  # Toolkit documentation
```

---

## References & Attribution

- **pyannote.audio**: Neural speaker diarization by [pyannote](https://github.com/pyannote/pyannote-audio).
- **OpenAI Whisper**: Speech recognition by [OpenAI](https://github.com/openai/whisper).
- **SraVaani Multilingual ASR**: Multilingual Indic speech recognition developed by [ARTPARK-IISc](https://vaani.iisc.ac.in/models/sravaani).
- **Silero VAD**: Pre-trained voice activity detector by [Silero](https://github.com/snakers4/silero-vad).
