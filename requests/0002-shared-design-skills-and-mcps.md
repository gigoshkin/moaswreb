---
id: 0002
from: andro
to: george
status: pending        # pending | approved | rejected | changed
created: 2026-10-17 15:30
decided: 
---

# Add andro's design skills and design MCPs to the repo so both sessions use them

## What I want
Commit a shared design toolkit so both Claude sessions build screens that don't look AI-generated:

1. **Skills** in `.claude/skills/`, copied from andro's laptop (they aren't reachable from the cloud session, so andro copies them on a branch):
   `brandkit`, `design-taste-frontend`, `design-taste-frontend-v1`, `full-output-enforcement`, `gpt-taste`, `high-end-visual-design`, `image-to-code`, `imagegen-frontend-mobile`, `imagegen-frontend-web`, `industrial-brutalist-ui`, `minimalist-ui`, `redesign-existing-projects`, `stitch-design-taste`, and `gsap-core`, `gsap-frameworks`, `gsap-performance`, `gsap-plugins`, `gsap-react`, `gsap-scrolltrigger`, `gsap-timeline`, `gsap-utils`.
2. **MCP servers** in `.mcp.json` (no keys in the file; keys come from env vars):
   - shadcn MCP (`npx shadcn@latest mcp`) **[unverified command]**
   - 21st.dev Magic MCP (`npx -y @21st-dev/magic@latest`, key in env `API_KEY`) **[unverified command]**
3. **Design references** in `knowledge-base/design-references.md` (links only, nothing copied): Apple Human Interface Guidelines and Apple Design Resources, plus Material 3 for Android.

## Why
- andro wants the app to look designed, not "AI slop". `05-build-plan.md` §5 sets the same goal.
- Skills and MCPs in the repo load automatically for both sessions, so George's and andro's screens come out in one consistent style.

## Conflicts with
- Repo tooling and config (`.claude/`, `.mcp.json`) are George's area and need his approval under `CODEOWNERS`.
- **Fit with the approved stack (flagging for George):** the app is Expo / React Native for Android. These won't apply directly:
  - shadcn, 21st.dev Magic and the GSAP skills target **web** React and the DOM.
  - Apple HIG is iOS-first, while 05 §5 asks for a Material 3 / Android feel.

  They are still useful for a landing/demo page or a web "decision inspector", and the taste/minimalist/brutalist skills are style rules that apply anywhere. George may prefer only the style skills plus a React Native equivalent (for example react-native-reusables, a shadcn port to RN, **[unverified]**).

## If rejected
andro keeps the skills on their own machine only, and andro's session follows `05-build-plan.md` §5 design rules by hand.

## Decision (owner fills in)
