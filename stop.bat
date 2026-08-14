@echo off
REM ============================================================
REM  SpeakEdge - stop backend (port 8000) + frontend (port 5173)
REM ============================================================
setlocal enabledelayedexpansion
echo Stopping SpeakEdge...

for %%P in (8000 5173) do (
    set "found="
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%%P ^| findstr LISTENING') do (
        if not "%%a"=="0" (
            echo   killing PID %%a on port %%P
            taskkill /F /PID %%a >nul 2>&1
            set "found=1"
        )
    )
    if not defined found echo   nothing listening on port %%P
)

REM Close the named launcher windows if they are still open.
taskkill /F /FI "WINDOWTITLE eq SpeakEdge Backend*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq SpeakEdge Frontend*" >nul 2>&1

echo Done.
