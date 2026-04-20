# Vencord PGP

End-to-end PGP encryption plugin for [Vencord](https://github.com/Vendicated/Vencord).

Encrypt your Discord DMs with OpenPGP. Inspired by [gnupg-discord](https://github.com/ibnaleem/gnupg-discord).

![Key Manager](https://img.shields.io/badge/Key%20Manager-UI-blue)
![Keyserver](https://img.shields.io/badge/Keyserver-Support-green)
![ECC](https://img.shields.io/badge/ECC-Curve25519-purple)

## Features

- 🔐 **Generate PGP key pairs** (ECC Curve25519 or RSA 4096)
- 🔒 **Encrypt messages** to contacts with known public keys
- 🔓 **Decrypt messages** sent to you
- ✍️ **Sign messages** to prove authenticity
- ✅ **Verify signatures** from contacts
- 🌐 **Keyserver integration** (keys.openpgp.org)
- 📇 **Contact management** with verification status
- 🖥️ **Full UI** for key management

## Installation

1. Clone this repo into your Vencord userplugins folder:
   ```bash
   cd path/to/Vencord/src/userplugins
   git clone https://github.com/17z7h0m4s/vencord-pgp.git PGP
   ```

   Or manually copy `index.tsx` to `src/userplugins/PGP/index.tsx`

2. Build Vencord:
   ```bash
   pnpm build
   ```

3. Restart Discord

## Usage

### Generate Your Key Pair

```
/pgp keys
```

Go to the **Generate** tab, fill in your details, and create a passphrase.

### Share Your Public Key

```
/pgp sharekey
```

Send this to people you want to communicate with securely.

### Import Someone's Key

```
/pgp keys
```

Go to **Import** tab → paste their public key → enter their Discord User ID.

Or search keyservers in the **Keyserver** tab.

### Encrypt a Message

```
/pgp encrypt message:Your secret message here user:@recipient
```

### Decrypt a Message

```
/pgp decrypt message:-----BEGIN PGP MESSAGE-----...-----END PGP MESSAGE-----
```

### Sign a Message

```
/pgp sign message:I wrote this message
```

### Verify a Signature

```
/pgp verify message:-----BEGIN PGP SIGNED MESSAGE-----...-----END PGP SIGNATURE-----
```

## Commands

| Command | Description |
|---------|-------------|
| `/pgp keys` | Open key manager UI |
| `/pgp encrypt message:<text> user:@user` | Encrypt message to a user |
| `/pgp decrypt message:<block>` | Decrypt a PGP message |
| `/pgp sign message:<text>` | Create cleartext signature |
| `/pgp verify message:<signed>` | Verify a signed message |
| `/pgp sharekey` | Post your public key |
| `/pgp fingerprint` | Show your fingerprint |

## How It Works

- Uses [OpenPGP.js](https://openpgpjs.org/) loaded from CDN
- Keys stored locally in Vencord settings
- All encryption/decryption happens client-side
- No data sent to external servers (except optional keyserver lookups)

## Security Considerations

- **Private keys** are stored in your browser's local storage (encrypted with your passphrase)
- **Verify fingerprints** out-of-band before trusting a contact's key
- **No forward secrecy** - if your key is compromised, past messages can be decrypted
- **Metadata not hidden** - Discord can still see who you message and when

## Comparison: Plugin vs Bot

| Aspect | gnupg-discord Bot | This Plugin |
|--------|------------------|-------------|
| Encryption location | Server-side (bot sees plaintext briefly) | Client-side (never leaves your device) |
| Trust required | Bot operator | Only yourself |
| Setup | Join bot's server | Install plugin |

## License

GPL-3.0-or-later

## Credits

- [OpenPGP.js](https://openpgpjs.org/) - OpenPGP implementation
- [gnupg-discord](https://github.com/ibnaleem/gnupg-discord) - Inspiration
- [Vencord](https://github.com/Vendicated/Vencord) - Discord client mod

## Contributing

Issues and PRs welcome!
