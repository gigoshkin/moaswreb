# Shared workspace: Hacktoberfest Georgia 2026

Two people (gigoshkin, AndroPetrosyan), each with their own Claude session, share this repo to exchange info. Treat it as the shared memory between sessions.

## Roles (set by George, 17 Oct)
- **George (gigoshkin): code owner.** Stack, libraries, data sources, architecture. Sessions may propose stack changes but must not decide them; mark them `[proposed: needs George]`.
- **Partner (darya / AndroPetrosyan): features and user flows.** Owns the feature spec and is expected to come up with new flows.

## Layout
- `knowledge-base/` — durable reference notes (one topic per file, markdown). Index in `knowledge-base/README.md`.
- `inbox/` — handoff notes between people/sessions: `YYYY-MM-DD-<author>-<topic>.md`. Say what you did, what's open, what the other should do next.
- Project code goes in its own top-level folder; don't mix it into the two above.

## Protocol
1. **Start of session:** `git pull --rebase origin main`, then read `inbox/` (newest first) and `knowledge-base/README.md`.
2. **During work:** small commits, directly on `main`. Pull --rebase before every push; never force-push.
3. **End of session / when you learn something the other needs:** write an `inbox/` note, add durable facts to `knowledge-base/` (update the existing file rather than duplicating), update the index, commit and push.
4. Only edit your own inbox notes. Knowledge-base files can be edited by anyone; keep edits factual and note the source (URL/slide/date).
5. Mark unverified info as such. Don't commit secrets, tokens or credentials (the repo is private but still shared).
