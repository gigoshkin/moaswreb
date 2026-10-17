# Handoff to the VPS session — gigoshkin, 2026-10-17

**For the Claude session on George's VPS.** You don't have the earlier cloud session's context; this note gives you what matters.

## Who and how
- George (gigoshkin) owns code, stack and repo rules. He wants short "what I did" replies, then questions **one at a time with full context**. Pre-middle PHP backend dev. Don't use the partner's first name; call them andro (they/them).
- Read `CLAUDE.md` first. George's session may push straight to `main`.

## Current state (17 Oct, evening)
- Server (`apps/server`): plan, chat agent, MCP, encrypted stored trips, alert watcher. 30 tests pass. Never tested against live TTC (the cloud sandbox was blocked). **You can reach TTC now: verify `/plan` with real data.**
- Mobile (`apps/mobile`): Expo SDK 58 placeholder screens. Not yet restyled.
- **Design decision: MVP look = prototype Today v3** (`design/prototype/today-v3.png`, source `design/prototype/v2/today.html` + `base.css`). Rules in `knowledge-base/ideas/tbilisi-transit/06-design-direction.md` §0, rules 5–11:
  - English copy for design
  - white background
  - Inter
  - black and grey
  - lime `#D7FB45` leave block
  - orange `#F0561D` only for problems
  - no pulsing dots, no explainer labels, calm
- George rejected v4 (energetic display type) and v5 (serif). He dislikes the "Google app" look and anything that reads as vibecoded.

## Next steps, in order
1. **Start the Expo dev server for George's phone** over Tailscale: `cd apps/mobile && REACT_NATIVE_PACKAGER_HOSTNAME=$(tailscale ip -4) npx expo start`, in a tmux window. Give him the `exp://` URL.
2. **Make the app open in Expo Go:**
   - `react-native-mmkv` v4 (nitro) isn't in Expo Go. Add a fallback in `apps/mobile/src/lib/cache.ts` and `device.ts`, e.g. `expo-sqlite/kv-store` when MMKV isn't available, or ask George whether to switch storage outright.
   - Push registration should no-op in Expo Go.
3. **Rebuild Today in React Native to match v3 exactly:**
   - tokens: Inter, colours above
   - components: leave block, stop card, trip row, route plate, tab bar
   - English strings for now
4. Then Trip detail, Chat (with action cards) and Add trip, in the v3 style. Show George each one live in Expo Go.

## Open items for George (ask one at a time)
- EAS / Firebase for real push notifications (needs a dev build).
- Whether to keep `apps/mobile/AGENTS.md` and `apps/mobile/.claude/settings.json` (the Expo template's files).
- The update hook `scripts/sync-shared.sh`: written and tested, but registering it in `.claude/settings.json` needs George's OK.
- andro's app icon is mint `#3FFFAF`; the chosen accent is lime `#D7FB45`. One should change.
