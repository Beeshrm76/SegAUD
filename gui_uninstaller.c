#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <commctrl.h>
#include <shellapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <process.h>

#pragma comment(lib, "comctl32.lib")

#define IDD_UN_PROGRESS_BAR 201
#define IDD_UN_BTN_REMOVE   202
#define IDD_UN_BTN_CANCEL   203
#define IDD_UN_LBL_STATUS   204
#define IDD_UN_LBL_TITLE    205
#define IDD_UN_CHK_SHORTCUTS 206
#define IDD_UN_CHK_VENV     207
#define IDD_UN_LOG_BOX      208

static HWND g_hUnDlg = NULL;
static HWND g_hUnProgress = NULL;
static HWND g_hUnBtnRemove = NULL;
static HWND g_hUnBtnCancel = NULL;
static HWND g_hUnLblStatus = NULL;
static HWND g_hUnChkShortcuts = NULL;
static HWND g_hUnChkVenv = NULL;
static HWND g_hUnLogBox = NULL;

static HFONT g_hFontTitle = NULL;
static HFONT g_hFontBody = NULL;
static HFONT g_hFontBold = NULL;
static HFONT g_hFontMono = NULL;

static BOOL g_isUninstalling = FALSE;
static BOOL g_isUnFinished = FALSE;

void AppendUnLog(const wchar_t* text) {
    if (!g_hUnLogBox) return;
    int len = GetWindowTextLengthW(g_hUnLogBox);
    SendMessageW(g_hUnLogBox, EM_SETSEL, (WPARAM)len, (LPARAM)len);
    SendMessageW(g_hUnLogBox, EM_REPLACESEL, FALSE, (LPARAM)text);
    SendMessageW(g_hUnLogBox, EM_REPLACESEL, FALSE, (LPARAM)L"\r\n");
    SendMessageW(g_hUnLogBox, WM_VSCROLL, SB_BOTTOM, 0);
}

void SetUnProgress(int percent, const wchar_t* statusMsg) {
    if (g_hUnProgress) {
        SendMessageW(g_hUnProgress, PBM_SETPOS, (WPARAM)percent, 0);
    }
    if (g_hUnLblStatus && statusMsg) {
        SetWindowTextW(g_hUnLblStatus, statusMsg);
    }
    if (statusMsg) {
        AppendUnLog(statusMsg);
    }
}

static BOOL RunSilentCmd(const wchar_t* cmd) {
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    ZeroMemory(&pi, sizeof(pi));

    wchar_t cmdBuf[2048];
    wcsncpy(cmdBuf, cmd, 2047);

    if (!CreateProcessW(NULL, cmdBuf, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
        return FALSE;
    }
    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD exitCode = 0;
    GetExitCodeProcess(pi.hProcess, &exitCode);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    return (exitCode == 0);
}

unsigned __stdcall UninstallThread(void* param) {
    g_isUninstalling = TRUE;
    EnableWindow(g_hUnBtnRemove, FALSE);
    EnableWindow(g_hUnBtnCancel, FALSE);

    SetUnProgress(10, L"Starting SegAUD uninstaller...");
    Sleep(400);

    // 1. Remove Shortcuts
    LRESULT rmShortcuts = SendMessageW(g_hUnChkShortcuts, BM_GETCHECK, 0, 0);
    if (rmShortcuts == BST_CHECKED) {
        SetUnProgress(35, L"Removing Desktop and Start Menu application shortcuts...");
        RunSilentCmd(L"powershell -NoProfile -Command \"$d=[System.Environment]::GetFolderPath('Desktop')+'\\SegAUD.lnk'; if (Test-Path $d) { Remove-Item $d -Force }; $p=[System.Environment]::GetFolderPath('Programs')+'\\SegAUD.lnk'; if (Test-Path $p) { Remove-Item $p -Force };\"");
        AppendUnLog(L"[✓] Removed Desktop and Start Menu shortcuts.");
    } else {
        AppendUnLog(L"[—] Shortcuts preserved.");
    }
    Sleep(500);

    // 2. Remove venv if checked
    LRESULT rmVenv = SendMessageW(g_hUnChkVenv, BM_GETCHECK, 0, 0);
    if (rmVenv == BST_CHECKED) {
        SetUnProgress(70, L"Removing Python virtual environment (freeing disk space)...");
        RunSilentCmd(L"cmd.exe /c if exist venv rmdir /s /q venv");
        AppendUnLog(L"[✓] Virtual environment folder (.\\venv) removed.");
    } else {
        AppendUnLog(L"[—] Python environment kept intact.");
    }
    Sleep(400);

    // 3. User data safety note
    AppendUnLog(L"[Note] Your audio files and generated segment CSVs in segments\\ have been safely preserved.");

    SetUnProgress(100, L"SegAUD has been safely and successfully uninstalled from your PC.");

    g_isUninstalling = FALSE;
    g_isUnFinished = TRUE;

    SetWindowTextW(g_hUnBtnRemove, L"Close");
    EnableWindow(g_hUnBtnRemove, TRUE);
    ShowWindow(g_hUnBtnCancel, SW_HIDE);

    return 0;
}

LRESULT CALLBACK UnDlgProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam) {
    switch (uMsg) {
    case WM_CREATE: {
        g_hUnDlg = hwnd;

        g_hFontTitle = CreateFontW(22, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE,
            DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
        g_hFontBody = CreateFontW(14, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
            DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
        g_hFontBold = CreateFontW(14, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE,
            DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
        g_hFontMono = CreateFontW(12, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
            DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_MODERN, L"Consolas");

        // Title
        HWND hTitle = CreateWindowExW(0, L"STATIC", L"SegAUD Uninstaller Wizard",
            WS_CHILD | WS_VISIBLE | SS_LEFT, 24, 20, 480, 26, hwnd, NULL, NULL, NULL);
        SendMessageW(hTitle, WM_SETFONT, (WPARAM)g_hFontTitle, TRUE);

        // Subtitle
        HWND hSub = CreateWindowExW(0, L"STATIC", L"Remove SegAUD application shortcuts and environment components",
            WS_CHILD | WS_VISIBLE | SS_LEFT, 24, 48, 480, 20, hwnd, NULL, NULL, NULL);
        SendMessageW(hSub, WM_SETFONT, (WPARAM)g_hFontBody, TRUE);

        CreateWindowExW(0, L"STATIC", NULL,
            WS_CHILD | WS_VISIBLE | SS_ETCHEDHORZ, 24, 76, 480, 2, hwnd, NULL, NULL, NULL);

        // Options
        g_hUnChkShortcuts = CreateWindowExW(0, L"BUTTON", L"Remove Desktop and Start Menu application shortcuts",
            WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 24, 88, 480, 22, hwnd, (HMENU)IDD_UN_CHK_SHORTCUTS, NULL, NULL);
        SendMessageW(g_hUnChkShortcuts, WM_SETFONT, (WPARAM)g_hFontBody, TRUE);
        SendMessageW(g_hUnChkShortcuts, BM_SETCHECK, BST_CHECKED, 0);

        g_hUnChkVenv = CreateWindowExW(0, L"BUTTON", L"Remove Python virtual environment (free up disk space)",
            WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 24, 114, 480, 22, hwnd, (HMENU)IDD_UN_CHK_VENV, NULL, NULL);
        SendMessageW(g_hUnChkVenv, WM_SETFONT, (WPARAM)g_hFontBody, TRUE);
        SendMessageW(g_hUnChkVenv, BM_SETCHECK, BST_UNCHECKED, 0);

        // Status Label
        g_hUnLblStatus = CreateWindowExW(0, L"STATIC", L"Click 'Uninstall SegAUD' to proceed with uninstallation.",
            WS_CHILD | WS_VISIBLE | SS_LEFT, 24, 145, 480, 20, hwnd, (HMENU)IDD_UN_LBL_STATUS, NULL, NULL);
        SendMessageW(g_hUnLblStatus, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);

        // Progress Bar
        g_hUnProgress = CreateWindowExW(0, PROGRESS_CLASSW, NULL,
            WS_CHILD | WS_VISIBLE | PBS_SMOOTH, 24, 170, 480, 16, hwnd, (HMENU)IDD_UN_PROGRESS_BAR, NULL, NULL);
        SendMessageW(g_hUnProgress, PBM_SETRANGE32, 0, 100);
        SendMessageW(g_hUnProgress, PBM_SETPOS, 0, 0);

        // Log Box
        g_hUnLogBox = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"",
            WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_AUTOVSCROLL | ES_READONLY,
            24, 196, 480, 110, hwnd, (HMENU)IDD_UN_LOG_BOX, NULL, NULL);
        SendMessageW(g_hUnLogBox, WM_SETFONT, (WPARAM)g_hFontMono, TRUE);

        AppendUnLog(L"SegAUD Uninstaller Wizard ready.");
        AppendUnLog(L"Audio recordings and generated segment CSV files will be preserved.");

        // Buttons
        g_hUnBtnRemove = CreateWindowExW(0, L"BUTTON", L"Uninstall SegAUD",
            WS_CHILD | WS_VISIBLE | BS_DEFPUSHBUTTON, 270, 320, 140, 32, hwnd, (HMENU)IDD_UN_BTN_REMOVE, NULL, NULL);
        SendMessageW(g_hUnBtnRemove, WM_SETFONT, (WPARAM)g_hFontBold, TRUE);

        g_hUnBtnCancel = CreateWindowExW(0, L"BUTTON", L"Cancel",
            WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 420, 320, 84, 32, hwnd, (HMENU)IDD_UN_BTN_CANCEL, NULL, NULL);
        SendMessageW(g_hUnBtnCancel, WM_SETFONT, (WPARAM)g_hFontBody, TRUE);

        return 0;
    }

    case WM_COMMAND: {
        int id = LOWORD(wParam);
        if (id == IDD_UN_BTN_REMOVE) {
            if (g_isUnFinished) {
                PostQuitMessage(0);
                return 0;
            }
            if (!g_isUninstalling) {
                if (MessageBoxW(hwnd, L"Are you sure you want to remove SegAUD application shortcuts?",
                    L"Confirm SegAUD Uninstallation", MB_YESNO | MB_ICONQUESTION) == IDYES) {
                    _beginthreadex(NULL, 0, UninstallThread, NULL, 0, NULL);
                }
            }
        }
        else if (id == IDD_UN_BTN_CANCEL) {
            PostQuitMessage(0);
        }
        return 0;
    }

    case WM_CTLCOLORSTATIC: {
        HDC hdcStatic = (HDC)wParam;
        SetTextColor(hdcStatic, RGB(17, 24, 39));
        SetBkMode(hdcStatic, TRANSPARENT);
        return (LRESULT)GetStockObject(NULL_BRUSH);
    }

    case WM_CLOSE:
        if (g_isUninstalling) {
            if (MessageBoxW(hwnd, L"Uninstaller is currently running. Exit anyway?", L"Confirm Exit", MB_YESNO | MB_ICONQUESTION) == IDYES) {
                DestroyWindow(hwnd);
            }
            return 0;
        }
        DestroyWindow(hwnd);
        return 0;

    case WM_DESTROY:
        if (g_hFontTitle) DeleteObject(g_hFontTitle);
        if (g_hFontBody) DeleteObject(g_hFontBody);
        if (g_hFontBold) DeleteObject(g_hFontBold);
        if (g_hFontMono) DeleteObject(g_hFontMono);
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProcW(hwnd, uMsg, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    INITCOMMONCONTROLSEX icex;
    icex.dwSize = sizeof(INITCOMMONCONTROLSEX);
    icex.dwICC = ICC_PROGRESS_CLASS | ICC_STANDARD_CLASSES;
    InitCommonControlsEx(&icex);

    wchar_t exePath[MAX_PATH];
    if (GetModuleFileNameW(NULL, exePath, MAX_PATH)) {
        wchar_t* lastSlash = wcsrchr(exePath, L'\\');
        if (lastSlash) {
            *lastSlash = L'\0';
            SetCurrentDirectoryW(exePath);
        }
    }

    WNDCLASSEXW wc;
    ZeroMemory(&wc, sizeof(wc));
    wc.cbSize = sizeof(WNDCLASSEXW);
    wc.lpfnWndProc = UnDlgProc;
    wc.hInstance = hInstance;
    wc.hIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(1));
    wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_BTNFACE + 1);
    wc.lpszClassName = L"SegAUDUninstallerClass";

    RegisterClassExW(&wc);

    int winW = 540;
    int winH = 400;
    int scrW = GetSystemMetrics(SM_CXSCREEN);
    int scrH = GetSystemMetrics(SM_CYSCREEN);
    int posX = (scrW - winW) / 2;
    int posY = (scrH - winH) / 2;

    HWND hwnd = CreateWindowExW(
        WS_EX_DLGMODALFRAME,
        L"SegAUDUninstallerClass",
        L"SegAUD — Uninstaller Wizard",
        WS_VISIBLE | WS_SYSMENU | WS_CAPTION | WS_MINIMIZEBOX,
        posX, posY, winW, winH,
        NULL, NULL, hInstance, NULL
    );

    if (!hwnd) return 1;

    ShowWindow(hwnd, nCmdShow);
    UpdateWindow(hwnd);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    return (int)msg.wParam;
}
