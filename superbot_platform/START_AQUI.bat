@echo off
echo ================================================
echo    SuperBot Platform - Inicializacao Completa
echo ================================================
echo.
echo Abrindo duas janelas:
echo   1. Backend API (porta 8000)
echo   2. Frontend Dashboard (porta 3000)
echo.
echo Credenciais de teste:
echo   Usuario: admin
echo   Senha:   admin123
echo.
echo ================================================

cd /d "%~dp0"

:: Inicia backend em nova janela (usa python -m para evitar erro de launcher)
start "SuperBot Backend" cmd /k ".\venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

:: Aguarda 3 segundos
timeout /t 3 /nobreak > nul

:: Inicia frontend em nova janela
start "SuperBot Frontend" cmd /k "cd dashboard && npm run dev"

:: Aguarda mais 5 segundos
timeout /t 5 /nobreak > nul

:: Abre o navegador
echo.
echo Abrindo navegador...
start http://localhost:3000

echo.
echo Servidores iniciados! Pressione qualquer tecla para fechar esta janela.
echo (Os servidores continuarao rodando nas outras janelas)
pause > nul
