# DiscordStreamArchiver
Vencord Plugin that archives voice chats / streams done via discord

# REQUIRES VESKTOP WITH CUSTOM VENCORD INSTALL

See https://docs.vencord.dev/installing/ and https://vesktop.dev/

## Installation

Assuming you have the above fully installed and wired up as given by the instructions in the link

```
cd vencord
cd src
mkdir userplugins
cd userplugins
git clone https://github.com/max2fly/DiscordStreamArchiver.git
cd ../..
pnpm build
```

## Features

- Select output directory (default: videos/DiscordArchive)
- Auto record when joining a whitelisted channel (right click: Auto Record)
- Auto record when a specific user joins (right click: Auto Record)
- Auto stop recording when the user was gone for X seconds
- Resolution Selection (720p / 1080p / 1440p)
- Framerate selection (15 / 24 / 30 / 60 fps)
- Bitrate selection
- Codec Selection (VP9 / VP8 / AV1)
- Bake channel chat directly into the video
- Toggleability of microphone recording while muted
- Audio capture method (In theory should work without vesktop but requires a lot of manual setup with vbchannels)
- Allow recording of a specific stream and auto end upon stream conclusion
- Output format selection (webp / mkv (suggested) / mp4 (sharing clips on discord))
- Ffmpeg path (requires install, follow the directions in the tooltip)
- Keep webp recording on conclusion (technical limitation which requires that the recording itself is in webp and converted in post)
- Time limit for the recording
- Glowing overlay around the stream

---
## Behavior

- Records the streams at native resolution
- Records channel chat
- Supports embeds/animated emojis.
- Visually records message edits
- Loads embeds natively
- Allows for recording of chat even if the chatbox is opened
- Allows for usage of discord while recording
- Support multistream recording
- Chat events exported as a csv and jsonl

---

# Untested Behaviors

- Linux/Mac support (Should work but untested)
- Non Vesktop support (Do note that vesktop is required for innate opus voice recording)
- Long recordings (Stress test required)
- High volume chat (Stress test required)

# Known bugs

- Auto subscribe doesn't subscribe to all streams, only to the right most one (Triaged)
- Multi-stream compacts into small boxes (Not planned to fix)
