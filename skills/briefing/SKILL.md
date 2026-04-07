---
name: gbrain-briefing
description: |
  Compile a daily briefing from brain state plus real-time sources.
  What changed, what's coming, who's waiting, what needs attention.
---

# Briefing Skill

## Briefing structure

1. **Calendar** — Today's meetings from external calendar source.
   For each meeting: pull brain pages for participants, surface key context.

2. **Active deals** — `gbrain list --type deal --tag active`
   State + deadlines + what's changed since last briefing.

3. **Open threads** — Scan pages for Open Threads with time-sensitive items.
   Sort by urgency.

4. **Recent brain changes** — `gbrain list` sorted by updated_at, last 24h.
   What was updated, what was ingested, what's new.

5. **People in play** — People pages updated in last 7 days with score ≥ 3.
   Quick status for each.

6. **Stale alerts** — Pages flagged by maintain skill as needing attention.

## Output

Write briefing to `sources/briefing-YYYY-MM-DD` in the brain.
Return formatted markdown suitable for Telegram delivery.
