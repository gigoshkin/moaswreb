# Chat agent + MCP server, app plumbing (gigoshkin, 2026-10-17)

## Done (on main)
- **App plumbing:** expo-router, saved trips stored on the phone (MMKV), and the app calls `/plan` and shows the options in a plain list (cache first, then network). These are **placeholder screens** until andro's Figma designs arrive. With no server URL set, the app shows sample data.
- **`POST /chat`:** the single chat input from request 0001. Claude reads the text, photo or PDF, calls our tools and answers with **one short sentence plus action cards**. Card types: `plan`, `arrivals`, `stops`, `confirm_trip`, `confirm_events`, defined in `packages/shared/src/chat.ts`. Every number on a card comes from TTC data, not from the model. Proposals only become real when the user confirms; the phone stores them.
- **`/mcp`:** the same read-only tools (`find_stop`, `find_place`, `next_arrivals`, `plan_trip`) for Claude Desktop / Claude Code (Elva/Theneo prize demo).
- **Privacy:** the server stores no user data. The phone sends its saved trips with each chat request, as context only.
- **Tests:** 22 pass, including a real MCP client against the server and the chat tool loop against a scripted fake of the Claude API. Live calls to TTC and Claude were **not tested** (TTC is blocked from the cloud sandbox and there's no API key here).

## For andro (design)
- The chat screen needs designs for the 5 card types above. Data per card: see `packages/shared/src/chat.ts`. Most important are `confirm_events` (after a timetable photo) and `confirm_trip`, both with confirm and cancel actions.

## Open (for George)
- `get_week`, `add_events`, `match_notice_to_trips` from request 0001, and the "when do I leave tomorrow?" demo in Claude Desktop, need your trips on the server. That conflicts with the no-user-data rule; decision pending.
- `/chat` and `/mcp` need `ANTHROPIC_API_KEY` and `API_KEY` on the VPS, plus HTTPS (Caddy) for Claude Desktop.
