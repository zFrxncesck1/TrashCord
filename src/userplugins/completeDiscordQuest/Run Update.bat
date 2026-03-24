@echo off
:: ============================================================================
:: completeDiscordQuest Vencord Plugin Updater
:: Double-click this file to update the plugin
:: ============================================================================

title completeDiscordQuest Plugin Updater

echo ============================================
echo    completeDiscordQuest Vencord Plugin Updater
echo ============================================
echo.

:: Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

:: Check if the PowerShell script exists
if not exist "%SCRIPT_DIR%_update-script.ps1" (
    echo [ERROR] _update-script.ps1 not found in %SCRIPT_DIR%
    echo Please ensure _update-script.ps1 is in the same folder as this batch file.
    pause
    exit /b 1
)

:: Check if PowerShell Core (pwsh) is available, otherwise use Windows PowerShell
where pwsh >nul 2>&1
if %errorlevel% equ 0 (
    echo Using PowerShell Core...
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%_update-script.ps1"
) else (
    echo Using Windows PowerShell...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%_update-script.ps1"
)

:: Check if script was successful
if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] Plugin updated successfully!
    echo.
    echo Starting Discord...
    
    :: Try to find and launch Discord
    if exist "%LOCALAPPDATA%\Discord\Update.exe" (
        start "" "%LOCALAPPDATA%\Discord\Update.exe" --processStart Discord.exe
    ) else if exist "%APPDATA%\Discord\Update.exe" (
        start "" "%APPDATA%\Discord\Update.exe" --processStart Discord.exe
    ) else if exist "%PROGRAMFILES%\Discord\Discord.exe" (
        start "" "%PROGRAMFILES%\Discord\Discord.exe"
    ) else (
        echo [WARNING] Could not find Discord installation.
        echo Please start Discord manually.
    )
    
    timeout /t 3 >nul
) else (
    echo.
    echo [ERROR] Script exited with error code: %errorlevel%
    echo Discord will not be started.
    echo.
    pause
)
