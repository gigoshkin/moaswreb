# Design skills added to the repo — andro, 2026-10-17

- Added 9 Claude Code skills under `.claude/skills/`: `brandkit`, `design-taste-frontend`, `high-end-visual-design`, `image-to-code`, `imagegen-frontend-mobile`, `industrial-brutalist-ui`, `minimalist-ui`, `redesign-existing-projects`, `stitch-design-taste`. Both our sessions load them automatically.
- Removed after George's review on PR #3: the 8 `gsap-*` skills and `imagegen-frontend-web` (web/DOM only), `full-output-enforcement` and `gpt-taste` (agent behaviour, not design), and `design-taste-frontend-v1` (kept the current `design-taste-frontend`).
- They are guidance only. They don't adopt any library; stack choices stay with George.
- **`06-design-direction.md` wins over the skills for the app:** native Expo/Android, springs and shared transitions, Google Sans Flex + a Georgian font, no web UI kits. Where a skill assumes a web stack or bans a font the direction picks, follow 06.
