@echo off
REM Neon Clash - launcher
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 ( node server.js & goto :eof )

for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_*") do (
  for /d %%N in ("%%D\node-*") do (
    if exist "%%N\node.exe" ( "%%N\node.exe" server.js & goto :eof )
  )
)
echo Could not find Node.js. Open a NEW terminal and run:  npm start
pause
