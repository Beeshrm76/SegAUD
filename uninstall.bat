@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
title SegAUD — Uninstaller

cd /d "%~dp0"
echo ===============================================================================
echo                           SegAUD — Uninstaller
echo ===============================================================================
echo.
echo This will remove SegAUD application entries from Desktop and Start Menu.
echo It will NOT delete your audio recordings or output segments.
echo.
set /p CONFIRM="Are you sure you want to proceed? (Y/N): "
if /i not "!CONFIRM!"=="Y" (
    echo Operation cancelled.
    timeout /t 2 > nul
    exit /b 0
)

taskkill /F /IM SegAUD.exe 2>nul
if exist ".installed" del /f /q ".installed" >nul 2>&1
type nul > ".uninstalled" >nul 2>&1

powershell -NoProfile -Command ^
  "$DesktopPath = [System.Environment]::GetFolderPath('Desktop'); " ^
  "$DeskLnk = Join-Path $DesktopPath 'SegAUD.lnk'; " ^
  "if (Test-Path $DeskLnk) { Remove-Item $DeskLnk -Force; Write-Host 'Removed Desktop Entry.'; }; " ^
  "$ProgramsPath = [System.Environment]::GetFolderPath('Programs'); " ^
  "$StartLnk = Join-Path $ProgramsPath 'SegAUD.lnk'; " ^
  "if (Test-Path $StartLnk) { Remove-Item $StartLnk -Force; Write-Host 'Removed Start Menu Entry.'; };"

echo.
echo SegAUD application removed successfully.
timeout /t 3 > nul
exit /b 0
