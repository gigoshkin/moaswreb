# Data and privacy: what the app stores

Facts for the privacy policy and for judges' questions. Source: the code as of 17 Oct 2026 (`apps/server/src/store/`, `apps/mobile/src/lib/`). Decision: George, 17 Oct ("reliability is more important"; see `ideas/tbilisi-transit/05-build-plan.md` §8). Update this file whenever what we store changes.

## On the phone only
- Trip names ("home → university"), start and end addresses or points, the walk to the first stop (worked out on the phone).
- The last plans (cache for instant start).
- Current location, if the user allows it: used on the phone only, never sent.

## On our server (George's VPS)
| What | Why | How it's protected |
|---|---|---|
| Per trip: first stop id, last stop id, arrive-by time, weekdays, walk minutes | To watch the trip and push "leave now" / "plan changed" when the app is closed | Encrypted at rest (AES-256-GCM); the key is only in the server environment (`TRIPS_KEY`) |
| Expo push token | To deliver the alert | Encrypted the same way |
| SHA-256 hash of the device id | To find this device's trips | The random device id itself is not stored |
| Last check-in time | 30-day auto-delete | Plain (not personal on its own) |

- **No accounts:** no name, email, phone number or Google sign-in. The device id is 144 random bits created by the app.
- **No GPS or movement tracking,** ever.
- **Deletion:** the delete button (`DELETE /me`) removes everything for the device immediately. Devices that haven't checked in for 30 days are deleted automatically (daily job).
- **Logs:** request logging is off; stops and times are never written to logs.
- **Chat:** messages, photos and PDFs sent to the chat go to the Claude API (Anthropic) to be read, together with the user's saved trips as context. Our server doesn't store them. [?] Check Anthropic's API data-retention terms before writing the policy.
- **Place search and the map pin:** the typed text (or the pin's coordinates) goes from our server to TTC's geocoder and to Photon (photon.komoot.io, OpenStreetMap data) to find streets and addresses. When `GOOGLE_PLACES_API_KEY` is set on the server, the typed text also goes to Google Places (first source; see journey-planner.md, "Google Places search"). No device id or account goes with it, and our server doesn't log it. Map pictures are loaded by the phone directly from Esri's tile server, which sees the phone's IP address and the map area on screen.
- **Push delivery:** goes through Expo's push service and Google Firebase (Android), which see the push token and the alert text.
- **Leave card (Android, dev build):** made on the phone from the cached plan; nothing is sent anywhere. It shows the trip name, line, stop and times **on the lock screen** (public visibility), from 30 min before the leave time. See dev-build.md.

## Honest limits
- The server can read stored trips while it runs; it has to, in order to watch them. Encryption protects against a stolen disk, a leaked backup or a copied database file, not against someone who takes over the running server.
- A stop pair plus a time can still be personal to someone who already knows you. That's why there's no link to a name or account.
