@echo off
rem iPad-finder - dobbeltklik for at starte paa Windows.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title iPad-finder

echo.
echo   iPad-finder
echo   -----------
echo   Leder efter Python ...

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

rem Where the Python environment lives. Preferably under LOCALAPPDATA: long
rem folder names from the ZIP could otherwise exceed Windows' 260-character
rem path limit. A working one next to this file (from earlier runs) is reused.
set "VENV=%~dp0.venv"
"%VENV%\Scripts\python.exe" -m pip --version >nul 2>nul
if not errorlevel 1 goto :haveenv
set "VENVROOT=%LOCALAPPDATA%\ipad-finder"
if not defined LOCALAPPDATA set "VENVROOT=%~dp0"
set "VENV=%VENVROOT%\venv"
"%VENV%\Scripts\python.exe" -m pip --version >nul 2>nul
if not errorlevel 1 goto :haveenv
call :makevenv
if errorlevel 1 goto :fail

:haveenv
"%VENV%\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt
if errorlevel 1 goto :fail

"%VENV%\Scripts\python.exe" -m ipad_finder %*
if errorlevel 1 pause
exit /b 0

:makevenv
echo   Gør klar første gang - det tager et minuts tid ...
if not exist "%VENVROOT%" mkdir "%VENVROOT%" >nul 2>nul
%PY% -m venv --clear "%VENV%"
if exist "%VENV%\Scripts\python.exe" exit /b 0
rem Python from the Microsoft Store may silently redirect writes to AppData.
rem Fall back to a folder next to this file.
set "VENV=%~dp0.venv"
%PY% -m venv --clear "%VENV%"
if exist "%VENV%\Scripts\python.exe" exit /b 0
exit /b 1

:nopython
echo   Python 3.9 eller nyere blev ikke fundet.
echo   Hent Python på https://www.python.org/downloads/ og installer det.
echo   Bruger du den klassiske installer, så sæt flueben i "Add python.exe to PATH".
echo   Dobbeltklik derefter på denne fil igen.
start "" "https://www.python.org/downloads/"
pause
exit /b 1

:fail
echo.
echo   Noget gik galt under installationen - se fejlbeskeden ovenfor.
echo   Første start skal hente Bluetooth-biblioteket "bleak", så computeren skal være på internettet.
echo   Hjælper det ikke, så flyt mappen til et kort sted, fx C:\iPad-finder, og prøv igen.
pause
exit /b 1
