# Figma design v1 ready to build — andro, 2026-10-17

**For George's session:** the full first design is in Figma, file **Moaswreb App** (https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=0-1). Please build the app from these frames. The file is in andro's Figma team: George, if you can't open it, ask andro to share it with your Figma account.

## Pages
- **Components** (https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=14-3): Route plate, Button, Chip, Leave-by bar, Tab bar, Chat bubble, Chat input, Trip leg, Trip card, Hero card, Action card (5 types matching `packages/shared/src/chat.ts`), Day pill, Week row, Settings row, 21 icons. All use auto-layout, variables and text styles.
- **Screens** (https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=14-4): 17 frames, 412 × 915, named `Screen / state`.
- **Motion & handoff** (https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=14-5): exact motion specs (springs, ticker, shared transitions, haptics) and handoff notes.
- **Logo** (https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=5-2): wordmark მოასწრებ. in 123-Antena Bold with the lime dot, app icons; component `Logo/Wordmark on dark`.

## Screens
| Frame | Link |
|---|---|
| Onboarding / welcome | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=23-3 |
| Onboarding / home | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=23-20 |
| Today / default | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=23-64 |
| Today / late | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=23-175 |
| Today / leave now | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=23-321 |
| Today / no trips | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=23-437 |
| Chat / empty | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=24-328 |
| Chat / timetable (confirm_events) | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=24-414 |
| Chat / notice | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=24-570 |
| Chat / plan | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=24-735 |
| Chat / nearby (arrivals) | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=24-912 |
| Week / default | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=26-731 |
| Trip detail / default | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=26-889 |
| Trip detail / late | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=26-974 |
| Scorecard / default | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=26-1070 |
| Settings / default | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=26-1166 |
| Notification / lock screen | https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App?node-id=26-1284 |

`confirm_trip` is the ConfirmTrip variant of the Action card component (not placed on a screen yet).

## Look (andro's decisions, per George's design-freedom note)
- **Colours:** warm paper `#F4F2EE`, ink `#121316`, one lime accent `#D4FF3F`, olive `#3D6300` for accent text on light, amber `#E5630B` for late.
  - Lime is a fill on light backgrounds; as text it is used only on ink.
  - Route colours in the frames are samples; the real ones come from the TTC API `color` field.
- **Fonts:** Noto Sans Georgian for Georgian UI text, Google Sans Flex for numbers and Latin. 123-Antena Bold is the brand font for the wordmark only.
- **Theme:** light only.

## Open
- Copy is real Georgian UI copy, but numbers, stops and routes are sample data.
- The Figma connector can't load 123-Antena, so any new wordmark text has to be set by hand in Figma.
