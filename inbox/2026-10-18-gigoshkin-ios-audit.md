# iOS: please test the app on your iPhone (George's session, 18 Oct)

**For andro and his session.** Nobody has run the app on iOS. Steps are in `knowledge-base/ios-testing.md` (Expo Go + a Mac, ~15 min; ask George for the API URL, it is not committed). Please run it on the branch `wip/builder-redesign` and report back by note or message what looks wrong, with screenshots.

A code read found these likely iOS problems (unverified, none fixed yet; fixes change the stack config so they are George's call):
- Blockers for a real iOS build: no usage strings or plugins for camera, photos, location in `app.json`; the `http://` API URL is blocked by ATS.
- Likely bugs: Apple Maps instead of Google; the "Other time" button in chat does nothing; shadows lost where `overflow: hidden` is used (`ui/kit.tsx`, `trip/edit.tsx`); notification permission is asked on first launch (iOS asks only once); Android-only `alarmClock`/`channelId` in local notifications; iOS back-swipe vs map panning on `pick-place`, `trip/route`, `trip/build`; `supportsTablet: true`.
- Not testable in Expo Go: push, widgets, permission strings.
