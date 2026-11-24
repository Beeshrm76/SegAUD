# Create Windows Desktop & Start Menu Shortcuts for SegAUD
param(
    [string]$TargetDir = $PSScriptRoot
)

if (-not $TargetDir) {
    $TargetDir = (Get-Location).Path
}

$WshShell = New-Object -ComObject WScript.Shell
$ExePath = Join-Path $TargetDir "SegAUD.exe"
if (-not (Test-Path $ExePath)) {
    $ExePath = Join-Path $TargetDir "run_segaud.bat"
}
$IconPath = Join-Path $TargetDir "docs\favicon.ico"

# 1. Desktop Shortcut
$DesktopFolder = [System.Environment]::GetFolderPath('Desktop')
$DesktopLnk = Join-Path $DesktopFolder "SegAUD.lnk"
$Shortcut = $WshShell.CreateShortcut($DesktopLnk)
$Shortcut.TargetPath = $ExePath
$Shortcut.WorkingDirectory = $TargetDir
if (Test-Path $IconPath) {
    $Shortcut.IconLocation = $IconPath
}
$Shortcut.Description = "SegAUD - Audio Segmentation and Transcription Toolkit"
$Shortcut.Save()
Write-Host "[OK] Desktop shortcut created at: $DesktopLnk"

# 2. Start Menu Shortcut
$ProgramsFolder = [System.Environment]::GetFolderPath('Programs')
$StartLnk = Join-Path $ProgramsFolder "SegAUD.lnk"
$Shortcut2 = $WshShell.CreateShortcut($StartLnk)
$Shortcut2.TargetPath = $ExePath
$Shortcut2.WorkingDirectory = $TargetDir
if (Test-Path $IconPath) {
    $Shortcut2.IconLocation = $IconPath
}
$Shortcut2.Description = "SegAUD - Audio Segmentation and Transcription Toolkit"
$Shortcut2.Save()
Write-Host "[OK] Start Menu shortcut created at: $StartLnk"
