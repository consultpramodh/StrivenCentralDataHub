@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo STRIVEN CENTRAL DATA HUB R1 - AUTO UPDATE
echo ============================================================
echo.
where node.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not on PATH.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)
node.exe AUTO_UPDATE_HUB_R1.js
set RC=%ERRORLEVEL%
echo.
if not "%RC%"=="0" (
  echo AUTO UPDATE DID NOT COMPLETE.
  echo Review the output above. No uncertain state is accepted.
) else (
  echo AUTO UPDATE VERIFIED COMPLETE.
)
echo.
pause
exit /b %RC%
