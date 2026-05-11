# Vencord GradientNickname

Vencord plugin: gradient nicknames mimicking Discord's boost role-color effect.

## Install

1. Clone Vencord: https://github.com/Vendicated/Vencord
2. Copy `src/` of this repo into `Vencord/src/userplugins/gradientNickname/`
3. Build & inject: `pnpm install && pnpm build && pnpm inject`
4. Enable "GradientNickname" in Vencord plugin settings.

## Configure

Plugin settings:
- **stops** — comma-separated hex colors. Example: `#ff5f6d,#ffc371,#7873f5`
- **anim** — `none`, `hue`, or `slide`

After save, plugin debounces 5s then PATCHes your bio with `[grad:#ff5f6d,#ffc371;anim=hue]`. Other plugin users see your gradient within 60s of viewing your name.

## Manual QA Checklist

- [ ] Self gradient renders in chat (your own messages).
- [ ] Self gradient renders in member list.
- [ ] Self gradient renders in mention pill (`@yourself` typed in another user's message).
- [ ] Self gradient renders in user profile popout (click own avatar).
- [ ] Self gradient renders in voice channel name list.
- [ ] Self gradient renders in DM list.
- [ ] Self gradient renders in reply context (someone replies to your message).
- [ ] Settings save → verify bio updated within 5s in Discord User Settings → Profile → About Me.
- [ ] Two test accounts: A sets gradient. B sees A's gradient within 60s after rendering A's name in any surface.
- [ ] Disable plugin → all gradients revert to default color, no DOM leftovers.
- [ ] Bio without `[grad:]` tag → user's name renders normal color.
- [ ] Animation `hue` — name shifts hue continuously when visible.
- [ ] Animation `slide` — gradient slides left↔right.
- [ ] Bio at 190-char limit: setting save shows "Bio too full" toast and aborts; local render still updates.

## Discord Version Targeted

Patches are written against the Discord build active at install time. If Discord updates and patches break, the Vencord console warns "[Vencord] Patch failed for ..." — locate the surface in `src/index.tsx` `patches` array, refresh the `find:` substring against the current minified bundle (DevTools → Sources), and update the `match` regex.

Patch authoring (Task 10 of the implementation plan): for each surface (chat author, member list, mention, profile/popout, voice list, DM list, reply context), find the React component rendering the username and add a Vencord patch that wraps the JSX in `<GradientName userId={user.id}>`. One patch per surface — failure of one does not break others.

## Tests

Pure unit tests for encoding, store, fetchQueue:

```bash
npm test
```

26 tests covering encode/decode round-trip, TTL refresh semantics, and fetch queue throttling/back-off.

## Architecture

See `docs/superpowers/specs/2026-05-07-gradient-nickname-design.md` for full design and `docs/superpowers/plans/2026-05-07-gradient-nickname.md` for the implementation plan.
