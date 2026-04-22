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

import { execSync } from "child_process";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { IpcEvents } from "@shared/IpcEvents";
import { ipcMain, shell } from "electron";
import gitRemote from "~git-remote";
import { serializeErrors } from "./common";
import { Updater } from "./Updater";
import { getEquicordDir } from "../utils";

function killDiscord() {
    if (process.platform !== "win32") return;
    try {
        execSync("taskkill /f /im Discord.exe /im DiscordPTB.exe /im DiscordCanary.exe", { stdio: "ignore" });
        setTimeout(() => {}, 2000);
    } catch (e) {
        console.warn("[Equicord] Failed to kill Discord processes:", e);
    }
}

class HttpUpdater extends Updater {
    async getLatestCommit() {
        const res = await fetch(`https://api.github.com/repos/${gitRemote}/releases/latest`);
        if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
        const data = await res.json();
        const hash = data.name.split(" ").pop();
        return hash;
    }

    async getLatestChanges() {
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

    async update() {
        const url = `https://github.com/${gitRemote}/releases/latest/download/desktop.asar`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to download update: ${res.status}`);
        const buffer = await res.arrayBuffer();

        const target = join(getEquicordDir(), "equicord.asar");

        killDiscord();

        await writeFile(target, Buffer.from(buffer));

        if (process.platform === "win32") {
            execSync(`start "" "C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe`, { stdio: "ignore" });
        } else if (process.platform === "darwin") {
            execSync("open -a Discord", { stdio: "ignore" });
        } else {
            execSync("discord", { stdio: "ignore" });
        }

        return true;
    }
}

const updater = new HttpUpdater();

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => `https://github.com/${gitRemote}`));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(() => updater.getLatestChanges()));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(() => updater.update()));
