# FocusMode — Vencord Plugin

Hide the server list, sidebar, and user panel with one click to focus on your chat or call.

## Features

- **Focus Mode button** (⊟/⊞) in the header — hides both guild list and sidebar at once
- **Optional Guild toggle** (G) — hide/show only the server list
- **Optional Sidebar toggle** (S) — hide/show only the sidebar + user panel
- **i18n** — English and Português (BR) language selector in settings
- Smooth CSS transitions

## Preview

| Normal | Focus Mode |
|--------|-----------|
| Full Discord UI | Clean chat-only view |

## Installation

### As a Vencord userplugin

1. Clone this repo into your Vencord `src/userplugins/` folder:

```bash
cd path/to/Vencord/src/userplugins
git clone https://github.com/ferpgshy/vencord-focus-mode.git focusMode
```

2. Build Vencord:

```bash
pnpm build
```

3. Restart Discord (Ctrl+R)

4. Enable **FocusMode** in Settings → Plugins

## Settings

| Setting | Description |
|---------|-------------|
| Language | English / Português (BR) |
| Show Guild Toggle | Adds a separate "G" button to toggle the server list |
| Show Sidebar Toggle | Adds a separate "S" button to toggle the sidebar |

## License

GPL-3.0-or-later — See [Vencord License](https://github.com/Vendicated/Vencord/blob/main/LICENSE)
