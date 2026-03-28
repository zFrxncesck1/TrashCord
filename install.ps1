# StyleTranslate - Vencord Plugin Installer
# Run with: Right-click -> Run with PowerShell
# Or: powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # Makes downloads faster

$PLUGIN_REPO  = "https://github.com/Myarcer/vencord-styletranslate"
$PLUGIN_NAME  = "styleTranslate"
$BUILD_DIR    = "$env:TEMP\styleTranslate_build"
$VENCORD_DIST = "$env:APPDATA\Vencord\dist"
$VENCORD_CFG  = "$env:APPDATA\Vencord\settings\settings.json"

function Write-Step($msg) { Write-Host "`n  >> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "`n  [ERROR] $msg" -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }
function Write-Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }

Clear-Host
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Magenta
Write-Host "   StyleTranslate - Vencord Plugin Installer" -ForegroundColor Magenta
Write-Host "  ============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  This installer will automatically:"
Write-Host "    - Install Node.js if missing"
Write-Host "    - Install Git if missing"
Write-Host "    - Install pnpm if missing"
Write-Host "    - Build and deploy the plugin"
Write-Host ""
Write-Host "  Press Enter to start, or Ctrl+C to cancel."
Read-Host

# ── Check Vencord ───────────────────────────────────────────
Write-Step "Checking Vencord installation..."
if (-not (Test-Path "$VENCORD_DIST\renderer.js")) {
    Write-Err "Vencord is not installed. Install it first from https://vencord.dev"
}
Write-OK "Vencord found at $VENCORD_DIST"

# ── Helper: install via winget ───────────────────────────────
function Install-WithWinget($id, $name) {
    Write-Host "  Installing $name via winget..." -ForegroundColor Yellow
    winget install --id $id --silent --accept-source-agreements --accept-package-agreements
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# ── Helper: install via direct download ─────────────────────
function Install-NodeJS {
    Write-Host "  Downloading Node.js LTS..." -ForegroundColor Yellow
    $nodeUrl = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
    $nodeMsi = "$env:TEMP\nodejs_installer.msi"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi
    Write-Host "  Installing Node.js silently..."
    Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /quiet /norestart" -Wait
    Remove-Item $nodeMsi -Force
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Install-Git {
    Write-Host "  Downloading Git..." -ForegroundColor Yellow
    $gitUrl = "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe"
    $gitExe = "$env:TEMP\git_installer.exe"
    Invoke-WebRequest -Uri $gitUrl -OutFile $gitExe
    Write-Host "  Installing Git silently..."
    Start-Process $gitExe -ArgumentList "/VERYSILENT /NORESTART /NOCANCEL /SP-" -Wait
    Remove-Item $gitExe -Force
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# ── Check / install Node.js ──────────────────────────────────
Write-Step "Checking Node.js..."
$nodeOk = $false
try { $v = (node --version 2>&1); $nodeOk = $LASTEXITCODE -eq 0 } catch {}
if (-not $nodeOk) {
    Write-Warn "Node.js not found. Attempting automatic install..."
    # Try winget first (available on Win10 1809+ / Win11)
    $wingetOk = $false
    try { winget --version >$null 2>&1; $wingetOk = $true } catch {}
    if ($wingetOk) {
        Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
    } else {
        Install-NodeJS
    }
    try { $v = (node --version 2>&1); $nodeOk = $LASTEXITCODE -eq 0 } catch {}
    if (-not $nodeOk) { Write-Err "Node.js install failed. Please install manually from https://nodejs.org then re-run." }
}
Write-OK "Node.js $(node --version)"

# ── Check / install Git ──────────────────────────────────────
Write-Step "Checking Git..."
$gitOk = $false
try { $v = (git --version 2>&1); $gitOk = $LASTEXITCODE -eq 0 } catch {}
if (-not $gitOk) {
    Write-Warn "Git not found. Attempting automatic install..."
    $wingetOk = $false
    try { winget --version >$null 2>&1; $wingetOk = $true } catch {}
    if ($wingetOk) {
        Install-WithWinget "Git.Git" "Git"
    } else {
        Install-Git
    }
    try { $v = (git --version 2>&1); $gitOk = $LASTEXITCODE -eq 0 } catch {}
    if (-not $gitOk) { Write-Err "Git install failed. Please install manually from https://git-scm.com then re-run." }
}
Write-OK "$(git --version)"

# ── Check / install pnpm ─────────────────────────────────────
Write-Step "Checking pnpm..."
$pnpmOk = $false
try { $v = (pnpm --version 2>&1); $pnpmOk = $LASTEXITCODE -eq 0 } catch {}
if (-not $pnpmOk) {
    Write-Host "  Installing pnpm..." -ForegroundColor Yellow
    npm install -g pnpm
    try { $v = (pnpm --version 2>&1); $pnpmOk = $LASTEXITCODE -eq 0 } catch {}
    if (-not $pnpmOk) { Write-Err "pnpm install failed." }
}
Write-OK "pnpm $(pnpm --version)"

# ── Kill Discord ─────────────────────────────────────────────
Write-Step "Stopping Discord..."
Stop-Process -Name discord -Force -ErrorAction SilentlyContinue
Start-Sleep 2
Write-OK "Discord stopped"

# ── Build dir ───────────────────────────────────────────────
Write-Step "Preparing build directory..."
if (Test-Path $BUILD_DIR) { Remove-Item $BUILD_DIR -Recurse -Force }
New-Item -ItemType Directory -Path $BUILD_DIR | Out-Null
Set-Location $BUILD_DIR

# ── Clone plugin ─────────────────────────────────────────────
Write-Step "Cloning plugin source..."
git clone $PLUGIN_REPO plugin --depth=1
if ($LASTEXITCODE -ne 0) { Write-Err "Failed to clone plugin from $PLUGIN_REPO" }
Write-OK "Plugin cloned"

# ── Clone Vencord ────────────────────────────────────────────
Write-Step "Cloning Vencord source (may take ~30 seconds)..."
git clone https://github.com/Vendicated/Vencord.git vencord --depth=1
if ($LASTEXITCODE -ne 0) { Write-Err "Failed to clone Vencord" }
Write-OK "Vencord cloned"

# ── Copy plugin into userplugins ─────────────────────────────
Write-Step "Installing plugin into Vencord..."
$dest = "$BUILD_DIR\vencord\src\userplugins\$PLUGIN_NAME"
New-Item -ItemType Directory -Path $dest | Out-Null
Copy-Item "$BUILD_DIR\plugin\$PLUGIN_NAME\*" $dest -Recurse
Write-OK "Plugin files copied"

# ── pnpm install ─────────────────────────────────────────────
Write-Step "Installing Vencord dependencies..."
Set-Location "$BUILD_DIR\vencord"
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Write-Err "pnpm install failed" }
Write-OK "Dependencies installed"

# ── Build ────────────────────────────────────────────────────
Write-Step "Building Vencord with plugin (may take ~30 seconds)..."
pnpm build
if ($LASTEXITCODE -ne 0) { Write-Err "Build failed - check output above" }
Write-OK "Build complete"

# ── Backup ───────────────────────────────────────────────────
Write-Step "Backing up existing Vencord dist..."
$backup = "$env:APPDATA\Vencord\dist.backup"
if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
Copy-Item $VENCORD_DIST $backup -Recurse
Write-OK "Backup saved to $backup"

# ── Deploy ───────────────────────────────────────────────────
Write-Step "Deploying to Vencord..."
foreach ($f in @("patcher.js","preload.js","renderer.js","renderer.css")) {
    $src = "$BUILD_DIR\vencord\dist\$f"
    if (Test-Path $src) { Copy-Item $src "$VENCORD_DIST\$f" -Force }
}
Write-OK "Files deployed"

# ── Patch settings.json ──────────────────────────────────────
Write-Step "Enabling plugin in Vencord settings..."
try {
    $cfg = Get-Content $VENCORD_CFG -Raw | ConvertFrom-Json
    $cfg.autoUpdate = $false
    if (-not $cfg.plugins.PSObject.Properties[$PLUGIN_NAME]) {
        $cfg.plugins | Add-Member -NotePropertyName $PLUGIN_NAME -NotePropertyValue ([pscustomobject]@{
            enabled = $true
            sendAsMessage = $true
        })
    } else {
        $cfg.plugins.$PLUGIN_NAME.enabled = $true
    }
    $cfg | ConvertTo-Json -Depth 10 | Set-Content $VENCORD_CFG -Encoding UTF8
    Write-OK "Plugin enabled, autoUpdate disabled"
} catch {
    Write-Warn "Could not auto-patch settings - enable StyleTranslate manually in Vencord settings"
}

# ── Done ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "   Installation complete!" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Starting Discord..."
Write-Host ""
Write-Host "  After Discord loads:" -ForegroundColor White
Write-Host "    - Type /translate in any chat" -ForegroundColor White
Write-Host "    - Settings: Vencord > Plugins > StyleTranslate" -ForegroundColor White
Write-Host "      to switch backend (AnythingTranslate / Claude)" -ForegroundColor White
Write-Host ""
Write-Host "  To update later: re-run this installer." -ForegroundColor DarkGray
Write-Host "  To uninstall: restore from $backup" -ForegroundColor DarkGray
Write-Host ""

Start-Process "$env:LOCALAPPDATA\Discord\Update.exe" -ArgumentList "--processStart Discord.exe"
Read-Host "Press Enter to close"
