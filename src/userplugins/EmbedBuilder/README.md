# EmbedBuilder

A plugin for [Equicord](https://github.com/Equicord/Equicord) that generates Discord embed JSON quickly for use with webhooks or bots.

## Features

- **Quick Embed Generation**: Create embeds with title, description, color, images, and more
- **Field Support**: Generate embeds with custom fields using simple syntax
- **Auto-Copy to Clipboard**: Automatically copies generated JSON (configurable)
- **Color Customization**: Set default color or specify custom hex colors per embed
- **Ready to Use**: Compatible with Discord webhooks, bots, and tools like Discohook

## Usage

### Basic Embed Command
/embedbuild title:"My Title" description:"My description" color:#FF0000

**Optional parameters:**
- `image` - Full-size image URL
- `thumbnail` - Small thumbnail URL  
- `footer` - Footer text

### Embed with Fields Command
/embedfield title:"Server Info" fields:"Members:1,234|Region:US-East|Boost:Level 2"

**Field format:** `Name1:Value1|Name2:Value2|Name3:Value3`

## Finding Image URLs

1. Upload an image to Discord or use any direct image link
2. Right-click the image and select "Copy Link"
3. Paste the URL in the `image` or `thumbnail` parameter

## Settings

Access plugin settings in Equicord Settings > Plugins > EmbedBuilder:

- **Default Color**: Set your preferred default embed color (hex format, e.g., #5865F2)
- **Auto Copy**: Toggle automatic clipboard copying (enabled by default)

## How It Works

The plugin generates properly formatted Discord embed JSON that can be:
1. **Copied to clipboard** automatically (if enabled)
2. **Pasted into webhook tools** like [Discohook](https://discohook.org/)
3. **Used with Discord bots** that accept embed JSON
4. **Sent via webhook URLs** directly

The generated JSON follows Discord's embed structure specification, ensuring compatibility with all Discord embed implementations.

---

**Author**: Mifu | **License**: GPL-3.0