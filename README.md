# [<img src="https://github.com/zFrxncesck1/zFrxncesck1/blob/main/host/icons/TrashCord_icon.png" width="40" align="left" alt="TrashCord">](https://github.com/zFrxncesck1/TrashCord) TrashCord

[![Equibop](https://img.shields.io/badge/Equibop-grey?style=flat)](https://github.com/Equicord/Equibop)
[![Tests](https://github.com/Equicord/Equicord/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/Equicord/Equicord/actions/workflows/test.yml)
[![Discord](https://img.shields.io/discord/1173279886065029291.svg?color=768AD4&label=Discord&logo=discord&logoColor=white)](https://equicord.org/discord)

**TrashCord** is an underground fork of Equicord & Vencord, built for those who create without limits.  
Inspired by the **TRASH GANG** – design, music, experimentation.  
No censorship, no arbitrary rules: every plugin is welcome, every idea takes shape.

---

### Included Plugins

All Equicord plugins plus custom ones made for TrashCord.  
Check out the full list in the [`src/plugins`](./src/plugins) folder and the upcoming [`PLUGINS.md`](./PLUGINS.md).

---

## Installation / Uninstallation

### Dependencies
- [Git](https://git-scm.com/download)
- [Node.js LTS](https://nodejs.org/)

Install `pnpm` (may need to run as admin/root):

```shell
npm i -g pnpm
```

> ⚠️ **Important**: After this step, close and reopen your terminal and **do not** run any further commands as admin. Using elevated privileges can mess up your Discord/TrashCord installation.

---

### Clone the repository

```shell
git clone https://github.com/zFrxncesck1/TrashCord
cd TrashCord
```

### Install dependencies and build

```shell
pnpm install --frozen-lockfile
pnpm build
```

### Inject TrashCord into Discord desktop client

```shell
pnpm inject
```

To un-inject:

```shell
pnpm uninject
```

---

## For the web (browser extension)

```shell
pnpm buildWeb
```

You'll find the ZIP file in the `dist` folder. Follow your browser’s guide for installing custom extensions.

---

## Credits

Special thanks to:
- [Vendicated](https://github.com/Vendicated) for creating [Vencord](https://github.com/Vendicated/Vencord)
- [Equicord](https://github.com/Equicord/Equicord) for the solid base
- [TRASH GANG](https://trash-gang.com) for the inspiration and underground

---

## Disclaimer

Discord is trademark of Discord Inc., and solely mentioned for the sake of descriptivity.
Mentioning it does not imply any affiliation with or endorsement by Discord Inc.
Vencord is not connected to Equicord and as such, all donation links go to Vendicated's donation link.

<details>
<summary>Using TrashCord violates Discord's terms of service</summary>

Client modifications are against Discord’s Terms of Service.

There are no known cases of bans for using Vencord/Equicord/TrashCord, but avoid posting screenshots showing the mod in servers that may be hostile to client modifications.
</details>

---

## Development & Contributions

For bug reports or suggestions, use [Issues](https://github.com/zFrxncesck1/TrashCord/issues).

---

**TrashCord – code like a vandal, create like an artist.**
