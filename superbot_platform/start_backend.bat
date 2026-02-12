@echo off
echo ========================================
echo SuperBot Platform - Backend API
echo ========================================
echo.
echo Iniciando servidor na porta 8000...
echo Acesse: http://localhost:8000
echo.
cd /d "%~dp0"
.\venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
pause
