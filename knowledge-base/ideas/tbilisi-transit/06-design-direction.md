# Design direction: Google/Apple-level, not stock Material

Written 17 Oct 2026 from George's session, at George's request ("very good, beautiful, snappy app that looks modern and fresh, not an obscure plain Material UI app; Google/Apple-level feel"). **Direction approved by George (17 Oct).** Screens and details are andro's to design within it; the tech section (§6) is George's area. Replaces the font and "Material 3 motion" lines in `05-build-plan.md` §5.

## 0. George's guidelines: the only fixed rules [decided by George, 17 Oct, later the same day]
George loosened the appearance rules. Only these are fixed:
1. **Georgian first in the app, but design in English** [George, 17 Oct: "forget designing in Georgian, design in English only"]. Mockups and prototypes use English copy; Georgian copy is written later from `georgian-glossary.md`.
2. **Light theme.** The app is light-themed. Dark mode is optional, andro's call.
3. **Premium feel with good animations.**
4. **Must not look vibecoded** (see §7 for common signals).
5. **White background** [George: "BACKGROUND MUST BE WHITE - I REQUIRE THIS", 17 Oct]. Pure white, not beige, cream or grey.
6. **Minimal palette** [George, 17 Oct]. White, near-black text, two or three greys, and **lime `#D7FB45` as the one accent** (the "leave" block), plus **signal orange `#F0561D` only for problems** (late, plan changed) [George, 17 Oct]. Nothing else: no per-route colours (route numbers sit on neutral plates), no extra badge colours, no gradients or textures. A warning colour for "late" only if a screen truly needs it.
7. **App screens first, now** [George, 17 Oct: "I NEED APP IMMEDIATELY"]. No more brand boards, banners, mockup scenes or logo variants until the screens are done: Today, Trip detail, Chat (with the action cards), Add trip, Settings.
8. **No explainer labels** [George, 17 Oct]. No small captions at the bottom of cards or boxes explaining what something is or where data comes from ("live data", "based on…", "updated…"). If a thing needs explaining, redesign it. No "live" label either.
9. **No pulsing dots or decorative animation** [George, 17 Oct]. Motion only where it explains a change (a number updating, a screen transition).
10. **Premium, not "Google app"** [George, 17 Oct]. Google Sans and Material patterns read as a Google app; the code prototype uses Inter. See `design/prototype/`.
11. **MVP look = prototype Today v3** [George, 17 Oct: "closest to what I like, leave it as MVP style"]: `design/prototype/today-v3.png`, source `design/prototype/v2/today.html` + `base.css`. White, Inter, black/grey, lime leave block with the countdown, grey stop card, plain list. v4 (energetic display type) and v5 (serif, editorial) were rejected.

**Everything else about appearance is andro's to decide and may override this document:** fonts, colours, accent, shapes, icons, references, motion style, signature moments. §1–§5 and §7 are suggestions, not rules. No request is needed to change them; andro edits this file or says so in an inbox note. The current tokens in `apps/mobile/src/theme/tokens.ts` (Google Sans Flex + Noto Sans Georgian, white and neutral greys, green accent) are placeholders until andro picks, within rules 5 and 6. §6 (the libraries) stays George's area.

## 1. The feel in one line
**A calm, confident instrument:** one big number that's always right, surfaces that move like physical objects, and nothing on screen that doesn't help you leave on time.

## 2. References to study (andro: a moodboard of 10–15 screenshots)
| App | Take this | Don't take |
|---|---|---|
| **Transit** (v6.0, Aug 2025: new typeface, refreshed design, "Neon" dark mode, new ETA cards [source](https://alternativeto.net/news/2025/8/transit-6-0-launches-with-new-typeface-refreshed-design-neon-dark-mode-and-new-eta-cards)) | Huge route numbers in line colours, ETA cards, a real dark mode, a single "GO" moment | Busy home screen |
| **Google Maps** (current) | Bottom sheets over the map, smooth sheet snapping, chips | Density, ads |
| **Apple Maps / Apple Weather** | Big type, calm spacing, layered cards, live updating numbers | iOS-only visuals (Liquid Glass) on Android |
| **Material 3 Expressive** (Google, 2025) | Springy motion that follows the finger, shape morphing between states, bolder type, wider tonal palettes ([Android docs](https://developer.android.com/design/ui/wear/guides/get-started/apply)) | The stock component look as-is |
| **Things 3, Arc, Linear** | Polish: every tap answers within 100 ms, nothing janky | — |

## 3. Visual rules
- **One hero per screen.** The Today screen is basically one sentence: **"Leave in 7 min"** in very large tabular numerals, with the window bar under it (06–09). Everything else is secondary.
- **Route plates:** the route number in TTC's own line colour (from the API `color` field), with the metro in its own colour. These are the only strong colours on screen.
- **Neutral base, one accent.** Warm off-white in light mode; true near-black in dark mode with lifted surfaces (Transit's "neon" dark is a good benchmark). ~~Make dark mode first-class from day one.~~ Light theme first (§0); dark mode is optional.
- **Type:**
  - **Google Sans Flex** for Latin and numerals. It has been free under SIL OFL since Nov 2025 ([9to5Google](https://9to5google.com/2025/11/18/google-sans-flex-font-available/)), and its variable axes allow a heavier, rounder weight for the hero number.
  - Georgian: Noto Sans Georgian or FiraGO. Check that Google Sans Flex has no Georgian glyphs **[?]**, and pick the Georgian font that matches its x-height.
  - Two or three sizes per screen, with big contrast between them.
- **Shapes:** large-radius cards. The shape changes with state (a card that's "about to leave" gets tighter corners and a solid fill), in the M3 Expressive spirit, not just colour swaps.
- **Icons:** one consistent set (Material Symbols Rounded, or Lucide at one stroke weight). No emoji, no sparkles, no "AI" badges.
- **Copy:** Georgian first, short, with numbers ("გასვლა 7 წუთში"; formal register, terms from [georgian-glossary.md](../../georgian-glossary.md), George 17 Oct). Reasons in one line: "306 is 4 min late → take 17".

## 4. Motion and snappiness (where "Google/Apple level" is actually won)
- **Everything is a spring,** with no linear fades. Sheets, cards and the chat's action cards follow the finger and settle with physics.
- **Shared-element transitions:** the Today card expands into Trip detail; a chat action card ("3 events → confirm") morphs into the week plan once confirmed.
- **Live numbers roll** (digit ticker) instead of jumping; live buses on the map **glide** between GPS points (interpolated), never teleport.
- **Instant start:** show the last known state from local cache at launch (under 300 ms to useful content), then refresh. Never show a spinner on Today; use skeletons for first-ever load only.
- **Haptics** on state changes (leave now, plan changed, card confirmed), subtle and never on scroll.
- **60/120 fps** on a mid-range Android. Test on the actual demo phone early.

## 5. Signature moments (what judges remember)
1. **The leave-by bar:** a live window that narrows as the bus approaches, with the "now" marker sliding into it.
2. **The chat-to-plan morph:** drop a timetable photo → action card → tap confirm → the card flies into the week view.
3. **The notification → open handoff:** the lock-screen alert opens straight into the same card, already expanded, with the reason.
4. **The live map:** buses gliding along route polylines in line colours, your stop pulsing.

## 6. Tech that makes it feel native (George's area; proposed, needs George)
| Need | Use |
|---|---|
| Base | Expo, latest SDK (docs are at SDK 58, Sept 2026; check it's the newest stable), New Architecture, dev build |
| Real native controls where they help (date/time pickers, switches, dialogs, maybe sheets) | `@expo/ui` Jetpack Compose components, stable since SDK 56 ([Expo blog](https://expo.dev/blog/expo-ui-stable-sdk-56)) |
| Springs, gestures, shared transitions | Reanimated 4 + Gesture Handler |
| Custom drawing (leave-by bar, digit ticker, map overlays) | React Native Skia |
| Lists | FlashList |
| Images | expo-image |
| Instant start cache | MMKV |
| Map | MapLibre RN + vector tiles in our own style (muted base map so the route colours pop) |
| Haptics | expo-haptics |

No web UI kits (shadcn, 21st.dev, GSAP) in the app: they target the DOM (agreed by George).

## 7. Don'ts (signals of "vibecoded" or "stock")
Purple/indigo gradients · glassmorphism everywhere · default Material buttons and app bars · centred hero cards with a generic illustration · emoji icons · sparkle "AI" badges · percentages as confidence ("90% on time") · spinners · linear fades · five accent colours · tiny grey text · chat bubbles with long paragraphs.

## 8. Process [decided by George, 17 Oct]
**Figma is the source of truth for design. andro designs in Figma; George's session builds the code from the Figma frames.**
1. **andro:** designs in Figma, in George's team. **Design file: [Moaswreb-App](https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App)** (created by George, 17 Oct). Moodboard (§2) first, then the key screens: Today, Chat with action cards, Trip detail. Light theme, real Georgian copy.
2. **Figma file conventions** (so code can be generated from it reliably):
   - One frame per screen and state, named in English: `Today / default`, `Today / no trips`, `Trip detail / late`.
   - Colours, type sizes, spacing and radius as **Figma variables/styles**, not one-off values. These become `tokens.ts`.
   - Reusable parts as **components** (route plate, leave-by bar, card, action card), with variants for states.
   - Auto-layout everywhere, so spacing reads cleanly into code.
   - Motion can't live in Figma: describe it in a frame note or the inbox ("card springs up", "number rolls").
3. **Handoff:** when a screen is ready, andro writes an inbox note with the Figma link (frame link if possible). George's session reads the frame with the Figma connector and builds it in React Native.
4. The current code kit (`apps/mobile/src/components`, `tokens.ts`) is a placeholder; it gets restyled to match Figma.
5. Demo-phone check every few hours: start time, scroll, transitions.

### Georgian text in Figma [George's quality rule, 17 Oct]
Agent-made frames had broken Georgian. These rules are technical; the choice of font and style stays with andro.
- **Only fonts that contain Georgian (Mkhedruli) letters.** When a font has no Georgian, Figma swaps in another font for those letters, so weights and widths don't match the Latin text. Before using a font, render a Georgian test string in it and compare. Fonts in this Figma account that have Georgian (checked 17 Oct with `listAvailableFontsAsync`): 123-Antena (the wordmark) and Noto Sans Georgian. Inter, Google Sans Flex and most Google fonts have none.
- **Don't apply UPPERCASE to Georgian.** Figma turns it into Mtavruli capitals, which reads as shouting and breaks line lengths.
- **Line height at least 1.3× for Georgian body text.** Mkhedruli letters reach far above and below the line; check the screenshot for clipped letters.
- **Georgian strings run 20–40% longer than English.** Use auto-layout and text that grows in height, and test with the longest real string.
- **Copy comes from [georgian-glossary.md](../../georgian-glossary.md):** formal register, no word-for-word translations, no lorem ipsum.
- **Build screens from shared text styles, variables and components**, not one-off values. That's where the "clean" look comes from; an agent placing loose layers produces a vibecoded look whichever MCP it uses.
- **Before calling a frame done:** screenshot it and check for fallback fonts, clipped letters, overlaps and leftover test layers.
