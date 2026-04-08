---
name: gbrain-memory
description: |
  Personal permanent memory system using gbrain as the backend storage.
  Stores facts about the user, their projects, preferences, and context.
  Follows the compiled truth + timeline architecture.
  Trigger when: user mentions remembering something, asks about their projects,
  wants to store information permanently, or says "remember that...".
---

# GBrain Memory Skill

Personal permanent memory using gbrain as the backend. Unlike session context
which is lost, gbrain stores knowledge indefinitely.

## Architecture

```
User input → Skill invoked → gbrain CLI → brain.db (permanent)
                                      ↓
                    Session context ← gbrain query ← brain.db
```

## Quick Commands

```bash
# Store a fact
gbrain put <slug> < content.md

# Ingest markdown file(s) — each ## section becomes a chunk with metadata
gbrain ingest <file1.md> [file2.md] ...

# Retrieve
gbrain get <slug>

# Search
gbrain search "<query>"        # FTS5 full-text
gbrain query "<question>"      # semantic vector

# List
gbrain list --type <type>      # person, project, concept, etc.
gbrain list --tag <tag>

# Delete (auto-backup first)
gbrain delete [-y] <slug>...   # -y skips confirmation prompt

# Stats
gbrain stats
```

## Core Operations

| Operation | When to Use |
|-----------|-------------|
| **Ingest** | User shares meeting notes, article, doc, conversation |
| **Query** | User asks a question from stored knowledge |
| **Delete** | Remove stale, incorrect, or obsolete pages |
| **Maintain** | Periodic cleanup: contradictions, stale info, orphans |
| **Enrich** | External data lookup (LinkedIn, company info, etc.) |
| **Briefing** | Compile summary of brain state |

## Detailed References

See `references/` for complete documentation:

| Reference | Purpose |
|-----------|---------|
| `references/ingest.md` | Ingest meetings, articles, docs |
| `references/query.md` | Three-layer search: FTS5 + vector + structured |
| `references/delete.md` | Remove pages safely with auto-backup |
| `references/maintain.md` | Lint: contradictions, stale info, orphans |
| `references/enrich.md` | External enrichment from APIs |
| `references/briefing.md` | Compile daily briefings |
| `references/db-management.md` | Backup and restore brain.db |
| `references/note.md` | Quick capture with LLM-inferred metadata |

## Page Structure

All pages follow **compiled truth + timeline**:

```
---
title: [Title]
type: [person|project|preference|context]
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [tags]
---

# [Title]

> **Compiled Truth** — Current understanding, always accurate.

## State

Current facts.

## Open Threads

- [ ] Items to verify or follow up

---

## Timeline

Reverse-chronological evidence. Never modified, only appended.

### YYYY-MM-DD | source | What happened
- Detail
```

## Key Memory Slugs

| Slug | Content |
|------|---------|
| `user/me` | Facts about the user |
| `user/projects` | Active projects |
| `user/context` | Current session context |
| `user/preferences` | How user likes to work |

## When to Write

1. User introduces themselves or shares a fact
2. User expresses a preference or requirement
3. A project goal or deadline is mentioned
4. User gives feedback on how to work
5. Anything useful for future sessions

## When to Read

1. Start of conversation: `gbrain get user/me`
2. When user asks about their projects
3. When making suggestions that should account for user preferences
4. **When you don't know something: search memory first, then external search** — use the shortest core keywords (add more only if nothing is found)
