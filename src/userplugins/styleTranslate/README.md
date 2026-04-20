# StyleTranslate — Vencord Plugin

Translate your Discord messages into fun styles before sending.
Uses **AnythingTranslate** (free, no account needed) or your local **Claude Code** installation.

---

## Styles

| Style | Example |
|---|---|
| 🏴‍☠️ **Pirate** | *Arr, this be a test message, ye scallywag!* |
| 📜 **Shakespeare** | *Hark! This doth be a missive of trial, forsooth.* |
| 👽 **Yoda** | *A test message, this is. Hmm.* |
| 💍 **Gollum** | *We wants to test it, precious. Yesss we does.* |
| 🐱 **UwU** | *dis is a test meowssage >w<* |
| 🦕 **Caveman** | *Me send test. Fire good.* |
| ⚔️ **Medieval English** | *Prithee, attend to this missive of trial, good knight.* |
| 📖 **Old English** | *Þis is a test ærendgewrit.* |
| 🎩 **Formal English** | *I would like to formally submit this as a test communication.* |
| 📱 **Gen Z** | *no cap this is a test message fr fr* |
| 💅 **Valley Girl** | *Oh my god, like, this is totally a test message!* |

---

## Install

> **Requires [Vencord](https://vencord.dev) to already be installed. Nothing else.**

1. Download `INSTALL.bat` and `install.ps1` from this repo into the same folder
2. Double-click `INSTALL.bat`
3. Done — the installer handles everything automatically:
   - Installs Node.js, Git, and pnpm if missing
   - Clones Vencord + this plugin, builds, deploys
   - Enables the plugin in your Vencord settings
   - Relaunches Discord

## Update

Double-click `update.bat` anytime to pull the latest version, rebuild, and redeploy. Discord restarts automatically.

---

## Usage

Type `/translate` in any Discord channel → pick a style → type your message.
The translated result is sent as **your** message (visible to everyone).

---

## Settings

**Vencord → Plugins → StyleTranslate**

| Setting | Options |
|---|---|
| **Backend** | `AnythingTranslate` *(default)* — free, no setup required / `Claude` — uses local [Claude Code](https://claude.ai/code) CLI |
| **Send as message** | On = sends as your real message · Off = only you see the result |

---

## How it works

**AnythingTranslate backend** — sends a request to [anythingtranslate.com](https://anythingtranslate.com), a free community translation site. No account, no API key, works for anyone.

**Claude backend** — runs `claude -p` on your local machine via the Claude Code CLI. Requires Claude Code installed and logged in. Uses the Haiku model to keep usage low.

Vencord plugin architecture:
- `index.ts` — runs inside Discord (slash command, UI, settings)
- `native.ts` — runs in Node.js (web scrape or local claude spawn)

---

## Uninstall

Restore `%AppData%\Vencord\dist.backup` or reinstall Vencord normally.
