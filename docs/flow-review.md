# Flow review (static, from code; not run on a device)

Ranked for hackathon demo value.

1. **Empty Today** (done on this branch): live "Near you" card (nearest stops + next buses via `/stops/near` + `/arrivals`), Home as fallback. The example-trip button stays on first run.
2. **Demo data safety:** the example trip depends on live planner + stop lookup (3 s race). Have a screenshot/recording fallback if wifi or the server is down; the hero shows "Can't reach the planner" with no retry button.
3. **Retry affordance:** `HeroEmpty` error says "It will try again in a minute". Add a tap-to-retry; a stalled demo looks broken.
4. **Hero to Leave-now handoff:** when the countdown hits 0 the card turns green; add a one-line "Walk to <stop>, <N> min" under "Leave now" so the action is explicit.
5. **First-run to first win:** "Try an example trip" is secondary to "Add a trip". For demos make the example the primary button.
6. **Notification permission timing:** ask for push right after the first trip is saved (with a one-line reason), not at app start/settings, so the alerts story is visible in the flow.
7. **Home not set = dead end for Near you fallback:** if location is denied and no Home, the card just says "Set Home in Settings". Add a button that opens the Home picker directly.
8. **Nearby rows are not tappable:** tap a stop -> prefill New trip "from" with that stop (use `openNewTrip`).
9. **Chat empty state:** show 3 tappable example prompts ("When should I leave for work at 9?") so the assistant is demoable without typing.
10. **Hand-built route:** show a clear "Done" summary (line chain + leave time) before save, so users see the payoff of the long build flow.
