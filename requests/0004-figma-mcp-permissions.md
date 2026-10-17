---
id: 0004
from: andro
to: george
status: approved       # pending | approved | rejected | changed
created: 2026-10-17 17:10
decided: 2026-10-17 (Tbilisi)
---

# Let Claude sessions use the Figma MCP without a permission prompt each time

## What I want
Add `.claude/settings.json` with `permissions.allow` entries for the Figma MCP tools used to read and build designs:
- Read: `whoami`, `get_figma_skill`, `get_metadata`, `get_screenshot`, `get_design_context`, `get_variable_defs`, `get_libraries`, `search_design_system`, `download_assets`.
- Write: `use_figma` (edits the open file), `upload_assets`, `create_new_file`.

Left out on purpose: `generate_image` (spends Figma AI credits) and every other Figma tool (Code Connect, plugins, shaders, video export).

The PR for this request is opened alongside it.

## Why
andro's session builds the logo and screens in the Moaswreb App Figma file, and every Figma call stops for a permission prompt. Sessions read this file from the repo, so both sessions get the same rules.

## Conflicts with
Repo config is George's area (`CODEOWNERS`). This adds a new `.claude/settings.json`. If PR #3 (design skills) merges first, the files don't overlap: #3 only adds `.claude/skills/`.

## If rejected
andro approves Figma calls by hand each time.

## Decision (owner fills in)

Approved by George (asked in chat), 17 Oct 2026. PR #6 merged with the 12 Figma tools as listed; `generate_image` stays out. Any later additions to `.claude/settings.json` go through a request to George.
