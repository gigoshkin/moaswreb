# Georgian UI glossary

> **Not in use (17 Oct):** the app is English-only (George). This file and `scripts/ka-check.mjs` are kept for reference in case Georgian copy comes back.

Every Georgian word or phrase the app shows (screens, notifications, chat replies, store listing) should come from this file. `scripts/ka-check.mjs` reads the tables below: it fails on anything in **Banned** and skips the spellcheck for words in **Approved** and **Proposed**.

## Rules (George, 17 Oct)
- **Formal register.** Address the user with თქვენ forms (დაგეხმარებით, not დაგეხმარები; აირჩიეთ, not აირჩიე).
- **Use real Georgian terms, not word-for-word translations from English.** Labels are nouns where Georgian UIs use nouns: "გასვლა 08:14" (departure 08:14), not an imperative like "გადი".
- **Only a native speaker can approve a term.** Agents may add to **Proposed**; George (or andro) moves a term to **Approved** after reading it.

## Approved
| ka | en | note | source |
|---|---|---|---|
| გასვლა | departure, leaving | Labels and alerts: "გასვლა 9 წუთში", "გასვლა 08:14-ზე" | George, chat, 17 Oct 2026 |

## Banned
| ka | why | use instead | source |
|---|---|---|---|
| გადი | Informal command ("get out / go!"), wrong tone for a label or alert | გასვლა | George, chat, 17 Oct 2026 |
| დაგეხმარები | Informal "you" | დაგეხმარებით | George's formal-register rule, 17 Oct 2026 |
| ცოცხლად | Literal translation of "live" (means "alive"); not how Georgian apps say live data | Preferably no label at all (a small pulsing dot is enough); if a word is needed, "ლაივი" (proposed) | George, chat, 17 Oct 2026 |

## Proposed (needs a native speaker)
Already used in the code or the Figma file, not yet reviewed. Move a row to **Approved** or **Banned** after review.

| ka | en | where it's used | note |
|---|---|---|---|
| გასვლის დრო | departure time | — | Also means "check-out time" on ka.airbnb.com, so context matters |
| გასვლა ახლა | leave now | app, alerts (`leaveNow`) | Maybe "გასვლის დროა" (it's time to leave) reads better |
| გასვლის დრო შეიცვალა | departure time changed | alert title (`plan_changed`) | Replaces "გეგმა შეიცვალა" |
| იყო | was (previous value) | alert body "(იყო 08:10)" | |
| ჩასვლა … -მდე | arrive by … | app (`arriveBy`) | |
| ჩემი მარშრუტები | my trips | app (`myTrips`) | "მარშრუტი" is also the word for a bus route (306); maybe "ჩემი მგზავრობები" |
| ვარიანტები | options | app (`options`) | Loanword; maybe "გზები" or "მარშრუტის ვარიანტები" |
| წთ | min (abbreviation) | app | Common abbreviation, not in the dictionary |
| … წთ ფეხით | … min on foot | app (`walk`) | |
| ვარიანტი ვერ მოიძებნა | no options found | app (`noOptions`) | |
| კავშირი ვერ დამყარდა, ნაჩვენებია ბოლო შედეგი | couldn't connect; showing the last result | app (`offline`) | |
| სანიმუშო მონაცემები | sample data | app, dev only | |
| ამაში ვერ დაგეხმარებით | I can't help with that | chat refusal | |
| ლაივი | live (real-time data) | — | Only if a label is really needed; George prefers no label |
| გაჩერება | stop (bus stop) | — | Standard; TTC uses it (unverified, TTC site blocked from the cloud sandbox) |
| გადაჯდომა | transfer | — | |
| მოასწრებ | (app name) you'll make it | Figma wordmark | Brand name, informal on purpose? Ask andro |

## How to check a new term
1. Look it up here first.
2. Run `node scripts/ka-check.mjs --text "<phrase>"` to spellcheck it (catches typos, not tone or bad translations).
3. Find it used in the same sense by a Georgian product: TTC's own app and site (transit.ttc.com.ge, Georgian version), Tbilisi metro signage, Georgian Railway, Bolt/Wolt/bank apps in Georgian, or Google Maps in Georgian. Write the URL in the note. Web search works poorly for Georgian, so no hit doesn't mean the term is wrong.
4. Add it to **Proposed** and ask a native speaker. Don't ship it as final until it's in **Approved**.
