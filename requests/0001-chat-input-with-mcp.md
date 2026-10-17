---
id: 0001
from: george
to: andro
status: approved       # pending | approved | rejected | changed
created: 2026-10-17 (evening)
decided: 2026-10-17 15:16 (Tbilisi)
---

# Replace the upload/notice screens with one chat input, backed by our MCP server

## What I want
- **One chat screen is the only input.** Send anything: a timetable photo, a PDF, an .ics link, a pasted Georgian notice, free text ("Fridays I'm at the office in Vake till 18:00"). No separate F2 upload screen or F5 notice screen.
- **The agent answers with action cards, not paragraphs**, for example:
  - "3 events found → [confirm places]"
  - "This notice affects your Tue/Thu trips → [re-plan]"
  - "Leave 08:12–08:15 → [set alert]"

  Every change to trips or alerts is a card the user confirms.
- **The agent works through our own MCP server**, the same backend that the app's other screens use. Tools could include `add_events`, `set_home`, `plan_trip`, `next_arrivals`, `match_notice_to_trips`, `get_week`, `get_scorecard`.
- **The same MCP server works from any AI tool** (Claude Desktop etc.), which fits Elva/Theneo's "back the native app with an MCP" slide. On stage: ask Claude Desktop "when do I leave tomorrow?" and get the same answer as the app.
- Today, Week, Trip detail, Scorecard and notifications stay as they are. The chat replaces the input screens, not the whole app.

## Why
- One input that takes anything is simpler than four upload modes plus a notice screen, and it's faster to build and demo.
- MCP: Elva/Theneo special prize ($4,800 Theneo + $7,200 Elva credits). The deck shows no general bonus points for MCP, so only this prize counts.

## Conflicts with
- `04-product-spec.md` "Not in the first build: … chat interface", and the separate F2/F5 screens.
- Original idea's rule "no generic AI search bar". The answer is that this isn't a search bar: every reply ends in a structured change to the user's trips or alerts, confirmed by the user. Judges' line to avoid: "Adding a chatbot to the old app is not enough" (Track 01). The chat only handles input; the alerts and the week plan do the work.

## If rejected
Keep the F2/F5 screens as specced, and build the MCP server anyway for the Elva prize and the Claude Desktop demo.

## Decision (owner fills in)

Approved by andro (asked in chat), 2026-10-17 15:16 Tbilisi time. The chat input with confirm cards replaces the separate F2 upload and F5 notice screens; Today, Week, Trip detail, Scorecard and notifications stay. `04-product-spec.md` updated to match.
