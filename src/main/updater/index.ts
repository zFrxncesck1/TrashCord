/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { IpcEvents } from "@shared/IpcEvents";
import { ipcMain } from "electron";
import { execSync } from "child_process";
import { writeFile } from "fs/promises";
import { join } from "path";
import { app } from "electron";

import gitRemote from "~git-remote";
import { serializeErrors } from "./common";

function getEquicordDir(): string {
    const userData = app.getPath("userData");
    return join(userData, "..", "Equicord");
}

function killDiscord() {
    if (process.platform !== "win32") return;
    try {
        execSync("taskkill /f /im Discord.exe /im DiscordPTB.exe /im DiscordCanary.exe", { stdio: "ignore" });
        setTimeout(() => {}, 2000);
    } catch (e) {
        console.warn("[TrashCord] Failed to kill Discord processes:", e);
    }
}

async function getLatestCommit() {
    const res = await fetch(`https://api.github.com/repos/${gitRemote}/releases/latest`);
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const data = await res.json();
    const hash = data.name.split(" ").pop();
    return hash;
}

async function getLatestChanges() {
    const res = await fetch(`https://api.github.com/repos/${gitRemote}/releases/latest`);
    if (!res.ok) return [];
    const data = await res.json();
    const hash = data.name.split(" ").pop();
    const commitUrl = `https://api.github.com/repos/${gitRemote}/commits/${hash}`;
    const commitRes = await fetch(commitUrl);
    if (!commitRes.ok) return [];
    const commit = await commitRes.json();
    return [{
        hash: commit.sha.slice(0, 7),
        author: commit.commit.author.name,
        message: commit.commit.message.split("\n")[0]
    }];
}

async function update() {
    const url = `https://github.com/${gitRemote}/releases/latest/download/desktop.asar`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download update: ${res.status}`);
    const buffer = await res.arrayBuffer();

    const target = join(getEquicordDir(), "equicord.asar");

    killDiscord();

    await writeFile(target, Buffer.from(buffer));

    if (process.platform === "win32") {
        try {
            execSync(`start "" "C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe`, { stdio: "ignore" });
        } catch (e) {}
    } else if (process.platform === "darwin") {
        try { execSync("open -a Discord", { stdio: "ignore" }); } catch (e) {}
    } else {
        try { execSync("discord", { stdio: "ignore" }); } catch (e) {}
    }

    return true;
}

if (!IS_UPDATER_DISABLED) {
    ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => `https://github.com/${gitRemote}`));
    ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(() => getLatestChanges()));
    ipcMain.handle(IpcEvents.UPDATE, serializeErrors(() => update()));
} else {
    ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => `https://github.com/${gitRemote}`));
    ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(() => []));
}
