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

rem Clone do git: instala na primeira vez e compila quando o código mudou.
if exist "package.json" (
  node scripts\preparar.mjs
  if errorlevel 1 (
    echo.
    pause
    exit /b 1
  )
)

if not exist "dist\server.mjs" (
  echo.
  echo Arquivo dist\server.mjs não encontrado.
  echo Parece que o iniciar.bat foi aberto de dentro do .zip.
  echo Clique com o botão direito no super-app.zip, escolha "Extrair tudo"
  echo e abra o iniciar.bat da pasta extraída.
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
