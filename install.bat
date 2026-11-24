@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
set PYTHONIOENCODING=utf-8
title SegAUD — Automated PC Installation & Setup

cd /d "%~dp0"
set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

cls
echo ===============================================================================
echo                SegAUD — Speech Segmentation & Transcription Toolkit
echo                          PC Automated Setup & Installer
echo ===============================================================================
echo.

:: -------------------------------------------------------------------------
:: 1. Check for Python Installation
:: -------------------------------------------------------------------------
echo [1/6] Checking for Python installation...

set "PYTHON_CMD="

where python >nul 2>&1
if !errorlevel! equ 0 (
    set "PYTHON_CMD=python"
) else (
    where py >nul 2>&1
    if !errorlevel! equ 0 (
        set "PYTHON_CMD=py -3"
    )
)

if not defined PYTHON_CMD (
    echo.
    echo [ERROR] Python was not found in your system PATH!
    echo.
    echo SegAUD requires Python 3.9, 3.10, 3.11, 3.12, or 3.13.
    echo Please download and install Python from:
    echo   https://www.python.org/downloads/
    echo.
    echo IMPORTANT: During Python setup, make sure to check:
    echo   [X] "Add python.exe to PATH"
    echo.
    set /p OPEN_PY="Open Python download page in browser now? (Y/N): "
    if /i "!OPEN_PY!"=="Y" (
        start https://www.python.org/downloads/
    )
    echo.
    echo Press any key to exit installer...
    pause > nul
    exit /b 1
)

for /f "tokens=*" %%v in ('%PYTHON_CMD% --version 2^>^&1') do set "PY_VER=%%v"
echo       Detected: !PY_VER!
echo.

:: -------------------------------------------------------------------------
:: 2. Setup / Verify Virtual Environment
:: -------------------------------------------------------------------------
echo [2/6] Setting up Python virtual environment (venv)...

if exist "venv\Scripts\python.exe" (
    echo       Virtual environment already exists at .\venv
) else (
    echo       Creating clean virtual environment in .\venv...
    %PYTHON_CMD% -m venv venv
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to create virtual environment.
        echo Please ensure python-venv is available.
        pause
        exit /b 1
    )
    echo       Virtual environment successfully created.
)
echo.

:: -------------------------------------------------------------------------
:: 3. Upgrade Pip and Install Dependencies
:: -------------------------------------------------------------------------
echo [3/6] Installing machine learning & audio dependencies...
echo       (PyTorch, Silero VAD, SoundFile, Transformers, HuggingFace Hub)
echo.

"venv\Scripts\python.exe" -m pip install --upgrade pip setuptools wheel --quiet
if !errorlevel! neq 0 (
    echo [WARNING] Could not upgrade pip. Continuing with package installation...
)

echo       Installing from requirements.txt (this may take a couple minutes)...
"venv\Scripts\python.exe" -m pip install -r requirements.txt
if !errorlevel! neq 0 (
    echo.
    echo [ERROR] Encountered an error installing requirements.
    echo Please check your internet connection and try running install.bat again.
    pause
    exit /b 1
)
echo       Dependencies verified and up to date!
echo.

:: -------------------------------------------------------------------------
:: 4. Verify Output Folders & Assets
:: -------------------------------------------------------------------------
echo [4/6] Verifying project directories and models...
if not exist "segments" mkdir segments
if not exist "uploads" mkdir uploads
echo       Directories ready.
echo.

:: -------------------------------------------------------------------------
:: 5. Compile / Verify Standalone Launcher Executable (SegAUD.exe)
:: -------------------------------------------------------------------------
echo [5/6] Verifying SegAUD.exe desktop application launcher...

where gcc >nul 2>&1
if !errorlevel! equ 0 (
    where windres >nul 2>&1
    if !errorlevel! equ 0 (
        if exist "launcher.c" (
            echo       Compiling native Windows launcher binary with embedded icon...
            windres segaud.rc -O coff -o segaud.res >nul 2>&1
            gcc -O2 -mwindows launcher.c segaud.res -o SegAUD.exe -lws2_32 -lshell32 -luser32 -ladvapi32 >nul 2>&1
        )
    )
)

if exist "SegAUD.exe" (
    echo       SegAUD.exe desktop executable verified [OK].
) else (
    echo [WARNING] Native SegAUD.exe binary not found. run_segaud.bat can still be used.
)
echo.

:: -------------------------------------------------------------------------
:: 6. Create Windows Desktop and Start Menu Shortcuts
:: -------------------------------------------------------------------------
echo [6/6] Creating Desktop and Start Menu shortcuts...

set "TARGET_EXE=%ROOT_DIR%\SegAUD.exe"
if not exist "%TARGET_EXE%" set "TARGET_EXE=%ROOT_DIR%\run_segaud.bat"
set "ICON_FILE=%ROOT_DIR%\docs\favicon.ico"

if exist "create_shortcuts.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File create_shortcuts.ps1 "%ROOT_DIR%"
) else (
    powershell -NoProfile -Command ^
      "$WshShell = New-Object -ComObject WScript.Shell; " ^
      "$DesktopPath = [System.Environment]::GetFolderPath('Desktop'); " ^
      "$DeskLnk = $WshShell.CreateShortcut(\"$DesktopPath\SegAUD.lnk\"); " ^
      "$DeskLnk.TargetPath = '%TARGET_EXE%'; " ^
      "$DeskLnk.WorkingDirectory = '%ROOT_DIR%'; " ^
      "if (Test-Path '%ICON_FILE%') { $DeskLnk.IconLocation = '%ICON_FILE%'; }; " ^
      "$DeskLnk.Description = 'SegAUD - Audio Segmentation and Transcription Toolkit'; " ^
      "$DeskLnk.Save(); " ^
      "$ProgramsPath = [System.Environment]::GetFolderPath('Programs'); " ^
      "$StartLnk = $WshShell.CreateShortcut(\"$ProgramsPath\SegAUD.lnk\"); " ^
      "$StartLnk.TargetPath = '%TARGET_EXE%'; " ^
      "$StartLnk.WorkingDirectory = '%ROOT_DIR%'; " ^
      "if (Test-Path '%ICON_FILE%') { $StartLnk.IconLocation = '%ICON_FILE%'; }; " ^
      "$StartLnk.Description = 'SegAUD - Audio Segmentation and Transcription Toolkit'; " ^
      "$StartLnk.Save();"
    echo       [OK] Desktop and Start Menu Shortcuts created.
)
echo.

:: -------------------------------------------------------------------------
:: Completion Banner
:: -------------------------------------------------------------------------
echo ===============================================================================
echo              ✓ SegAUD Installation Finished Successfully!
echo ===============================================================================
echo.
echo You can now launch SegAUD anytime using:
echo   1. Desktop Shortcut: "SegAUD"
echo   2. Start Menu: Search for "SegAUD"
echo   3. Direct Executable: SegAUD.exe
echo.
set /p LAUNCH_NOW="Would you like to launch SegAUD now? (Y/N) [default: Y]: "
if "%LAUNCH_NOW%"=="" set "LAUNCH_NOW=Y"
if /i "%LAUNCH_NOW%"=="Y" (
    echo.
    echo Launching SegAUD...
    if exist "SegAUD.exe" (
        start "" "SegAUD.exe"
    ) else (
        start "" "run_segaud.bat"
    )
)

echo.
echo Setup finished.
timeout /t 3 > nul
exit /b 0
