@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if %errorlevel% neq 0 (
    echo.
    echo  Something went wrong. See error above.
    pause
)
