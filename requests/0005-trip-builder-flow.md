---
id: 0005
from: george
to: andro
status: pending
created: 2026-10-18 03:00
decided:
---

# Add-trip flow: options list, per-trip avoid, map stop picker, ride rail

## What I want
Approve the reshaped "add a trip" flow built on branch `wip/google-map` and `wip/builder-redesign` (not merged to `main`):
- After both ends are set, the route screen lists the ways: a chain of line plates (arrow = change, capsule = alternative lines on the same stops), colour by type (bus green, minibus blue, metro red). One "never use these lines" row for the chosen route, instead of a switch per card.
- "Build by hand": pick stops on the map (every stop is a dot, the pin snaps slightly, a tick on each stop). The trip is a rail of rides with walks between; tap a ride to replace or remove it, "+" between two rides inserts one, per-ride line switches, Undo. Reordering is deliberately not offered.
- Pick rule: of the options within 5 min of the latest leave, least effort (walking minutes + 8 per change) wins.
- Main screen summary reads "board around … · arrive …"; the Figma LeaveByBar (node 64:600) shows a different set of numbers than the app (open question for andro).

## Why
George asked for a planner that compares every line link by link, with a per-trip avoid list, and hand-built trips for people who know their route. The old flow could not do this.

## Conflicts with
The Add-trip screens and flow in the product spec (04-product-spec.md) and the Figma frames for them.

## If rejected
George keeps the flow on the branch, and only the unchanged screens reach `main`.

## Decision (owner fills in)
