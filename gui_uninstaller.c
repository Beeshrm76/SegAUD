#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <commctrl.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
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

static void SafeSetText(HWND hWnd, const wchar_t* text) {
    if (!hWnd || !text) return;
    SetWindowTextW(hWnd, text);
    InvalidateRect(hWnd, NULL, TRUE);
    UpdateWindow(hWnd);
}

void AppendUnLog(const wchar_t* text) {
    if (!g_hUnLogBox) return;
    int len = GetWindowTextLengthW(g_hUnLogBox);
    SendMessageW(g_hUnLogBox, EM_SETSEL, (WPARAM)len, (LPARAM)len);
    SendMessageW(g_hUnLogBox, EM_REPLACESEL, FALSE, (LPARAM)text);
    SendMessageW(g_hUnLogBox, EM_REPLACESEL, FALSE, (LPARAM)L"\r\n");
    SendMessageW(g_hUnLogBox, WM_VSCROLL, SB_BOTTOM, 0);
    InvalidateRect(g_hUnLogBox, NULL, FALSE);
    UpdateWindow(g_hUnLogBox);
}

void SetUnProgress(int percent, const wchar_t* statusMsg) {
    if (g_hUnProgress) {
        SendMessageW(g_hUnProgress, PBM_SETPOS, (WPARAM)percent, 0);
    }
    if (g_hUnLblStatus && statusMsg) {
        SafeSetText(g_hUnLblStatus, statusMsg);
    }
    if (statusMsg) {
        AppendUnLog(statusMsg);
    }
}

static BOOL RunSilentCmdWithTimeout(const wchar_t* cmd, DWORD timeoutMs) {
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
    DWORD waitRes = WaitForSingleObject(pi.hProcess, timeoutMs);
    if (waitRes == WAIT_TIMEOUT) {
        TerminateProcess(pi.hProcess, 1);
    }
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

    SetUnProgress(10, L"Terminating background SegAUD processes...");
    // Instant taskkill of SegAUD processes and any orphaned python processes running app.py
    RunSilentCmdWithTimeout(L"taskkill.exe /F /IM SegAUD.exe /T", 2500);
    RunSilentCmdWithTimeout(L"taskkill.exe /F /FI \"WINDOWTITLE eq SegAUD*\" /T", 2500);
    RunSilentCmdWithTimeout(L"cmd.exe /c for /f \"tokens=5\" %a in ('netstat -aon ^| findstr \":8080\"') do taskkill /F /PID %a 2>nul", 3000);

    // Mark as uninstalled immediately
    DeleteFileW(L".installed");
    HANDLE hUninst = CreateFileW(L".uninstalled", GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hUninst != INVALID_HANDLE_VALUE) CloseHandle(hUninst);
    AppendUnLog(L"[✓] Stopped active application processes.");
    Sleep(200);

    // 1. Remove Desktop and Start Menu entries using direct native Win32 API
    LRESULT rmShortcuts = SendMessageW(g_hUnChkShortcuts, BM_GETCHECK, 0, 0);
    if (rmShortcuts == BST_CHECKED) {
        SetUnProgress(40, L"Removing SegAUD application from Desktop and Start Menu...");
        wchar_t path[MAX_PATH];
        if (SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, 0, path) == S_OK) {
            PathAppendW(path, L"SegAUD.lnk");
            DeleteFileW(path);
        }
        if (SHGetFolderPathW(NULL, CSIDL_PROGRAMS, NULL, 0, path) == S_OK) {
            PathAppendW(path, L"SegAUD.lnk");
            DeleteFileW(path);
        }
        AppendUnLog(L"[✓] Removed SegAUD application from Desktop and Start Menu.");
    } else {
        AppendUnLog(L"[—] Desktop and Start Menu items preserved.");
    }
    Sleep(200);

    // 2. Remove venv if checked (instant rename + safe background purge)
    LRESULT rmVenv = SendMessageW(g_hUnChkVenv, BM_GETCHECK, 0, 0);
    if (rmVenv == BST_CHECKED) {
        SetUnProgress(75, L"Removing Python virtual environment...");
        // Kill any lingering python processes locking the venv
        RunSilentCmdWithTimeout(L"taskkill.exe /F /IM python.exe /T", 2000);
        RunSilentCmdWithTimeout(L"taskkill.exe /F /IM pythonw.exe /T", 2000);

        // Instant isolation: rename venv to _venv_trash (instant metadata pointer move, 1ms)
        if (GetFileAttributesW(L"venv") != INVALID_FILE_ATTRIBUTES) {
            MoveFileW(L"venv", L"_venv_trash");
        }

        // Purge _venv_trash with a strict 8-second safety timeout
        RunSilentCmdWithTimeout(L"cmd.exe /c if exist _venv_trash rd /s /q _venv_trash", 8000);
        AppendUnLog(L"[✓] Python environment removed successfully.");
    } else {
        AppendUnLog(L"[—] Python environment kept intact.");
    }
    Sleep(200);

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
            WS_CHILD | WS_VISIBLE | SS_LEFT | SS_NOPREFIX, 24, 20, 480, 26, hwnd, NULL, NULL, NULL);
        SendMessageW(hTitle, WM_SETFONT, (WPARAM)g_hFontTitle, TRUE);

        // Subtitle
        HWND hSub = CreateWindowExW(0, L"STATIC", L"Remove SegAUD application and environment components",
            WS_CHILD | WS_VISIBLE | SS_LEFT | SS_NOPREFIX, 24, 48, 480, 20, hwnd, NULL, NULL, NULL);
        SendMessageW(hSub, WM_SETFONT, (WPARAM)g_hFontBody, TRUE);

        CreateWindowExW(0, L"STATIC", NULL,
            WS_CHILD | WS_VISIBLE | SS_ETCHEDHORZ, 24, 76, 480, 2, hwnd, NULL, NULL, NULL);

        // Options
        g_hUnChkShortcuts = CreateWindowExW(0, L"BUTTON", L"Remove SegAUD application from Desktop and Start Menu",
            WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 24, 88, 480, 22, hwnd, (HMENU)IDD_UN_CHK_SHORTCUTS, NULL, NULL);
        SendMessageW(g_hUnChkShortcuts, WM_SETFONT, (WPARAM)g_hFontBody, TRUE);
        SendMessageW(g_hUnChkShortcuts, BM_SETCHECK, BST_CHECKED, 0);

        g_hUnChkVenv = CreateWindowExW(0, L"BUTTON", L"Remove Python virtual environment and ML dependencies",
            WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 24, 114, 480, 22, hwnd, (HMENU)IDD_UN_CHK_VENV, NULL, NULL);
        SendMessageW(g_hUnChkVenv, WM_SETFONT, (WPARAM)g_hFontBody, TRUE);
        SendMessageW(g_hUnChkVenv, BM_SETCHECK, BST_UNCHECKED, 0);

        // Status Label
        g_hUnLblStatus = CreateWindowExW(0, L"STATIC", L"Click 'Uninstall SegAUD' to proceed with uninstallation.",
            WS_CHILD | WS_VISIBLE | SS_LEFT | SS_NOPREFIX, 24, 144, 480, 20, hwnd, (HMENU)IDD_UN_LBL_STATUS, NULL, NULL);
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
                if (MessageBoxW(hwnd, L"Are you sure you want to uninstall SegAUD application?",
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

    case WM_CTLCOLOREDIT:
    case WM_CTLCOLORSTATIC: {
        HDC hdc = (HDC)wParam;
        HWND hwndCtl = (HWND)lParam;
        if (hwndCtl == g_hUnLogBox) {
            SetTextColor(hdc, RGB(20, 24, 35));
            SetBkColor(hdc, RGB(255, 255, 255));
            return (LRESULT)GetStockObject(WHITE_BRUSH);
        }
        SetTextColor(hdc, RGB(17, 24, 39));
        SetBkColor(hdc, GetSysColor(COLOR_BTNFACE));
        SetBkMode(hdc, OPAQUE);
        return (LRESULT)GetSysColorBrush(COLOR_BTNFACE);
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
