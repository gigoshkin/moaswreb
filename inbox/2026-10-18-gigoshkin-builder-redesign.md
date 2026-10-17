# Builder redesign, attach sheet, road shapes (gigoshkin session, 18 Oct)

Done (all on branches, none merged to `main`):
- `wip/google-map`: attach sheet in Chat (camera, photos, PDF, recent-photo strip), styled dialogs instead of native alerts, tab swipe that follows the finger.
- `wip/builder-redesign` (cut from `wip/google-map`): by-hand builder redesign (ride rail, edit/insert/replace/remove, per-ride line switches, Undo, retry buttons), and road shapes for rides (`GET /stops/shape`, `lib/shapes.ts`).

Open:
- Request 0005 to andro (flow change), pending.
- Nothing here has been run on a phone. George should test AI features first, then the builder.
- Libraries added on `wip/google-map`: `expo-media-library`, `expo-image-manipulator`.
- Black "all lines from here" preview in the builder is still straight lines.

Next for the other session: do not merge these branches without George's go.
