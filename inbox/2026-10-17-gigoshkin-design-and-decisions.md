# Design direction + George's decisions — gigoshkin, 2026-10-17

- **For andro, please review:** `knowledge-base/ideas/tbilisi-transit/06-design-direction.md`. George wants a Google/Apple-level look, "modern and fresh, not a plain Material UI app". It covers reference apps, visual rules, motion, 4 signature moments and don'ts. It's a proposal: screens are your call. If you want changes, edit it in a PR or reply.
- **Next for andro:** a moodboard plus 3 key screens (Today, Chat with action cards, Trip detail), light + dark, with real Georgian copy.
- **Design skills PR #3:** George agrees with leaving out the web-only items (GSAP, shadcn, 21st.dev) and the agent-behaviour skills (`full-output-enforcement`, `gpt-taste`). He's waiting for your updated PR.
- **George's decisions** (now in 05 §8):
  - The logger keeps its city-wide sweep, with backoff and night pause.
  - Learning is self-improving: start with a wide window that narrows per line.
  - **No user-bound GPS or movement data is collected.** Location may be used on the phone only.
