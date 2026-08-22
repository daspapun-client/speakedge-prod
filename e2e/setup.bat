@echo off
REM ============================================================
REM  SpeakEdge - one-time setup (backend venv + deps, frontend deps, seed)
REM  Requires: Python 3.12+, Node 20+, and MongoDB running/reachable.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo === [1/4] Backend virtual environment ===
cd backend
if not exist .venv (
    python -m venv .venv
    if errorlevel 1 goto :error
) else (
    echo .venv already exists - reusing it.
)

echo.
echo === [2/4] Installing backend dependencies ===
call .venv\Scripts\python.exe -m pip install --upgrade pip
call .venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto :error

if not exist .env (
    copy .env.example .env >nul
    echo Created backend\.env from .env.example
) else (
    echo backend\.env already exists - leaving it as-is.
)

echo.
echo === [3/4] Seeding database (super-admin + demo activation codes) ===
echo     (Needs MongoDB reachable at MONGO_URI in backend\.env)
call .venv\Scripts\python.exe -m app.db.seed
if errorlevel 1 (
    echo.
    echo [WARN] Seeding failed - is MongoDB running? You can re-run it later with:
    echo        backend\.venv\Scripts\python.exe -m app.db.seed
)
cd ..

echo.
echo === [4/4] Installing frontend dependencies ===
cd frontend
call npm install
if errorlevel 1 goto :error
cd ..

echo.
echo ============================================================
echo  Setup complete. Next:  start.bat
echo  Admin login:  admin@speakedge.in / Admin@12345
echo ============================================================
goto :eof

:error
echo.
echo [ERROR] Setup failed. See the messages above.
cd /d "%~dp0"
exit /b 1
