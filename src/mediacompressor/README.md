# MediaCompressor 📸

An unofficial [Vencord](http://vencord.dev/) plugin to compress large video files directly in Discord, bypassing upload limits before sending.

The plugin adds a per-video toggle beside the existing attachment toolbar actions, which, once enabled, compresses the video with [MediaBunny loaded from jsDelivr CDN.](https://www.jsdelivr.com/package/npm/mediabunny)

While the plugin allows for video compression of any video, compressing videos that are far above Discord's upload limit down to fit within the limit will have diminishing returns, resulting in significant quality loss in both visuals and audio, and making the video look really bad. **Recommended range for compression is within 1x to 5x of your upload limit.**

### It is also strongly recommended that you enable Hardware Acceleration! 🚨

To enable it, open your Discord settings, then App Settings → Advanced → **Hardware Acceleration** and turn that on. This will use your computer's discrete graphics card (if available) to run Discord, and therefore also the video compression.

> ### ⚠️ Important Caveat:
>
> The plugin uses a best-effort solution to disable Discord's Nitro upsell when a large file is uploaded by temporarily disguising large files before they're uploaded.
>
> This trick may not always work, since Discord can change how uploads work at any time. For now, you'll see some debug messages while this is happening (with `Debug Logging` enabled), just in case something changes or doesn't work as expected.

## Installation Guide:

Since this is an unofficial plugin, you must install the **developer version of Vencord.** As such, the process is a bit more convoluted, designed to not be accessible by average or non-technical users.

<details>

<summary>❓ <b><i>If you don't have developer Vencord already installed, here's how to do it.</b></i></summary>

> ### ‼️ Before you proceed
>
> You are about to use a custom user plugin with the developer version of Vencord. As such, it means there is **no guarantee the plugin will always be stable, polished, or behave exactly as expected.** Things can break. Updates can change things. If something goes wrong, that’s on you.
>
> The official Vencord developers **do not provide support** for issues related to the developer version of Vencord or custom user plugins. If it breaks your setup, crashes Discord, or causes other problems, you’re expected to figure it out yourself or report it here.
>
> **Do your homework. Read the code if you can. Make sure you understand what you’re installing.**
>
> By continuing, you’re choosing to run this anyway. But honestly since you're here, you probably don't care much about potentially causing nuclear war by using this or other user plugins. Just keep your eyes peeled.

### Prerequisites

You must have the following tools installed in order to start the installation proces:

- [Git](https://git-scm.com/install)
- [Node.js](https://nodejs.org/en/download/)
- [pnpm](https://pnpm.io/installation)

Follow the installation instructions on their respective websites if you don't have them installed yet. Verify the installation by using these 3 commands, and seeing if you get a version number for each:

```
git --version
node --version
pnpm --version
```

### Cloning Vencord

Pick a convenient folder that you can remember, for example your `Documents` folder. Open a terminal and point it to the desired folder:

```
cd Documents
```

Then, clone the Vencord repository into that folder by running:

```
git clone https://github.com/Vendicated/Vencord
```

Point your terminal to the newly cloned Vencord folder:

```
cd Vencord
```

And finally, install Vencord's dependencies by running:

```
pnpm install --frozen-lockfile
```

**You now have access to Vencord's source code, to which we'll add this plugin! 🎉** You're now free to proceed to the actual plugin installation.

</details>

### Plugin Installation:

Go to where you have installed Vencord's source code if you're not already there (we'll take the previous example):

```
cd Documents/Vencord
```

Create a `userplugins` directory in `src` by running this command:

```
mkdir src/userplugins
```

Then, clone the source code of this plugin into the newly created `userplugins` directory.

```
git clone https://github.com/StraiFRBLX/mediacompressor.git src/userplugins/mediaCompressor
```

And finally, build the developer version and inject Vencord via `pnpm`!

```
pnpm build --dev
pnpm inject
```

Afterwards, select your installation directory with arrow keys, and press Enter.

**And you're finished! 🎉 You can now open Discord, and enable the `MediaCompressor` plugin.**
