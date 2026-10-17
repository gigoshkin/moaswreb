# Stored trips + server alerts (gigoshkin, 2026-10-17)

**Decision (George):** trips are stored on the server so alerts are reliable even when the app is closed. Privacy measures: only stops and times, no addresses or names, random device id (only its hash stored), encrypted at rest, 30-day auto-delete, delete button. Facts for the privacy policy: `knowledge-base/data-and-privacy.md`.

## Done (on main)
- Server: `/me/trips`, `/me/push`, `DELETE /me`; encrypted SQLite store; AlertWatcher pushes "leave in N min" and "plan changed". 30 tests pass.
- App: random device id, trips sync on every change, push permission + token registration at start, and a **local backup notification** at the leave time from the last plan (fires even if the server is down).

## For andro (flows)
- The add-trip flow needs to produce, per trip: **first stop, last stop, arrive-by time, weekdays, and the walk from the start point to the first stop** (the app works the walk out on the phone). Only trips with stops get server alerts.
- Needed somewhere in settings: a **"delete my data" button** (the code exists: `deleteMyData()`), and a link to the privacy policy.
- The notification permission prompt currently appears at first start. Where it should appear (onboarding?) is your call.

## Open (for George)
- Push needs an **EAS project + Firebase (FCM) credentials** for Android before a real push can arrive. Needs your Expo/Google accounts.
- On the VPS: set `TRIPS_KEY` (back it up; losing it makes stored trips unreadable, and phones would re-sync) and `API_KEY`.
