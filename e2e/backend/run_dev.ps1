# Local development launcher (Windows PowerShell).
# 1) python -m venv .venv ; .\.venv\Scripts\Activate.ps1
# 2) pip install -r requirements.txt
# 3) copy .env.example .env
# 4) python -m app.db.seed        # once, seeds admin + demo codes
# 5) .\run_dev.ps1
$env:PYTHONUNBUFFERED = "1"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
