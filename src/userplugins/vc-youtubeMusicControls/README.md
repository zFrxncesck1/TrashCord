# YouTube Music Controls (Vencord Plugin)

Vencord plugin to control YouTube Music from Discord with synchronized lyrics.

## Preview

<div align="center">
  <img src="https://github.com/user-attachments/assets/6ca1c943-9fd5-4683-9811-850fdc32ba3f" alt="YouTube Music Player Controls" width="320"/>
  <img src="https://github.com/user-attachments/assets/2dd25da5-e85d-40b5-b1bd-bff76541c008" alt="Synchronized Lyrics Modal" width="480"/>
  
  <br>
  
  *Player controls (left) and lyrics modal (right)*
</div>

## Features

- Play/pause, skip, previous, shuffle, repeat, lyrics
- Seek bar and volume control
- Real-time synchronized lyrics that auto-scroll
- Adjustable lyric timing
- Show/hide controls on hover
- Album art and song info

## Requirements

1. [Vencord](https://vencord.dev/)
2. [Pear Desktop](https://github.com/pear-devs/pear-desktop) with API server enabled

### Setup Pear Desktop

- Download from [releases](https://github.com/pear-devs/pear-desktop/releases/latest)
- Open Plugins → API Server
- Enable API server and set port to **26538** (or any custom port but change it as well in the plugin's settings).

## Installation

For plugin installation instructions, please refer to the official Vencord documentation:
**[Installing Custom Plugins](https://docs.vencord.dev/installing/custom-plugins/)**

## Usage

Just play music in Pear Desktop and the controls will appear in Discord. Right-click for more options.

## Credits

Built from:

- [vc-spotifylyrics](https://github.com/Masterjoona/vc-spotifylyrics) by @Masterjoona - Lyrics functionality
- [Vencord music-controls-ytm](https://github.com/Johannes7k75/Vencord/tree/feat/music-controls-ytm) by @Johannes7k75 - YTM controls
- [Pear Desktop](https://github.com/pear-devs/pear-desktop) - API server

Lyrics from [lrclib.net](https://lrclib.net/)
