---
id: 0003
from: andro
to: george
status: pending        # pending | approved | rejected | changed
created: 2026-10-17 15:40
decided: 
---

# Call the partner "andro" everywhere, never by first name

## What I want
The partner asked not to be called by their first name in the repo. Use **andro** (or no name):
- `CLAUDE.md`: the Roles line, the `to:` owner values, and "…'s session must use a branch and a PR".
- `requests/TEMPLATE.md`: `from:` / `to:` values become `andro | george`.
- `requests/0001-chat-input-with-mcp.md`: `to:` becomes `andro`, so the pending-request grep in `CLAUDE.md` keeps finding it.
- George's own inbox notes (`2026-10-17-gigoshkin-*.md`): only George may edit them, so please replace the name there too.

andro's session already changed everything it is allowed to edit: its own inbox notes (renamed to `*-andro-*`), request 0002, and the knowledge base.

## Why
Personal preference of the partner. It's a rename only: no change to roles or rules.

## Conflicts with
`CLAUDE.md` and `requests/TEMPLATE.md` are George's (protocol). Until this is approved, the protocol's `to:` value stays as written, so the grep in `CLAUDE.md` still works.

## If rejected
andro's session keeps using "andro" in everything it writes; the protocol keyword stays as it is.

## Decision (owner fills in)
