---
name: gbrain-ingest
description: |
  Ingest meetings, articles, docs, and conversations into the brain.
  Follows the compiled truth + timeline architecture: update existing
  pages with new info, create pages for new entities, maintain cross-references.
---

# Ingest Skill

## Workflow

1. **Read the source.** Meeting transcript, article, document, conversation log.
   Identify: participants, companies, topics, decisions, action items.

2. **For each entity mentioned:**
   - `gbrain get <slug>` — does a page exist?
   - **If yes:** Read current compiled_truth. Rewrite State section with new info.
     Append to timeline. `gbrain put <slug>` with updated content.
   - **If no:** Create page using the appropriate template from schema.
     `gbrain put <slug>` with new content.

3. **Extract and create links.**
   - For every entity-to-entity reference, `gbrain link <from> <to> --context "..."`.
   - Links are bidirectional in meaning but stored directionally. Create both if both pages exist.

4. **Parse timeline entries.**
   - For each datable event in the source:
     `gbrain timeline-add <slug> --date YYYY-MM-DD --summary "..." --source "meeting/123"`

5. **Log the ingest.**
   - The system auto-logs to ingest_log. Verify with `gbrain stats`.

6. **Handle raw data.**
   - If the source includes structured data (API responses, JSON), store via
     `gbrain call brain_raw '{"slug":"...","source":"meeting","data":{...}}'`

## Entry criteria

Not everything gets a page. The bar:
- Anyone met 1:1 or in a small group: YES
- YC staff, partners, active batch founders: YES
- Companies discussed in deal context: YES
- Casual mentions with no substance: NO
- Create the page only if there's benefit from its existence.

## Quality rules

- Executive summary (blockquote at top) must be updated to reflect latest state
- State section gets REWRITTEN, not appended to
- Timeline is append-only, reverse-chronological (newest first)
- Open Threads: add new items, remove resolved ones (move to timeline)
- Every wiki link uses relative path format: [Name](../people/name.md)
