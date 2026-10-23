# SegAUD — Speech Segmentation & Transcription Toolkit

SegAUD is a specialized, open-source audio segmentation and automatic speech recognition (ASR) workflow designed specifically for **low-resource languages and regional dialects** (such as Awadhi, Bhojpuri, Maithili, and 20+ Indic language variants).

The toolkit brings together **Silero VAD** for voice activity boundary detection and **ARTPARK-IISc / SraVaani ASR** for multilingual speech transcription, offering both an **interactive Web Application / PWA** and a **Python CLI pipeline**.

---

## Key Features

- **Low-Resource Language Focus**: Optimized for regional dialects with custom exception modes for edge-case audio.
- **Strict Standardized Naming Convention**: Audio clips and segment rows are uniformly identified as `<filename>_seg00001`, `<filename>_seg00002`, etc.
- **Compulsory Domain Tagging**: Mandatory domain categorization (e.g., *Agriculture, Healthcare, Oral History, Folk Tales, Education*) included in all generated datasets and CSV exports.
- **Custom Audio Renaming**: Retains original file name by default while allowing users to customize audio stem names prior to processing.
- **Audio Segment Exports**: Export individual segments as `<filename>_seg00001.wav` or package all clips into a downloadable `.zip` archive alongside `segments.csv` and `transcriptions.csv`.
- **Duplicate Project Prevention**: Automatically alerts users if a project with the same name already exists and switches to the existing project without data loss.
- **Two Flexible Run Modes**:
  1. **Web Application & Desktop PWA**: Visual waveform inspection, parameter exception controls, audio preview player, and in-browser exports.
  2. **Python CLI Pipeline**: High-throughput batch processing for servers and workstations.

---

## 1. Web Application & Desktop PWA

The web interface is located in the `docs/` folder and can be accessed directly in any modern browser or installed as a standalone desktop app.

### Running the Web App Locally

Open a terminal in the project root and start a local HTTP server:

```powershell
python -m http.server 8080 --directory docs
```

Then navigate to:
```
http://localhost:8080
```

### Web App Usage Instructions

1. **Top Navigation & App Mode**:
   - Click **Open in app** in the top navigation bar to launch SegAUD in a borderless, dedicated desktop app window (or install as a PWA).
2. **Project Setup & Duplicate Detection**:
   - Navigate to the **Projects** section.
   - Enter a project name (or click the recommended naming tag, e.g., `awadhi_transcription`).
   - Select your target language (Awadhi, Hindi, Bengali, Tamil, etc.).
   - Configure **VAD Parameters**: standard defaults (`threshold=0.5`, `min_speech=250ms`, `min_silence=400ms`, `pad=150ms`, `max_speech=20s`) are applied automatically, or toggle **Custom Exceptions** to override parameters for noisy/dialectal audio.
   - Click **Generate Project**. If a project with that name already exists, SegAUD displays an alert banner and highlights the existing project.
3. **Audio Ingestion & Naming**:
   - In the **Audio Ingestion** dropzone, drop or browse for an audio file (`.wav`, `.mp3`, `.flac`, `.ogg`, `.m4a`).
   - The **Audio File Name** field automatically pre-fills with the file's stem name. Edit this field if you want a custom base name for your segments.
4. **Compulsory Domain**:
   - Enter the **Audio Domain** (e.g., `Agriculture`, `Healthcare`, `Oral History`). This field is compulsory and required to proceed.
5. **Run Segmentation Pipeline**:
   - Click **Run Silero VAD & SraVaani ASR**.
   - SegAUD analyzes the speech energy envelope, identifies segment boundaries, and renders the interactive timeline and inspection table.
6. **Reviewing Transcripts & Audio Playback**:
   - Play audio segments directly in the table using the **Play** button.
   - Enter or edit transcriptions for each segment in the **Transcript** field.
7. **Exporting Data & Audio Clips**:
   - **`WAV`**: Download any individual segment audio clip formatted as `<filename>_seg00001.wav`.
   - **`Export Audio (.zip)`**: Download a `.zip` archive containing all segment `.wav` files plus `segments.csv`.
   - **`segments.csv`**: Export segment boundaries, duration, VAD confidence, and domain.
   - **`transcriptions.csv`**: Export segment IDs, timestamps, transcript text, domain, and verification status.
   - **`Download All Results`**: One-click download of both CSV files and the audio segments ZIP package.

---

## 2. Python CLI Pipeline

### Prerequisites & Setup

- **Python**: 3.10 or 3.11 recommended
- **Hardware**: 16 GB RAM recommended (CPU-first inference)
- **Hugging Face Account**: Access to [`ARTPARK-IISc/SraVaani-1.0`](https://huggingface.co/ARTPARK-IISc/SraVaani-1.0) (gated model; free, auto-approved upon accepting terms on Hugging Face).

#### Installation (PowerShell)

```powershell
# Create and activate virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Upgrade pip and install PyTorch (CPU build)
python -m pip install --upgrade pip
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# Install toolkit dependencies
pip install -r requirements.txt

# Authenticate with Hugging Face (one-time)
hf auth login
```

Alternatively, set your Hugging Face token in the active terminal session:
```powershell
$env:HF_TOKEN = "hf_your_token_here"
```

### Running the PC Desktop Application (Best Version)

Double-click `run_segaud.bat` or run:

```powershell
# Starts the SegAUD Python desktop server and opens the standalone PC window
python app.py
```

- **Features**: Automatically binds PyTorch, Silero VAD, and **ARTPARK-IISc/SraVaani-1.0** ASR to the desktop window.
- **WAV Output**: Writes all `.wav` slices directly to `segments/<audio_name>/`.
- **Instant Playback**: Plays slices straight from disk with the interactive `▶ Play` / `⏸ Pause` buttons.
- **Hugging Face Token**: Paste your HF token into the input box to unlock gated access to SraVaani-1.0.

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

### Output Structure

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

#### CSV Schemas

- **`segments.csv`**:
  ```csv
  segment_id,source,file,start,end,domain
  field_interview_01_seg00001,recording.wav,segments/field_interview_01/field_interview_01_seg00001.wav,0.65,4.2,Agriculture
  ```

- **`transcriptions.csv`**:
  ```csv
  segment_id,source,file,start,end,transcript,domain,verified
  field_interview_01_seg00001,recording.wav,segments/field_interview_01/field_interview_01_seg00001.wav,0.65,4.2,"ई कवन बाति भवा भइया",Agriculture,
  ```

- **`unverified.csv`** (Contains only segments pending verification / `verified = no`):
  ```csv
  segment_id,source,file,start,end,transcript,domain,verified
  field_interview_01_seg00001,recording.wav,segments/field_interview_01/field_interview_01_seg00001.wav,0.65,4.2,"ई कवन बाति भवा भइया",Agriculture,
  ```

---

## Project Structure

```
SegAUD/
├── docs/                      # Web Application & Desktop UI
│   ├── index.html             # Main web dashboard & UI
│   ├── style.css              # Theme tokens, responsive layout, animations
│   ├── app.js                 # UI logic, backend integration, audio playback
│   ├── manifest.json          # Web app manifest for desktop PWA installation
│   ├── sw.js                  # Service worker for offline capability
│   ├── icon.svg               # Vector brand icon
│   ├── icon-192.png           # 192x192 app icon
│   ├── icon-512.png           # 512x512 app icon
│   └── favicon.ico            # Favicon
├── app.py                     # Native PC Desktop Server & API orchestrator
├── run_segaud.bat             # One-click Windows desktop launcher
├── asr.py                     # SraVaani ASR model loader & inference engine
├── vad.py                     # Silero VAD segmentation & audio slicing module
├── main.py                    # Python CLI orchestrator
├── requirements.txt           # Python package dependencies
└── README.md                  # Toolkit documentation
```

---

## Pipeline Parameters & Tuning

| Parameter | Default | Purpose |
| :--- | :--- | :--- |
| `SAMPLE_RATE` | `16000` Hz | Mono 16 kHz standard for speech recognition. |
| `threshold` | `0.50` | Silero VAD probability threshold for speech presence. |
| `min_speech_duration_ms` | `250` ms | Discards brief non-speech acoustic artifacts/clicks. |
| `min_silence_duration_ms` | `400` ms | Merges speech bursts separated by brief pauses. |
| `speech_pad_ms` | `150` ms | Pads audio boundaries to avoid clipping word onsets/coda. |
| `max_speech_duration_s` | `20` s | Prevents overly long clips for optimal CPU memory usage. |

---

## References & Attribution

- **SraVaani Multilingual ASR**: Developed by [ARTPARK-IISc](https://vaani.iisc.ac.in/models/sravaani).
- **Silero VAD**: Pre-trained voice activity detector by [Silero](https://github.com/snakers4/silero-vad).
