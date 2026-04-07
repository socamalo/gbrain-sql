# GBrain embed --stale Design Spec

## Overview

Implement `gbrain embed --stale` to find and re-embed pages whose embeddings are outdated.

## Problem Statement

After a page is updated, its vector embeddings become stale but there is no way to detect which pages need re-embedding. The documented command `gbrain embed --stale` does not exist in code.

## Design

### Core Logic

**BrainDB.getStalePages()**

Returns pages that need re-embedding:

```typescript
getStalePages(): { slug: string; pageId: number; reason: "no_embedding" | "updated_since_embedding" }[]
```

SQL logic:
1. Pages with **no embedding** at all → `no_embedding`
2. Pages with embeddings where `page.updated_at > MAX(embedding.created_at)` → `updated_since_embedding`

```sql
-- no_embedding: pages without any embedding
SELECT p.slug, p.id as page_id, 'no_embedding' as reason
FROM pages p
LEFT JOIN page_embeddings pe ON p.id = pe.page_id
WHERE pe.id IS NULL

UNION ALL

-- updated_since_embedding: page updated after its latest embedding
SELECT p.slug, p.id, 'updated_since_embedding'
FROM pages p
JOIN page_embeddings pe ON p.id = pe.page_id
GROUP BY p.id
HAVING p.updated_at > MAX(pe.created_at)
```

### CLI Behavior

**`gbrain embed --stale`**

- Find all stale pages via `getStalePages()`
- Re-embed each page (delete old embeddings, insert new ones)
- Progress output:
  - slug ≤ 50 chars: `Embedding slug... done. N chunks.` per page
  - slug > 50 chars: no per-page output (only dots)
- Ollama unavailable: **error and exit code 1**
- Summary: `Done. X pages, Y chunks re-embedded.`

### Edge Cases

- Ollama service down → fail immediately with error message
- Page with no chunks (empty content) → still process, report 0 chunks
- All pages fresh → `Done. 0 pages, 0 chunks re-embedded.`

## File Changes

- `src/core/db.ts`: Add `getStalePages()` method
- `src/cli.ts`: Add `--stale` case in `embed` command

## Testing

### Unit Test (BrainDB)

Mock/in-memory SQLite, test `getStalePages()`:
1. Page with no embedding → detected as stale
2. Page with embedding, not updated since → not stale
3. Page with embedding, updated after embedding → stale
4. Page with no embedding and page with stale embedding → both detected

### Integration Test

1. Create real DB with test brain.db
2. Insert page with embeddings
3. Update page content (changes `updated_at`)
4. Run `embed --stale`
5. Verify: new embedding created, old one replaced

### Manual Test

```bash
# Check stale pages without re-embedding (list only)
# Not implementing --dry-run per user decision

# Re-embed all stale pages
gbrain embed --stale
```
