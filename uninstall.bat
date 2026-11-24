@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
title SegAUD — Remove Shortcuts & Cleanup

cd /d "%~dp0"
echo ===============================================================================
echo                      SegAUD — Uninstall / Shortcut Removal
echo ===============================================================================
echo.
echo This will remove the SegAUD Desktop shortcut and Start Menu shortcut.
echo It will NOT delete your audio recordings or output segments.
echo.
set /p CONFIRM="Are you sure you want to proceed? (Y/N): "
if /i not "!CONFIRM!"=="Y" (
    echo Operation cancelled.
    timeout /t 2 > nul
    exit /b 0
)

powershell -NoProfile -Command ^
  "$DesktopPath = [System.Environment]::GetFolderPath('Desktop'); " ^
  "$DeskLnk = Join-Path $DesktopPath 'SegAUD.lnk'; " ^
  "if (Test-Path $DeskLnk) { Remove-Item $DeskLnk -Force; Write-Host 'Removed Desktop Shortcut.'; }; " ^
  "$ProgramsPath = [System.Environment]::GetFolderPath('Programs'); " ^
  "$StartLnk = Join-Path $ProgramsPath 'SegAUD.lnk'; " ^
  "if (Test-Path $StartLnk) { Remove-Item $StartLnk -Force; Write-Host 'Removed Start Menu Shortcut.'; };"

echo.
echo SegAUD shortcuts removed successfully.
timeout /t 3 > nul
exit /b 0
