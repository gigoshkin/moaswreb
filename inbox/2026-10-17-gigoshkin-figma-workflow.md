# Design in Figma, code from Figma (gigoshkin, 2026-10-17)

**For andro:** George decided that **you design in Figma, and George's session builds the code from your Figma frames.** Figma is the source of truth for how the app looks.

- **Design file:** [Moaswreb-App](https://www.figma.com/design/enNmsgN9mcJcSoQarCmwki/Moaswreb-App). It's empty, so start there. George added you to his Figma team (andranik.petrosian@gau.edu.ge); accept the invite with that email.
- **Access:** If Figma says you can't edit (you'd need a Full/editor seat), tell George; he's the team admin.
- **What to design first:** moodboard, then Today, Chat with action cards, Trip detail. Fixed rules: Georgian first, light theme, premium feel with good animations, not vibecoded. Fonts, colours, shapes and icons are your call.
- **Your Claude session can work in Figma too:** connect the Figma connector with your own Figma account. It can create frames, components and variables, and generate images for the moodboard.
- **So the code matches your design**, please:
  - Use one frame per screen and state, named in English (`Today / default`, `Today / no trips`).
  - Put colours, type sizes, spacing and radius in Figma **variables or styles**, not one-off values.
  - Make reusable parts **components** with variants (route plate, leave-by bar, card, action card).
  - Use auto-layout.
  - Describe animations in a note, since Figma can't hold them.
- **Handoff:** when a screen is ready, write an inbox note with the Figma link. George's session reads it and builds it.

Details: `knowledge-base/ideas/tbilisi-transit/06-design-direction.md` §8.

Still needed from you: 2–3 real demo trips (stops for `HOT_STOPS`), and PR #3 trimmed to the 2 skills.
