# TokenCopier

A plugin for [Equicord](https://github.com/Equicord/Equicord) that allows you to copy your Discord token from the settings menu or via command.

## ⚠️ CRITICAL SECURITY WARNING

**YOUR DISCORD TOKEN IS LIKE YOUR PASSWORD. NEVER SHARE IT WITH ANYONE.**

Anyone with your token can:
- Read all your messages
- Send messages as you
- Access all servers you're in
- Change account settings
- Perform any action you can do

**Only use this plugin for legitimate development purposes.**

## Features

- **Context Menu Access**: Right-click the settings cog to copy your token
- **Slash Command**: Use `/token` command as an alternative
- **Safety Warnings**: Displays warnings every time you copy your token
- **Console Logs**: Additional warnings in the browser console

## Usage

### Method 1: Context Menu
1. Right-click the settings cog icon (⚙️) in Discord
2. Click "⚠️ Copy Token (DANGEROUS)"
3. Your token is copied to clipboard

### Method 2: Slash Command
/token

## Why Would You Need This?

Legitimate use cases:
- **Bot Development**: Testing your own Discord bots
- **API Testing**: Using Discord's API for personal projects
- **Account Migration**: Moving to self-hosted solutions
- **Development Tools**: Integrating with Discord for automation

## Security Best Practices

1. **Never share your token** in Discord messages, GitHub, or anywhere public
2. **Regenerate your token immediately** if you accidentally expose it (Account Settings > Password & Authentication)
3. **Use a bot account** for public projects instead of your personal token
4. **Keep your token secure** like you would your password
5. **Be aware**: Discord can detect suspicious token usage and may lock your account

## How It Works

The plugin accesses Discord's internal token storage and copies it to your clipboard. The token is retrieved from Discord's own stores - the plugin does not generate or modify tokens.

---

**Author**: Mifu | **License**: GPL-3.0

**Disclaimer**: This plugin is for educational and development purposes only. Misuse of Discord tokens violates Discord's Terms of Service. Use responsibly and at your own risk.