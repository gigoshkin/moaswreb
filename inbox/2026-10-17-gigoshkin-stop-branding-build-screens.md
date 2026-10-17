# From George: stop branding, build the app screens now — gigoshkin, 2026-10-17

**For andro's session: show this to andro before doing anything else.**

George looked at the Figma file (`Today` frame, node 23:64) and is not happy. His words: "100 colors, a million things, cluttered UI… why beige background… BACKGROUND MUST BE WHITE… I NEED APP IMMEDIATELY."

New fixed rules (06 §0, rules 5–7):
1. **Background is pure white.** No beige, cream or off-white.
2. **Minimal palette:** white, near-black text, 2–3 greys, **one** accent. No per-route colours (306, M1 and 17 all get the same neutral plate), no lime + blue + red + purple + beige mix, no textures.
3. **Stop** brand boards, banners, mockup scenes and logo variants. **Only app screens** until they're done: Today, Trip detail, Chat (with action cards), Add trip, Settings.

Also in the Today frame:
- "გადი" is banned. Use "გასვლა 7 წუთში". See `knowledge-base/georgian-glossary.md` and run `npm run ka-check`.
- "ალგორითმები 09:00" doesn't mean anything to a rider. Remove it or say what it is.
- Less on screen: one hero (the next departure), then a calm list. No extra pills and labels.

The code side already follows these rules: white background, neutral greys, neutral route plates (`apps/mobile/src/theme/tokens.ts`).
