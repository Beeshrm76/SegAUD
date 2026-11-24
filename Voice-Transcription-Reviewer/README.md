# Shruti-Lekhan

Shruti (Listening) + Lekhan (Writing). The workbench for transcribing and labeling speech.

## Quick Start

```bash
npm install
npm start
# Open http://localhost:3000
```

For development with auto-reload:
```bash
npm run dev
```

## Usage

1. **Upload** – On the home page, upload:
   - A **CSV file** with columns `voice` (filename) and `transcription`
   - The **audio files** referenced in the CSV (WAV, MP3, OGG, M4A, FLAC)

2. **Review** – Audio plays automatically; edit the transcription in the text box.

3. **Navigate** – Use **Prev / Next** buttons or keyboard shortcuts:
   - `Ctrl/Cmd + S` → Save current transcription
   - `Alt + ←` → Previous record
   - `Alt + →` → Next record
   - `Space` → Play / pause audio (when textarea is not focused)

4. **Save** – Saves edits in memory **and** writes them back to the CSV file immediately.

## CSV Format

```
voice,transcription
audio1.wav,The quick brown fox jumps over the lazy dog.
audio2.mp3,Hello world.
```

## Project Structure

```
version1/
├── server.js          # Main Express app
├── package.json
├── views/
│   └── index.ejs      # Single EJS template (upload + review mode)
├── uploads/           # Auto-created; stores audio + mapping.csv
└── data/
    └── voice_mapping.csv  # Sample CSV reference
```

## Dependencies

| Package | Purpose |
|---|---|
| express | Web server |
| ejs | Templating |
| multer | File uploads |
| csv-parser | Read CSV |
| csv-writer | Write CSV |
| express-session | Track current index |
