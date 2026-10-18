# Figma design v2 ready to build — andro, 2026-10-17

**For George's session:** build the app screens from the **Screens v2** page (https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=46-2) of the Figma file **Moaswreb App**. The file is in andro's Figma team: George, if you can't open it, ask andro to share it with your Figma account.

v2 follows George's rules 5–8 (06 §0):
- white background, near-black text and greys, one accent
- neutral route plates
- no explainer captions, no "live" label (the mint pulsing node is the live signal)
- "გასვლა", never "გადი"

The old v1 screens and image concepts are archived on pages "Archive · screens v1" and "Archive · concepts". Don't build from those.

## Screens v2
| Frame | Link |
|---|---|
| Today / default | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=51-3 |
| Today / late | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=51-91 |
| Today / leave now | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=51-206 |
| Trip detail / default | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=57-1625 |
| Chat / timetable (Events panel) | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=51-370 |
| Chat / plan (Plan panel) | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=51-503 |
| Chat / notice (Notice panel) | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=51-640 |
| Add trip / default | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=51-763 |
| Settings / default | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=51-811 |

- **Add trip** collects what the alerts need: the start place with its first stop and walk time, the destination with its last stop, the arrive-by time and the weekdays.
- **Trip detail** follows the approved concept: muted greyscale map (MapLibre style) fading into white, ink route line, mint bus node (pulses when live), huge display time, icon timeline with durations on the right.
- **Settings** has "ჩემი მონაცემების წაშლა" (calls `deleteMyData()`) and a privacy-policy row.

## Components (https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=14-3)
- **New in v2:** Hero v2 (Default / Late / Now), Trip row (Default / Late), Timeline leg (Walk / Bus / Arrive), Action panel v2 (Events / Plan / Notice / Arrivals).
- **Reused:** Route plate (now neutral), Button, Chip, Leave-by bar, Tab bar, Chat bubble, Chat input, Settings row, icons.
- The older Hero card, Trip card and Action card sets are v1; ignore them.

## Look (andro's decisions)
- **Colour:**
  - white `#FFFFFF`, ink `#111113`, greys `#5C5C63` / `#9C9CA3` / `#E7E7EA` / `#F4F4F5`
  - **one accent: mint `#3FFFAF`**, used as a fill only (leave window, primary action, active tab, live node), never as text on white
  - warning `#D96C00` only for "late"
- **Fonts:**
  - **Display:** 123-Antena Bold, italic slant (styles `ka/Display`, `ka/Title`, `num/Giant` (Today minutes, 280 px), `num/Hero`, `num/Display`, `num/Time` (Today list times), `num/Large`).
  - **Text:** Helvetica Neue, if andro's copy has Georgian letters; otherwise Noto Sans Georgian.
  - The Figma connector can't load either font, so the frames still render the placeholders (Noto Sans Georgian and Google Sans Flex) until andro swaps the text styles by hand. Each style's description names its target font.
- **Motion:** see the "Motion & handoff" page (https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=14-5). Lime there now means the mint accent.

## Copy
Checked with `ka-check`: 0 errors. New terms were added to the glossary's **Proposed** table for a native speaker to approve.
