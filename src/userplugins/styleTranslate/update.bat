@echo off
setlocal enabledelayedexpansion
title StyleTranslate - Update

set "PLUGIN_REPO=https://github.com/Myarcer/vencord-styletranslate"
set "PLUGIN_NAME=styleTranslate"
set "VENCORD_DIST=%APPDATA%\Vencord\dist"
set "BUILD_DIR=%TEMP%\styleTranslate_build"

echo  Updating StyleTranslate...
taskkill /f /im discord.exe >nul 2>&1
timeout /t 2 /nobreak >nul

if exist "%BUILD_DIR%" rmdir /s /q "%BUILD_DIR%"
mkdir "%BUILD_DIR%"
cd /d "%BUILD_DIR%"

git clone "%PLUGIN_REPO%" plugin --depth=1
git clone https://github.com/Vendicated/Vencord.git vencord --depth=1
mkdir "%BUILD_DIR%\vencord\src\userplugins\%PLUGIN_NAME%"
xcopy /e /i /q "%BUILD_DIR%\plugin\%PLUGIN_NAME%\*" "%BUILD_DIR%\vencord\src\userplugins\%PLUGIN_NAME%\"
cd /d "%BUILD_DIR%\vencord"
pnpm install --frozen-lockfile
pnpm build

copy /y "%BUILD_DIR%\vencord\dist\patcher.js" "%VENCORD_DIST%\patcher.js" >nul
copy /y "%BUILD_DIR%\vencord\dist\preload.js" "%VENCORD_DIST%\preload.js" >nul
copy /y "%BUILD_DIR%\vencord\dist\renderer.js" "%VENCORD_DIST%\renderer.js" >nul
copy /y "%BUILD_DIR%\vencord\dist\renderer.css" "%VENCORD_DIST%\renderer.css" >nul

echo  Done! Launching Discord...
start "" "%LOCALAPPDATA%\Discord\Update.exe" --processStart Discord.exe
