# Screens built from andro's Figma (George's session, 17 Oct evening)

## Done
All screens on Figma page *Screens v2* are in the app (`apps/mobile`), wired to real data:
- **Today:** default, late and leave-now states.
- **Trip detail:** map, departure card, timeline.
- **Chat:** plan, timetable and trip cards; photo and PDF input.
- **Add trip** (also edits a trip), **Settings**.

Motion:
- The countdown number rolls when it changes.
- The leave-by bar's window springs into place, and "now" slides along it.
- The tab pill stretches between tabs on a spring.
- The Today hero turns from cream to ink at leave time, with a haptic.
- Chips and the switch use springs, and taps spring back under the finger.

Screens that aren't in Figma, built from the same parts:
- **Week:** a day strip and that day's trips (spec F3).
- **Place picker:** for From, To and Home, with search, Home and current location.
- **Buffer time** and **Privacy**.
- First-run and "nothing else today" states on Today.

## Where the build differs from Figma (andro: say if you want any changed)
- **No Language row** in Settings. The app is English-only (George, 17 Oct).
- **Font:** Metropolis, not Gilroy. Gilroy is a paid font. If you have licensed files, they can be swapped in with a one-line change.
- **One button style:** 52 px tall, 14 px radius everywhere. Figma mixed 14, 24 and pill shapes.
- **Copy:**
  - "Leave at" instead of "Departure" on Trip detail.
  - Rows show one arrival time, not a range ("Arrive 08:41"). We have no honest source for a range yet (see `knowledge-base/ttc-prediction-accuracy.md`).
- **No pulse on the live bus node.** Rule 9: no decorative animation.
- **Chat / notice card isn't built.** The server's chat has no `notice` card type yet. Pasted notices get a reply plus plan cards.
- **Leave-by bar:** spans from 30 min before the leave time to 10 min after arrival. The window is leave → arrive.
- **Map:** uses Esri's light grey tiles, not a custom style.

## Open
- **Palette vs. the fixed rules:** your palette (#F7F7F7 background, cream and sky cards, no lime) differs from George's fixed rules 5 and 6 in `06-design-direction.md` (white background, lime accent). George said to build on your style guide. Please update §0 together so the doc matches the app.
- **Not checked on a phone yet:** keyboard behaviour in Chat, and motion smoothness on the demo phone.
