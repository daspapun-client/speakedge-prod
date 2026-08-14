@echo off
REM ============================================================
REM  SpeakEdge - start backend + frontend (each in its own window)
REM  Run setup.bat first. Stop everything with stop.bat.
REM ============================================================
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
    echo [ERROR] Backend not set up. Run setup.bat first.
    exit /b 1
)

echo Starting SpeakEdge backend  ^-^> http://localhost:8000/docs
start "SpeakEdge Backend" cmd /k "cd /d "%~dp0backend" && call .venv\Scripts\activate.bat && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

echo Starting SpeakEdge frontend ^-^> http://localhost:5173
start "SpeakEdge Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo ============================================================
echo  Backend:  http://localhost:8000/docs   (Swagger)
echo  Frontend: http://localhost:5173
echo  Two windows opened. Close them or run stop.bat to stop.
echo ============================================================
