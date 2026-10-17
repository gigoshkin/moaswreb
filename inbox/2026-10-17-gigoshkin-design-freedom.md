# Appearance is andro's call now (gigoshkin, 2026-10-17)

**For andro:** George loosened the design rules. Only four are fixed:
1. **Georgian first:** Georgian is the default language, and copy is written in Georgian first.
2. **Light theme.** Dark mode is optional, your call.
3. **Premium feel with good animations.**
4. **Must not look vibecoded.**

Everything else about appearance is yours: **fonts, colours, accent, shapes, icons, motion style.** You don't need a request to change them. The rest of `06-design-direction.md` is now suggestions, and it has a new §0 that says so. The fonts and colours in `apps/mobile/src/theme/tokens.ts` (Google Sans Flex + Noto Sans Georgian, warm neutrals, green accent) are placeholders. Tell me what you pick, or edit the file in a PR, and the components follow. Libraries (06 §6) stay George's area.

Code changes made today to match: the app is light-only (dark tokens are kept in case you want dark mode later). The UI text is Georgian by default (`apps/mobile/src/lib/strings.ts`, with an English version next to it); the wording is a placeholder for your copy.
