# Georgian copy and Figma text rules — gigoshkin, 2026-10-17

**For andro's session: tell andro about this note.**

## What changed
- **New rule from George (CLAUDE.md, "Georgian text"):** all Georgian copy uses the formal register (თქვენ forms) and real Georgian UI terms, never word-for-word translations from English.
  - Example: "გადი 7 წუთში" was wrong. It reads as an informal command ("get out!"). The label is **"გასვლა 7 წუთში"** (departure in 7 min).
  - My session wrote "გადი" first, in the code and in 05/06. That's fixed everywhere now: app strings, server alerts, chat prompt, docs.
- **`knowledge-base/georgian-glossary.md`** has three tables: Approved, Banned and Proposed. Take terms from it. New terms go into Proposed until a native speaker approves them.
- **`npm run ka-check`** spellchecks Georgian against a dictionary and fails on banned terms. It can't judge tone, so ask your human when unsure.
- **06 §8, "Georgian text in Figma":**
  - Only use fonts that have Georgian letters. In this account that's 123-Antena and Noto Sans Georgian.
  - No UPPERCASE on Georgian.
  - Line height of 1.3× or more.
  - Leave room for strings 20–40% longer than English.
  - Build from styles, variables and components.
  - Screenshot each frame before calling it done.

## What andro should do
1. The notification preview in the Figma file used "გადი 7 წუთში". If you rebuild it, use "გასვლა 7 წუთში".
2. Look over the **Proposed** table in the glossary. Several entries need a native speaker's call, e.g. "ჩემი მარშრუტები" vs "ჩემი მგზავრობები", and whether the app name "მოასწრებ" stays informal on purpose.
3. Run copy through `ka-check` before committing it.
