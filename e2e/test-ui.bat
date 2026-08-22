@echo off
REM ============================================================
REM  SpeakEdge - run the browser UI automation (headed by default)
REM  Requires: Node 20+, a seeded backend running, and the frontend
REM  dev server running (start.bat starts both).
REM  Usage:
REM    test-ui.bat                 headed Chromium run of the UI suite
REM    test-ui.bat --headed=false  run headless (CI style)
REM    test-ui.bat auth            run only UI tests matching "auth"
REM  Extra arguments are forwarded to "playwright test".
REM ============================================================
setlocal
cd /d "%~dp0e2e"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found on PATH. Install Node 20+ and retry.
    exit /b 1
)

if not exist node_modules (
    echo === Installing e2e dependencies ===
    call npm install
    if errorlevel 1 goto :error
)

REM --- Ensure the Chromium browser binary is present ---
echo === Ensuring Chromium is installed ===
call npx playwright install chromium
if errorlevel 1 goto :error

if not defined API_BASE_URL set "API_BASE_URL=http://127.0.0.1:8000"
if not defined WEB_BASE_URL set "WEB_BASE_URL=http://127.0.0.1:5173"
echo === API: %API_BASE_URL%   WEB: %WEB_BASE_URL% ===

curl -s -o nul -m 3 "%WEB_BASE_URL%"
if errorlevel 1 (
    echo [WARN] Frontend not reachable at %WEB_BASE_URL%
    echo        Start it first via start.bat, or set WEB_BASE_URL.
)

echo.
echo === Running UI automation (headed) ===
call npx playwright test --project=ui --headed %*
if errorlevel 1 goto :error

echo.
echo ============================================================
echo  UI tests passed.  Open the report with:  npm run report
echo ============================================================
goto :eof

:error
echo.
echo [ERROR] UI tests failed or setup errored. See messages above.
echo         HTML report (if generated):  e2e\playwright-report\index.html
cd /d "%~dp0"
exit /b 1
