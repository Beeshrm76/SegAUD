#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "advapi32.lib")

#define APP_URL L"http://127.0.0.1:8080/"
#define APP_PORT 8080
#define MUTEX_NAME L"Global\\SegAUD_Single_Instance_Mutex_v1"
#define WINDOW_CLASS L"SegAUD_Tray_Window_Class"
#define WM_TRAYICON (WM_USER + 200)

#define IDM_OPEN_APP     2001
#define IDM_OPEN_BROWSER 2002
#define IDM_RESTART      2003
#define IDM_EXIT         2004

static NOTIFYICONDATAW g_nid;
static PROCESS_INFORMATION g_piServer;
static BOOL g_serverStarted = FALSE;
static HWND g_hWnd = NULL;
static HICON g_hAppIcon = NULL;

// Forward declarations
static BOOL CheckPortActive(int port);
static void LaunchDesktopAppWindow(const wchar_t* url);
static BOOL StartServerProcess(void);
static void StopServerProcess(void);
static void ShowTrayNotification(const wchar_t* title, const wchar_t* msg);

// Check if port 8080 is actively listening
static BOOL CheckPortActive(int port) {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        return FALSE;
    }

    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) {
        WSACleanup();
        return FALSE;
    }

    u_long mode = 1; // non-blocking mode
    ioctlsocket(s, FIONBIO, &mode);

    struct sockaddr_in clientService;
    clientService.sin_family = AF_INET;
    clientService.sin_addr.s_addr = inet_addr("127.0.0.1");
    clientService.sin_port = htons((u_short)port);

    connect(s, (SOCKADDR*)&clientService, sizeof(clientService));

    fd_set writeSet;
    FD_ZERO(&writeSet);
    FD_SET(s, &writeSet);

    struct timeval timeout;
    timeout.tv_sec = 0;
    timeout.tv_usec = 400000; // 400ms

    int selectRes = select(0, NULL, &writeSet, NULL, &timeout);
    closesocket(s);
    WSACleanup();

    return (selectRes > 0);
}

// Find Edge or Chrome to launch borderless app window
static void LaunchDesktopAppWindow(const wchar_t* url) {
    const wchar_t* candidate_paths[] = {
        L"%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe",
        L"%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe",
        L"%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
        L"%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
        L"%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"
    };

    wchar_t expanded[MAX_PATH];
    for (size_t i = 0; i < sizeof(candidate_paths) / sizeof(candidate_paths[0]); i++) {
        ExpandEnvironmentStringsW(candidate_paths[i], expanded, MAX_PATH);
        DWORD attr = GetFileAttributesW(expanded);
        if (attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY)) {
            wchar_t cmdLine[1024];
            swprintf(cmdLine, 1024, L"\"%ls\" --app=%ls --window-size=1366,850", expanded, url);

            STARTUPINFOW si;
            PROCESS_INFORMATION pi;
            ZeroMemory(&si, sizeof(si));
            si.cb = sizeof(si);
            ZeroMemory(&pi, sizeof(pi));

            if (CreateProcessW(NULL, cmdLine, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
                CloseHandle(pi.hProcess);
                CloseHandle(pi.hThread);
                return;
            }
        }
    }

    // Fallback: Default browser
    ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
}

// Starts the Python backend server
static BOOL StartServerProcess(void) {
    if (g_serverStarted && g_piServer.hProcess) {
        DWORD exitCode = 0;
        if (GetExitCodeProcess(g_piServer.hProcess, &exitCode) && exitCode == STILL_ACTIVE) {
            return TRUE;
        }
    }

    // Check for venv python or system python
    wchar_t pythonExe[MAX_PATH];
    if (GetFileAttributesW(L"venv\\Scripts\\pythonw.exe") != INVALID_FILE_ATTRIBUTES) {
        wcscpy(pythonExe, L"venv\\Scripts\\pythonw.exe");
    } else if (GetFileAttributesW(L"venv\\Scripts\\python.exe") != INVALID_FILE_ATTRIBUTES) {
        wcscpy(pythonExe, L"venv\\Scripts\\python.exe");
    } else {
        // Search PATH for pythonw or python
        DWORD res = SearchPathW(NULL, L"pythonw.exe", NULL, MAX_PATH, pythonExe, NULL);
        if (res == 0) {
            res = SearchPathW(NULL, L"python.exe", NULL, MAX_PATH, pythonExe, NULL);
        }
        if (res == 0) {
            int ans = MessageBoxW(
                NULL,
                L"SegAUD requires the Python runtime and dependencies.\n\n"
                L"Would you like to run the SegAUD PC Installer (install.bat) now to set up the environment?",
                L"SegAUD — Installation Required",
                MB_YESNO | MB_ICONQUESTION
            );
            if (ans == IDYES) {
                ShellExecuteW(NULL, L"open", L"install.bat", NULL, NULL, SW_SHOWNORMAL);
            }
            return FALSE;
        }
    }

    // Check if app.py exists in current directory
    if (GetFileAttributesW(L"app.py") == INVALID_FILE_ATTRIBUTES) {
        MessageBoxW(
            NULL,
            L"Could not find app.py in the current directory.\n"
            L"Please ensure SegAUD.exe is in the SegAUD project folder.",
            L"SegAUD — Error",
            MB_OK | MB_ICONERROR
        );
        return FALSE;
    }

    wchar_t cmdLine[1024];
    swprintf(cmdLine, 1024, L"\"%ls\" app.py", pythonExe);

    STARTUPINFOW si;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    ZeroMemory(&g_piServer, sizeof(g_piServer));

    DWORD flags = CREATE_NO_WINDOW;
    if (!CreateProcessW(NULL, cmdLine, NULL, NULL, FALSE, flags, NULL, NULL, &si, &g_piServer)) {
        MessageBoxW(
            NULL,
            L"Failed to launch SegAUD server process.",
            L"SegAUD — Error",
            MB_OK | MB_ICONERROR
        );
        return FALSE;
    }

    g_serverStarted = TRUE;
    return TRUE;
}

// Stop backend server
static void StopServerProcess(void) {
    if (g_serverStarted && g_piServer.hProcess) {
        DWORD exitCode = 0;
        if (GetExitCodeProcess(g_piServer.hProcess, &exitCode) && exitCode == STILL_ACTIVE) {
            TerminateProcess(g_piServer.hProcess, 0);
            WaitForSingleObject(g_piServer.hProcess, 1000);
        }
        CloseHandle(g_piServer.hProcess);
        CloseHandle(g_piServer.hThread);
        g_serverStarted = FALSE;
    }
}

// Show balloon notification in system tray
static void ShowTrayNotification(const wchar_t* title, const wchar_t* msg) {
    g_nid.uFlags |= NIF_INFO;
    wcsncpy(g_nid.szInfoTitle, title, sizeof(g_nid.szInfoTitle)/sizeof(wchar_t) - 1);
    wcsncpy(g_nid.szInfo, msg, sizeof(g_nid.szInfo)/sizeof(wchar_t) - 1);
    g_nid.dwInfoFlags = NIIF_INFO;
    Shell_NotifyIconW(NIM_MODIFY, &g_nid);
}

// Window Procedure for Tray messages
static LRESULT CALLBACK WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_TRAYICON: {
            if (LOWORD(lParam) == WM_LBUTTONDBLCLK || LOWORD(lParam) == WM_LBUTTONUP) {
                // Open / bring app window to front
                LaunchDesktopAppWindow(APP_URL);
            } else if (LOWORD(lParam) == WM_RBUTTONUP) {
                POINT pt;
                GetCursorPos(&pt);
                HMENU hMenu = CreatePopupMenu();
                AppendMenuW(hMenu, MF_STRING, IDM_OPEN_APP, L"Open SegAUD App");
                AppendMenuW(hMenu, MF_STRING, IDM_OPEN_BROWSER, L"Open in Web Browser");
                AppendMenuW(hMenu, MF_SEPARATOR, 0, NULL);
                AppendMenuW(hMenu, MF_STRING, IDM_RESTART, L"Restart Backend Server");
                AppendMenuW(hMenu, MF_SEPARATOR, 0, NULL);
                AppendMenuW(hMenu, MF_STRING, IDM_EXIT, L"Exit SegAUD");

                SetForegroundWindow(hWnd);
                int cmd = TrackPopupMenu(hMenu, TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON, pt.x, pt.y, 0, hWnd, NULL);
                DestroyMenu(hMenu);

                if (cmd == IDM_OPEN_APP) {
                    LaunchDesktopAppWindow(APP_URL);
                } else if (cmd == IDM_OPEN_BROWSER) {
                    ShellExecuteW(NULL, L"open", APP_URL, NULL, NULL, SW_SHOWNORMAL);
                } else if (cmd == IDM_RESTART) {
                    StopServerProcess();
                    Sleep(500);
                    if (StartServerProcess()) {
                        ShowTrayNotification(L"SegAUD", L"Backend server restarted.");
                    }
                } else if (cmd == IDM_EXIT) {
                    DestroyWindow(hWnd);
                }
            }
            return 0;
        }

        case WM_COMMAND: {
            return 0;
        }

        case WM_DESTROY: {
            Shell_NotifyIconW(NIM_DELETE, &g_nid);
            StopServerProcess();
            PostQuitMessage(0);
            return 0;
        }
    }
    return DefWindowProcW(hWnd, msg, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    // 1. Set current working directory to directory of this executable
    wchar_t exePath[MAX_PATH];
    if (GetModuleFileNameW(NULL, exePath, MAX_PATH)) {
        wchar_t* lastSlash = wcsrchr(exePath, L'\\');
        if (lastSlash) {
            *lastSlash = L'\0';
            SetCurrentDirectoryW(exePath);
        }
    }

    // 2. Check if SegAUD is already running via Mutex
    HANDLE hMutex = CreateMutexW(NULL, FALSE, MUTEX_NAME);
    DWORD lastErr = GetLastError();
    if (hMutex && lastErr == ERROR_ALREADY_EXISTS) {
        // App is already running! Simply launch / focus app window and exit
        LaunchDesktopAppWindow(APP_URL);
        CloseHandle(hMutex);
        return 0;
    }

    // 3. Register background Window Class for System Tray
    WNDCLASSEXW wc;
    ZeroMemory(&wc, sizeof(wc));
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = WINDOW_CLASS;

    // Load icon
    g_hAppIcon = (HICON)LoadImageW(
        hInstance,
        MAKEINTRESOURCEW(1),
        IMAGE_ICON,
        GetSystemMetrics(SM_CXSMICON),
        GetSystemMetrics(SM_CYSMICON),
        LR_DEFAULTCOLOR
    );
    if (!g_hAppIcon) {
        g_hAppIcon = (HICON)LoadImageW(
            NULL,
            L"docs\\favicon.ico",
            IMAGE_ICON,
            GetSystemMetrics(SM_CXSMICON),
            GetSystemMetrics(SM_CYSMICON),
            LR_LOADFROMFILE
        );
    }
    if (!g_hAppIcon) {
        g_hAppIcon = LoadIconW(NULL, IDI_APPLICATION);
    }
    wc.hIcon = g_hAppIcon;
    wc.hIconSm = g_hAppIcon;

    RegisterClassExW(&wc);

    g_hWnd = CreateWindowExW(
        0, WINDOW_CLASS, L"SegAUD Tray",
        0, 0, 0, 0, 0,
        HWND_MESSAGE, NULL, hInstance, NULL
    );

    // 4. Check if server already listening on 8080 (e.g. run via python console)
    BOOL portActive = CheckPortActive(APP_PORT);
    if (!portActive) {
        if (!StartServerProcess()) {
            if (hMutex) CloseHandle(hMutex);
            return 1;
        }

        // Wait up to 6 seconds for port to become active
        for (int i = 0; i < 30; i++) {
            Sleep(200);
            if (CheckPortActive(APP_PORT)) {
                portActive = TRUE;
                break;
            }
        }
    }

    // 5. Setup Tray Icon
    ZeroMemory(&g_nid, sizeof(g_nid));
    g_nid.cbSize = sizeof(g_nid);
    g_nid.hWnd = g_hWnd;
    g_nid.uID = 1;
    g_nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP | NIF_INFO;
    g_nid.uCallbackMessage = WM_TRAYICON;
    g_nid.hIcon = g_hAppIcon;
    wcsncpy(g_nid.szTip, L"SegAUD — Audio Segmentation Toolkit", sizeof(g_nid.szTip)/sizeof(wchar_t) - 1);
    wcsncpy(g_nid.szInfoTitle, L"SegAUD Running", sizeof(g_nid.szInfoTitle)/sizeof(wchar_t) - 1);
    wcsncpy(g_nid.szInfo, L"SegAUD is active. Click to open app or right-click to exit.", sizeof(g_nid.szInfo)/sizeof(wchar_t) - 1);
    g_nid.dwInfoFlags = NIIF_INFO;

    Shell_NotifyIconW(NIM_ADD, &g_nid);

    // 6. Launch Desktop Window
    LaunchDesktopAppWindow(APP_URL);

    // 7. Message Loop
    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    if (hMutex) CloseHandle(hMutex);
    return (int)msg.wParam;
}
