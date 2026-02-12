@echo off
echo ====================================
echo   SuperBot Platform - Quick Start
echo ====================================
echo.

cd /d "%~dp0"

echo [1/4] Criando ambiente virtual...
if not exist "venv" (
    python -m venv venv
)

echo [2/4] Ativando ambiente...
call venv\Scripts\activate.bat

echo [3/4] Instalando dependencias...
pip install -q fastapi uvicorn[standard] pydantic pydantic-settings python-dotenv sqlalchemy aiosqlite httpx google-genai elevenlabs python-multipart

echo [4/4] Iniciando servidor...
echo.
echo ====================================
echo   API rodando em: http://localhost:8000
echo   Documentacao:   http://localhost:8000/docs
echo ====================================
echo.

python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
