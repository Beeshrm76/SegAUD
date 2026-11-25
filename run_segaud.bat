@echo off
chcp 65001 > nul
set PYTHONIOENCODING=utf-8
title SegAUD — Speech Segmentation and Transcription Toolkit
cd /d "%~dp0"

echo ================================================================
echo               SegAUD — Speech Segmentation Toolkit
echo ================================================================
echo.
echo Starting SegAUD PC Desktop Application...

if not exist ".installed" (
    echo.
    echo ================================================================
    echo  [!] SegAUD is currently not installed on this PC.
    echo      Please run Install_SegAUD.exe to set up SegAUD first.
    echo ================================================================
    echo.
    pause
    exit /b 1
)

if exist "venv\Scripts\python.exe" (
    venv\Scripts\python.exe app.py
) else (
    python app.py
)

pause
