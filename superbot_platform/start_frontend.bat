@echo off
echo ========================================
echo SuperBot Platform - Frontend Dashboard
echo ========================================
echo.
echo Iniciando servidor na porta 3000...
echo Acesse: http://localhost:3000
echo.
cd /d "%~dp0dashboard"
npm run dev
pause
