@echo off
REM ============================================================
REM  SpeakEdge - run the Playwright API e2e suite (all 16 modules)
REM  Requires: Node 20+, and a seeded backend running (start.bat).
REM  Usage:
REM    test-e2e.bat                 run everything vs http://127.0.0.1:8000
REM    test-e2e.bat --ui            open the Playwright UI
REM    test-e2e.bat journey         run only tests matching "journey"
REM    set API_BASE_URL=... & test-e2e.bat   target another environment
REM  Any extra arguments are forwarded to "playwright test".
REM ============================================================
setlocal
cd /d "%~dp0e2e"

REM --- Node present? ---
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found on PATH. Install Node 20+ and retry.
    exit /b 1
)

REM --- Install e2e deps on first run ---
if not exist node_modules (
    echo === Installing e2e dependencies ===
    call npm install
    if errorlevel 1 goto :error
)

REM --- Warn if the backend isn't reachable ---
if not defined API_BASE_URL set "API_BASE_URL=http://127.0.0.1:8000"
echo === Target: %API_BASE_URL% ===
curl -s -o nul -m 3 "%API_BASE_URL%/health"
if errorlevel 1 (
    echo [WARN] Could not reach %API_BASE_URL%/health
    echo        Start a seeded backend first via start.bat, or set API_BASE_URL.
)

echo.
echo === Running Playwright e2e suite ===
call npx playwright test %*
if errorlevel 1 goto :error

echo.
echo ============================================================
echo  All tests passed.  Open the report with:  npm run report
echo ============================================================
goto :eof

:error
echo.
echo [ERROR] e2e tests failed or setup errored. See messages above.
echo         HTML report (if generated):  e2e\playwright-report\index.html
cd /d "%~dp0"
exit /b 1
