@echo off
setlocal
title Grand Theft Aura - local server
cd /d "%~dp0"
set PORT=8090
set PAGE=index.html
if /I "%~1"=="studio" set PAGE=studio.html

echo.
echo  Grand Theft Aura  -  http://localhost:%PORT%/index.html
echo  Aura Studio       -  http://localhost:%PORT%/studio.html
echo  Close this window (or press Ctrl+C) to stop the server.
echo.

where npx >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%/%PAGE%"
  npx --yes http-server -p %PORT% -c-1
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%/%PAGE%"
  py -3 -m http.server %PORT%
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%/%PAGE%"
  python -m http.server %PORT%
  goto :eof
)
echo  Could not find Node.js or Python.
pause
