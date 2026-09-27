@echo off
rem iPad-finder - dobbeltklik for at starte paa Windows.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title iPad-finder

echo.
echo   iPad-finder
echo   -----------

set "PY="
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>nul
  if not errorlevel 1 set "PY=py -3"
)
if not defined PY (
  python -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>nul
  if not errorlevel 1 set "PY=python"
)
if not defined PY goto :nopython

if not exist ".venv\Scripts\python.exe" (
  echo   Gør klar første gang - det tager et minuts tid ...
  %PY% -m venv .venv
  if errorlevel 1 goto :fail
)

".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt
if errorlevel 1 goto :fail

".venv\Scripts\python.exe" -m ipad_finder %*
if errorlevel 1 pause
exit /b 0

:nopython
echo   Python 3.9 eller nyere blev ikke fundet.
echo   Installer Python fra https://www.python.org/downloads/
echo   Husk at sætte flueben i "Add python.exe to PATH" under installationen.
echo   Dobbeltklik derefter på denne fil igen.
start "" "https://www.python.org/downloads/"
pause
exit /b 1

:fail
echo.
echo   Noget gik galt under installationen - se fejlbeskeden ovenfor.
echo   Er du på internettet? Første start skal hente Bluetooth-biblioteket "bleak".
pause
exit /b 1
