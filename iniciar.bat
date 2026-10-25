@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js não encontrado.
  echo Instale o Node.js 22 ou superior em https://nodejs.org e tente de novo.
  echo.
  pause
  exit /b 1
)

if not exist "dist\server.mjs" (
  echo.
  echo Arquivo dist\server.mjs não encontrado.
  echo Descompacte o arquivo .zip inteiro antes de abrir este programa.
  echo.
  pause
  exit /b 1
)

node dist\server.mjs %*
if errorlevel 1 (
  echo.
  echo O Super-app parou com erro. Veja a mensagem acima.
  pause
)
