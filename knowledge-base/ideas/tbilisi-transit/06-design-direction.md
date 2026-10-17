# Design direction: Google/Apple-level, not stock Material

Written 17 Oct 2026 from George's session, at George's request ("very good, beautiful, snappy app that looks modern and fresh, not an obscure plain Material UI app; Google/Apple-level feel"). **[proposed: needs andro]** for screens and look; the tech section is George's area. Replaces the font and "Material 3 motion" lines in `05-build-plan.md` §5.

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
- **Neutral base, one accent.** Warm off-white in light mode; true near-black in dark mode with lifted surfaces (Transit's "neon" dark is a good benchmark). Make dark mode first-class from day one.
- **Type:**
  - **Google Sans Flex** for Latin and numerals. It has been free under SIL OFL since Nov 2025 ([9to5Google](https://9to5google.com/2025/11/18/google-sans-flex-font-available/)), and its variable axes allow a heavier, rounder weight for the hero number.
  - Georgian: Noto Sans Georgian or FiraGO. Check that Google Sans Flex has no Georgian glyphs **[?]**, and pick the Georgian font that matches its x-height.
  - Two or three sizes per screen, with big contrast between them.
- **Shapes:** large-radius cards. The shape changes with state (a card that's "about to leave" gets tighter corners and a solid fill), in the M3 Expressive spirit, not just colour swaps.
- **Icons:** one consistent set (Material Symbols Rounded, or Lucide at one stroke weight). No emoji, no sparkles, no "AI" badges.
- **Copy:** Georgian first, short, with numbers ("გადი 7 წუთში"). Reasons in one line: "306 is 4 min late → take 17".

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

## 8. Process (proposed)
1. **andro:** moodboard (§2) → 3 key screens in Figma: Today, Chat with action cards, Trip detail. Light + dark. Real Georgian copy.
2. **George's session:** design tokens (colour, type, radius, spacing, spring presets) plus a small component kit (route plate, leave-by bar, card, sheet, action card) before any screen is built, so every screen shares one look.
3. Build Today first and get it perfect on the demo phone; the other screens reuse the kit.
4. Demo-phone check every few hours: start time, scroll, transitions.
