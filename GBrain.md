---
title: GBrain
type: project
created: 2026-04-05
updated: 2026-04-05
tags: [open-source, knowledge-base, sqlite, rag, thin-harness, fat-skills]
sources: [GStack-YC-Spring-2026-Talk-pptx]
---

# GBrain

> Open-source personal knowledge brain. SQLite + FTS5 + vector embeddings in one file. Thin CLI harness, fat skill files. The knowledge layer to GStack's coding layer. Together: intelligence on tap.

## State

- **Status:** Spec complete — ready to build
- **What:** Personal knowledge base as a single SQLite database with full-text search, vector embeddings, and structured queries. Thin CLI, fat markdown skills. MCP-ready from day one.
- **Why:** Git doesn't scale past ~5K files. The current brain has 1,222 people dossiers, 7,471 markdown files, 2.3GB. Git is choking. The wiki brain pattern (Karpathy compiled truth + timeline) is right — it just needs a real database underneath.
- **Architecture:** Thin CLI harness, fat skills (same as GStack)
- **Repo:** github.com/garrytan/gbrain

## Open Threads

- Garry to build with Claude Code from this spec
- Migration from /data/brain/ (7,471 files) must be lossless and round-trippable

## See Also

- [GStack](gstack.md)
- [Garry's List](../civic/garrys-list.md)

---

# GBrain: Complete Build Spec

## 1. Premises

### Why SQLite over Postgres/other?

Single file. No server. No connection strings. No Docker. No managed database. `brain.db` is a 500MB file you can `scp`, `rsync`, back up to S3, or carry on a USB stick. SQLite handles concurrent reads and serialized writes at the scale of a personal knowledge base (tens of thousands of pages, not millions of rows/sec) without breaking a sweat.

Postgres is better if you need multi-user writes, replication, or row-level security. None of those apply here. This is one person's brain. One writer, many readers. SQLite's sweet spot.

### Why FTS5 + vector in the same DB?

One query interface. No separate Pinecone, no Chroma sidecar, no Qdrant container. Full-text search and semantic search live in the same database, queryable from the same connection. A single `gbrain query` can fan out to FTS5 for keyword matches and vector similarity for semantic matches, merge results, and return a ranked answer — all without network hops or service coordination.

### Why thin CLI + fat skills?

Proven by GStack at 64K+ stars. The CLI is ~500 lines of TypeScript that dispatches commands to a core library. The intelligence lives in SKILL.md files — fat markdown documents that Claude Code reads and follows. This means:

- The CLI never needs to be smart. It's plumbing.
- The skills can be updated by editing markdown. No recompile, no redeploy.
- Claude Code reads SKILL.md at session start and knows every workflow, heuristic, and edge case.
- Users who don't use Claude Code still get a fast, Unix-friendly CLI.

### Why MCP from day one?

Every AI tool — Claude Code, Wintermute, Cursor, Windsurf, any future MCP client — needs to read and write the brain. MCP (Model Context Protocol) is the emerging standard for tool-use. If gbrain exposes an MCP server, any compliant client can search, read, write, ingest, and query the brain without custom integration.

Stdio transport means zero config: `gbrain serve` and pipe it to the client.

### Lossless migration

The current brain at `/data/brain/` has 7,471 markdown files with YAML frontmatter, compiled truth sections, timelines, wiki links, tags, and `.raw/` JSON sidecars. The migration to SQLite must be:

1. **Lossless** — every byte of content preserved
2. **Round-trippable** — `gbrain export` recreates the original markdown directory structure
3. **Verifiable** — page count, content hash, link count all validated post-migration

---

## 2. Schema Design

### Core principle: compiled truth + timeline

The brain's architecture is "above the line / below the line":

- **Above the line (compiled truth):** Always current. Rewritten when new info arrives. The intelligence assessment.
- **Below the line (timeline):** Append-only. Never rewritten. The evidence base.

This architecture is preserved exactly in SQLite. The `compiled_truth` column is the above-the-line content. The `timeline` column is the below-the-line content. The horizontal rule (`---`) separator is implicit — reconstructed on export.

### SQL Schema

```sql
-- brain.db schema

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- pages: the core content table
-- ============================================================
CREATE TABLE pages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL UNIQUE,  -- e.g. "people/pedro-franceschi"
  type          TEXT    NOT NULL,         -- person, company, deal, yc, civic, project, concept, source, media
  title         TEXT    NOT NULL,
  compiled_truth TEXT   NOT NULL DEFAULT '',  -- markdown, above the line
  timeline      TEXT    NOT NULL DEFAULT '',  -- markdown, below the line
  frontmatter   TEXT    NOT NULL DEFAULT '{}', -- JSON blob (original YAML converted)
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_pages_type ON pages(type);
CREATE INDEX idx_pages_slug ON pages(slug);

-- ============================================================
-- page_fts: full-text search over compiled_truth + timeline
-- ============================================================
CREATE VIRTUAL TABLE page_fts USING fts5(
  title,
  compiled_truth,
  timeline,
  content='pages',
  content_rowid='id',
  tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO page_fts(rowid, title, compiled_truth, timeline)
  VALUES (new.id, new.title, new.compiled_truth, new.timeline);
END;

CREATE TRIGGER pages_ad AFTER DELETE ON pages BEGIN
  INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline)
  VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline);
END;

CREATE TRIGGER pages_au AFTER UPDATE ON pages BEGIN
  INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline)
  VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline);
  INSERT INTO page_fts(rowid, title, compiled_truth, timeline)
  VALUES (new.id, new.title, new.compiled_truth, new.timeline);
END;

-- ============================================================
-- page_embeddings: vector embeddings for semantic search
-- ============================================================
CREATE TABLE page_embeddings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,    -- 0-based index within page
  chunk_text  TEXT    NOT NULL,    -- the text that was embedded
  embedding   BLOB   NOT NULL,    -- float32 array as raw bytes
  model       TEXT   NOT NULL DEFAULT 'text-embedding-3-small',  -- which model generated this
  created_at  TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_embeddings_page ON page_embeddings(page_id);

-- ============================================================
-- links: cross-references between pages
-- ============================================================
CREATE TABLE links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  to_page_id   INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  context      TEXT    NOT NULL DEFAULT '',  -- the sentence containing the link
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(from_page_id, to_page_id)
);

CREATE INDEX idx_links_from ON links(from_page_id);
CREATE INDEX idx_links_to   ON links(to_page_id);

-- ============================================================
-- tags
-- ============================================================
CREATE TABLE tags (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL,
  UNIQUE(page_id, tag)
);

CREATE INDEX idx_tags_tag     ON tags(tag);
CREATE INDEX idx_tags_page_id ON tags(page_id);

-- ============================================================
-- raw_data: sidecar data (replaces .raw/ JSON files)
-- ============================================================
CREATE TABLE raw_data (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  source     TEXT    NOT NULL,    -- "crustdata", "happenstance", "exa", "partiful"
  data       TEXT    NOT NULL,    -- full JSON response
  fetched_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(page_id, source)        -- one row per source per page, overwrite on re-enrich
);

CREATE INDEX idx_raw_data_page ON raw_data(page_id);

-- ============================================================
-- timeline_entries: structured timeline (supplements markdown)
-- ============================================================
CREATE TABLE timeline_entries (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id  INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  date     TEXT    NOT NULL,      -- ISO 8601: YYYY-MM-DD
  source   TEXT    NOT NULL DEFAULT '',  -- "meeting", "email", "manual", etc.
  summary  TEXT    NOT NULL,      -- one-line summary
  detail   TEXT    NOT NULL DEFAULT '',  -- full markdown detail
  created_at TEXT  NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_timeline_page ON timeline_entries(page_id);
CREATE INDEX idx_timeline_date ON timeline_entries(date);

-- ============================================================
-- ingest_log: replaces log.md
-- ============================================================
CREATE TABLE ingest_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type   TEXT    NOT NULL,    -- "meeting", "article", "doc", "conversation", "import"
  source_ref    TEXT    NOT NULL,    -- meeting ID, URL, file path, etc.
  pages_updated TEXT    NOT NULL DEFAULT '[]',  -- JSON array of page slugs
  summary       TEXT    NOT NULL DEFAULT '',
  timestamp     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ============================================================
-- config: brain-level settings
-- ============================================================
CREATE TABLE config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Default config
INSERT INTO config (key, value) VALUES
  ('version', '1'),
  ('embedding_model', 'text-embedding-3-small'),
  ('embedding_dimensions', '1536'),
  ('chunk_strategy', 'section');  -- "page", "section", or "paragraph"
```

### Field conventions

- All text fields: UTF-8
- All dates: ISO 8601 (`YYYY-MM-DDTHH:MM:SSZ` for timestamps, `YYYY-MM-DD` for dates)
- Embeddings: raw `Float32Array` bytes in BLOB columns. 1536 floats × 4 bytes = 6,144 bytes per chunk for `text-embedding-3-small`
- JSON fields (`frontmatter`, `data`, `pages_updated`): stored as TEXT, parsed in application layer
- Slugs include directory prefix: `people/pedro-franceschi`, `companies/river-ai`, `deals/river-ai-series-a`

---

## 3. CLI Design

### The resolver pattern

Stolen from `bin/gl` in Garry's List. The CLI is a thin dispatcher:

```
bin/gbrain <command> [args...]     # dispatch to command handler
bin/gbrain call <tool> '<json>'    # raw tool call (GL pattern)
bin/gbrain --tools-json            # tool discovery for Claude Code
bin/gbrain pipe                    # JSONL pipe mode for streaming
```

### Command reference

```
gbrain get <slug>                          # read a page by slug
gbrain put <slug> [< file.md]             # write/update a page (stdin or file)
gbrain search <query>                      # FTS5 full-text search
gbrain query <question>                    # semantic search → ranked results
gbrain ingest <file> [--type meeting|article|doc|conversation]
                                           # ingest a source document
gbrain link <from-slug> <to-slug> [--context "..."]
                                           # create cross-reference
gbrain unlink <from-slug> <to-slug>        # remove cross-reference
gbrain tags <slug>                         # list tags for a page
gbrain tag <slug> <tag>                    # add tag
gbrain untag <slug> <tag>                  # remove tag
gbrain timeline <slug>                     # show timeline entries
gbrain timeline-add <slug> --date YYYY-MM-DD --summary "..." [--source "..."] [--detail "..."]
                                           # add structured timeline entry
gbrain backlinks <slug>                    # show pages linking TO this slug
gbrain list [--type person] [--tag yc-alum] [--limit 50]
                                           # list pages with filters
gbrain stats                               # brain statistics
gbrain export [--dir ./export/]            # export to markdown files
gbrain import <dir>                        # import from markdown directory
gbrain embed [<slug>|--all]                # generate/regenerate embeddings
gbrain serve                               # start MCP server (stdio)
gbrain call <tool> '<json>'                # raw tool call
gbrain --tools-json                        # tool discovery JSON
gbrain pipe                                # JSONL pipe mode
gbrain version                             # version info
gbrain init [path]                         # create a new brain.db
```

### CLI architecture

```
bin/gbrain                    # compiled Bun binary (~10MB)
  ├── src/cli.ts              # argument parser + command dispatcher
  ├── src/commands/            # one file per command
  │   ├── get.ts
  │   ├── put.ts
  │   ├── search.ts
  │   ├── query.ts
  │   ├── ingest.ts
  │   ├── link.ts
  │   ├── tags.ts
  │   ├── timeline.ts
  │   ├── list.ts
  │   ├── stats.ts
  │   ├── export.ts
  │   ├── import.ts
  │   ├── embed.ts
  │   ├── serve.ts
  │   └── call.ts
  ├── src/core/               # shared library
  │   ├── db.ts               # database connection + helpers
  │   ├── fts.ts              # FTS5 search logic
  │   ├── embeddings.ts       # vector embedding + cosine similarity
  │   ├── markdown.ts         # frontmatter parsing, content splitting
  │   ├── links.ts            # link extraction + resolution
  │   └── migrate.ts          # markdown directory → SQLite migration
  └── src/mcp/                # MCP server
      └── server.ts           # stdio MCP server exposing tools
```

### Output format

- Default: plain text / markdown (human-readable, Claude-friendly)
- `--json`: JSON output for programmatic use
- `gbrain pipe`: JSONL streaming mode (one JSON object per line)
- `gbrain --tools-json`: tool discovery format (compatible with Claude Code tool use)

### Database location

Default: `./brain.db` in current directory. Override with:
- `GBRAIN_DB` environment variable
- `--db /path/to/brain.db` flag

### Example session

```bash
# Import existing brain
$ gbrain import /data/brain/
Importing 7,471 files...
  people: 1,222 pages
  companies: 847 pages
  deals: 234 pages
  ...
  links: 14,329 cross-references extracted
  raw_data: 892 sidecar files loaded
  timeline_entries: 23,441 entries parsed
Done. brain.db: 487MB (with embeddings: 1.2GB)
Validation: 7,471 files → 7,471 pages ✓

# Search
$ gbrain search "River AI"
people/ali-partovi.md (score: 12.3)
  ...River AI board member since 2024...
companies/river-ai.md (score: 45.7)
  ...River AI is building...

# Semantic query
$ gbrain query "who knows Jensen Huang?"
Searching 7,471 pages (FTS5 + vector)...
  people/ali-partovi.md — mentioned NVIDIA partnership
  people/ilya-sutskever.md — co-presented at NeurIPS
  people/marc-andreessen.md — board connection via Meta
  ...

# Read a page
$ gbrain get pedro-franceschi
---
title: Pedro Franceschi
type: person
...
---
# Pedro Franceschi
> Co-founder and CEO of Brex. YC alum...

# Update a page
$ cat updated-pedro.md | gbrain put people/pedro-franceschi

# Check stats
$ gbrain stats
Pages:           7,471
  people:        1,222
  companies:       847
  deals:           234
  yc:              156
  ...
Links:          14,329
Tags:            8,892
Raw data:          892
Timeline entries: 23,441
Embeddings:     41,203 chunks
DB size:         1.2GB

# Start MCP server
$ gbrain serve
GBrain MCP server running (stdio)
Tools: search, get, put, ingest, link, query, timeline, tags, list, stats
```

---

## 4. MCP Server

### Transport

Stdio (standard MCP). The client spawns `gbrain serve` as a subprocess and communicates via stdin/stdout JSON-RPC.

### Configuration

Claude Code `~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "gbrain": {
      "command": "gbrain",
      "args": ["serve", "--db", "/path/to/brain.db"]
    }
  }
}
```

### Tools exposed

| Tool | Description | Parameters |
|------|-------------|------------|
| `brain_search` | FTS5 full-text search | `{ query: string, type?: string, limit?: number }` |
| `brain_query` | Semantic search (FTS5 + vector) | `{ question: string, limit?: number }` |
| `brain_get` | Read a page by slug | `{ slug: string }` |
| `brain_put` | Write/update a page | `{ slug: string, content: string }` or `{ slug: string, compiled_truth?: string, timeline_append?: string, frontmatter?: object }` |
| `brain_ingest` | Ingest a source document | `{ content: string, source_type: string, source_ref: string }` |
| `brain_link` | Create cross-reference | `{ from: string, to: string, context?: string }` |
| `brain_timeline` | Get timeline entries | `{ slug: string, limit?: number }` |
| `brain_timeline_add` | Add timeline entry | `{ slug: string, date: string, summary: string, source?: string, detail?: string }` |
| `brain_tags` | List tags for a page | `{ slug: string }` |
| `brain_tag` | Add/remove tag | `{ slug: string, tag: string, remove?: boolean }` |
| `brain_list` | List pages with filters | `{ type?: string, tag?: string, limit?: number }` |
| `brain_backlinks` | Pages linking to a slug | `{ slug: string }` |
| `brain_stats` | Brain statistics | `{}` |
| `brain_raw` | Read/write raw enrichment data | `{ slug: string, source?: string, data?: object }` |

### Resources exposed

| Resource | URI pattern | Description |
|----------|------------|-------------|
| Page | `brain://pages/{slug}` | Full page content as markdown |
| Index | `brain://index` | All page slugs grouped by type |

### Prompts exposed

| Prompt | Description |
|--------|-------------|
| `brain_briefing` | Compile a briefing from current brain state |
| `brain_ingest_meeting` | Guide for ingesting a meeting transcript |

---

## 5. Skills (Fat Markdown)

Skills live in `skills/` at the repo root. Each is a standalone markdown file that Claude Code reads and follows.

### skills/ingest/SKILL.md

```markdown
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
- Anyone Garry met 1:1 or in a small group: YES
- YC staff, partners, active batch founders: YES
- Companies discussed in deal context: YES
- Casual mentions with no substance: NO
- Create the page only if Garry benefits from its existence.

## Quality rules

- Executive summary (blockquote at top) must be updated to reflect latest state
- State section gets REWRITTEN, not appended to
- Timeline is append-only, reverse-chronological (newest first)
- Open Threads: add new items, remove resolved ones (move to timeline)
- Every wiki link uses relative path format: [Name](../people/name.md)
```

### skills/query/SKILL.md

```markdown
---
name: gbrain-query
description: |
  Answer questions from the brain using FTS5 + semantic search + structured queries.
  Synthesize across multiple pages. Cite sources.
---

# Query Skill

## Strategy: Three-layer search

1. **FTS5 keyword search** — `gbrain search "<query>"` — fast, exact matches.
   Best for: names, company names, specific terms.

2. **Semantic vector search** — `gbrain query "<question>"` — meaning-based.
   Best for: "who knows X?", "what's our thesis on Y?", conceptual questions.

3. **Structured queries** — `gbrain list --type person --tag yc-alum` +
   `gbrain backlinks <slug>` — relational navigation.
   Best for: "all YC founders in batch W25", "who links to Jensen Huang?"

## Workflow

1. Decompose the question into search strategies.
2. Run FTS5 search for key terms.
3. Run semantic query for the full question.
4. Merge and deduplicate results.
5. For top results, `gbrain get <slug>` to read full pages.
6. Synthesize answer with citations: "[Pedro Franceschi](people/pedro-franceschi)"
7. If the answer is valuable enough to keep, consider creating a new page.

## Ranking heuristic

- FTS5 score × 0.4 + vector similarity × 0.6 = combined score
- Boost pages with type matching the question intent (+0.2 for person queries hitting person pages)
- Boost pages updated in last 30 days (+0.1)
- Penalize pages with score/skill < 2 in frontmatter (-0.1)

## When you don't know

Say so. "The brain doesn't have info on X" is better than hallucinating.
Suggest enrichment: "Want me to research X via Happenstance/Crustdata and add them?"
```

### skills/maintain/SKILL.md

```markdown
---
name: gbrain-maintain
description: |
  Periodic brain maintenance. Find contradictions, stale info, orphan pages,
  missing cross-references. Keep the knowledge graph healthy.
---

# Maintain Skill

## Lint checks (run every few days)

### 1. Contradictions
- Compare State sections across linked pages
- Flag: Page A says "CEO of X" but Page B says "left X in 2025"
- Resolution: check timeline entries for latest evidence, update the stale page

### 2. Stale info
- `gbrain list --type person` → for each, check if compiled_truth references
  dates > 6 months old without newer timeline entries
- Flag pages where the State section hasn't been updated but timeline has new entries
- These need their compiled_truth rewritten from latest timeline evidence

### 3. Orphan pages
- `gbrain list` → for each, `gbrain backlinks <slug>`
- Pages with zero inbound links are orphans
- Either add links from related pages or flag for potential deletion

### 4. Missing cross-references
- Scan compiled_truth for mentions of known page titles that aren't linked
- "Pedro Franceschi mentioned Brex" but no link to companies/brex → add link

### 5. Dead links
- For each link in the links table, verify both pages still exist
- Remove links to deleted pages

### 6. Open thread audit
- Pages with Open Threads items older than 30 days → flag for review
- Resolved items still in Open Threads → move to timeline

### 7. Tag consistency
- List all unique tags. Flag near-duplicates: "yc-alum" vs "yc_alum" vs "yc alum"
- Normalize tag format: lowercase, hyphens

### 8. Embedding freshness
- Pages updated since last embedding generation need re-embedding
- `gbrain embed --stale` to find and re-embed outdated pages

## Output

Generate a maintenance report as a source page:
`gbrain put sources/maintenance-YYYY-MM-DD` with findings and actions taken.
```

### skills/enrich/SKILL.md

```markdown
---
name: gbrain-enrich
description: |
  Enrich person and company pages from external sources.
  Crustdata, Happenstance, Exa, Captain (Pitchbook). Validation rules enforced.
---

# Enrich Skill

## Sources

| Source | Best for | Cost |
|--------|----------|------|
| Crustdata | LinkedIn profile data (90+ fields) | API key |
| Happenstance | Career history, network search | 1-2 credits/call |
| Exa | Web search, articles, mentions | API key |
| Captain/Pitchbook | Company financials, deals, investors | API key |

## Person enrichment workflow

1. **Find LinkedIn URL** — check existing page frontmatter, Google Contacts, or Happenstance search.

2. **Hit Crustdata** — `GET /screener/person/enrich?linkedin_profile_url=...`
   - Auth: `Token` (NOT Bearer!)
   - Returns: name, title, location, headline, summary, skills, work history, education, twitter, email

3. **Validate before writing:**
   - Connection count < 20 → likely wrong person. Save to raw_data with validation flag, don't update page.
   - Name mismatch (different last name) → skip.
   - Obviously joke profiles → skip.

4. **Store raw data** — `gbrain call brain_raw '{"slug":"people/name","source":"crustdata","data":{...}}'`

5. **Distill to page** — Update compiled_truth with:
   - Location, current title, company, headline
   - Education (one line)
   - Career arc (condensed: "Auctomatic → YC Partner → Triplebyte CEO")
   - Top 3-5 skills
   - Twitter handle, LinkedIn URL

6. **DO NOT dump full data into the page.** 50 skills, 10 job descriptions → stays in raw_data only.

## Company enrichment workflow

1. **Captain API** — Search by domain, get bio, financing, investors.
2. **Crustdata** — Company search for social analytics, employee data.
3. **Store raw** → distill highlights → update page State section.

## Batch rules

- Checkpoint every 20 items to state file
- Exponential backoff on 429s (10s → 20s → 40s → ... → 5min cap)
- Dry-run mode: `--dry-run` shows what would be enriched without API calls
- Never redo already-enriched pages (check raw_data table for existing source entries)
```

### skills/briefing/SKILL.md

```markdown
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
```

---

## 6. Migration Plan

### From `/data/brain/` (7,471 files, 2.3GB) → brain.db

The migration is implemented as `gbrain import <dir>`. Here's the exact algorithm:

### Step 1: Scan directory

```typescript
// Recursively find all .md files, excluding schema.md, index.md, log.md, README.md
// Map directory → type: people/ → "person", companies/ → "company", etc.
const typeMap: Record<string, string> = {
  'people': 'person',
  'companies': 'company',
  'deals': 'deal',
  'yc': 'yc',
  'civic': 'civic',
  'projects': 'project',
  'concepts': 'concept',
  'sources': 'source',
  'media': 'media',
  'meetings': 'source',
  'programs': 'source',
};
```

### Step 2: Parse each file

```typescript
function parseMarkdownFile(content: string, filePath: string) {
  // 1. Extract YAML frontmatter (between first --- and second ---)
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const frontmatter = yaml.parse(frontmatterMatch[1]);
  const body = frontmatterMatch[2];

  // 2. Split body at first horizontal rule (--- on its own line, after frontmatter)
  //    This separates compiled_truth from timeline
  const hrIndex = body.search(/\n---\n/);
  let compiledTruth: string;
  let timeline: string;

  if (hrIndex !== -1) {
    compiledTruth = body.substring(0, hrIndex).trim();
    timeline = body.substring(hrIndex + 5).trim();  // skip \n---\n
  } else {
    compiledTruth = body.trim();
    timeline = '';
  }

  // 3. Extract slug from file path
  //    /data/brain/people/pedro-franceschi.md → "people/pedro-franceschi"
  const slug = filePath.replace(/\.md$/, '');

  return { slug, frontmatter, compiledTruth, timeline };
}
```

### Step 3: Extract links

```typescript
// Parse wiki-style links: [Display Text](../people/name.md)
// Convert to page slugs: "people/name"
const linkRegex = /\[([^\]]+)\]\((\.\.\/)?([\w\/-]+)\.md\)/g;
// For each match, record: from_slug, to_slug, surrounding sentence as context
```

### Step 4: Extract timeline entries

```typescript
// Parse timeline lines: - **YYYY-MM-DD** | Source — Summary. Detail.
const timelineRegex = /^- \*\*(\d{4}-\d{2}-\d{2})\*\*\s*\|\s*([^—]+)—\s*(.+)$/gm;
// Each match → { date, source, summary }
// Multi-line detail (indented continuation) → detail field
```

### Step 5: Load raw data sidecars

```typescript
// For people/pedro-franceschi.md, check people/.raw/pedro-franceschi.json
// If exists, parse JSON and store each source key as a separate raw_data row
// { "sources": { "crustdata": {...}, "happenstance": {...} } }
// → raw_data rows: (page_id, "crustdata", JSON, fetched_at), (page_id, "happenstance", JSON, fetched_at)
```

### Step 6: Extract tags

```typescript
// From frontmatter.tags array
// e.g. tags: [yc-alum, founder, ai] → 3 rows in tags table
```

### Step 7: Insert into SQLite

```typescript
// Use a transaction for the entire import
db.exec('BEGIN TRANSACTION');

// Insert pages, get IDs
// Insert tags
// Resolve link slugs → page IDs, insert links
// Insert timeline entries
// Insert raw data
// Log the import in ingest_log

db.exec('COMMIT');
```

### Step 8: Generate embeddings

```typescript
// For each page, chunk the compiled_truth + timeline
// Chunk strategy: split on ## headers (section-level)
// Each chunk → call embedding API → store in page_embeddings
// This is the slowest step. ~7,500 pages × ~3 chunks avg = ~22,500 API calls
// At $0.02/1M tokens with text-embedding-3-small, total cost ~$0.50
// Parallelize with 10 concurrent requests, rate limit to 3,000 RPM
```

### Step 9: Validate

```typescript
// Count pages in DB vs files on disk — must match
// Count links vs parsed wiki links — must match
// Spot-check 10 random pages: export → diff against original file
// Report any discrepancies
```

### Step 10: Ingest special files

```typescript
// index.md → config table as 'original_index'
// log.md → parse entries into ingest_log
// schema.md → config table as 'original_schema'
```

### Round-trip: `gbrain export`

The export command reconstructs the original directory structure:

```typescript
function exportPage(page: Page): string {
  // 1. Reconstruct YAML frontmatter from frontmatter JSON
  const yaml = stringifyYaml(JSON.parse(page.frontmatter));

  // 2. Reconstruct body
  let body = page.compiled_truth;
  if (page.timeline) {
    body += '\n\n---\n\n' + page.timeline;
  }

  // 3. Combine
  return `---\n${yaml}---\n\n${body}\n`;
}

// Write to: <export-dir>/<slug>.md
// Reconstruct .raw/ sidecars from raw_data table
// Generate index.md from page list
// Validate: diff against original import source
```

---

## 7. Architecture Diagram

```
╔══════════════════════════════════════════════════════════════╗
║                      CONSUMERS                               ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Claude Code          Wintermute        Any MCP Client       ║
║  (via MCP)            (via MCP/CLI)     (via MCP)            ║
║       │                    │                 │               ║
║       └────────┬───────────┘                 │               ║
║                │                             │               ║
║     ┌──────────▼───────────┐    ┌────────────▼──────────┐   ║
║     │   MCP Server         │    │   CLI                  │   ║
║     │   (stdio transport)  │    │   bin/gbrain           │   ║
║     │   gbrain serve       │    │   compiled Bun binary  │   ║
║     └──────────┬───────────┘    └────────────┬──────────┘   ║
║                │                             │               ║
║                └────────────┬────────────────┘               ║
║                             │                                ║
║                  ┌──────────▼──────────┐                     ║
║                  │    gbrain-core      │                     ║
║                  │    (TypeScript)     │                     ║
║                  │                     │                     ║
║                  │  ┌───────────────┐  │                     ║
║                  │  │ db.ts         │  │                     ║
║                  │  │ fts.ts        │  │                     ║
║                  │  │ embeddings.ts │  │                     ║
║                  │  │ markdown.ts   │  │                     ║
║                  │  │ links.ts      │  │                     ║
║                  │  │ migrate.ts    │  │                     ║
║                  │  └───────────────┘  │                     ║
║                  └──────────┬──────────┘                     ║
║                             │                                ║
║                  ┌──────────▼──────────┐                     ║
║                  │     SQLite DB       │                     ║
║                  │     brain.db        │                     ║
║                  │                     │                     ║
║                  │  ┌──────────────┐   │                     ║
║                  │  │ pages        │   │                     ║
║                  │  │ page_fts     │   │                     ║
║                  │  │ page_embed.  │   │                     ║
║                  │  │ links        │   │                     ║
║                  │  │ tags         │   │                     ║
║                  │  │ raw_data     │   │                     ║
║                  │  │ timeline_ent.│   │                     ║
║                  │  │ ingest_log   │   │                     ║
║                  │  │ config       │   │                     ║
║                  │  └──────────────┘   │                     ║
║                  └─────────────────────┘                     ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║                      SKILLS (Fat Markdown)                   ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  skills/ingest/SKILL.md    — meeting/doc/article ingestion   ║
║  skills/query/SKILL.md     — search + synthesis              ║
║  skills/maintain/SKILL.md  — lint, contradictions, orphans   ║
║  skills/enrich/SKILL.md    — Crustdata/Happenstance/Exa      ║
║  skills/briefing/SKILL.md  — daily briefing compilation      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### Data flow: Ingest

```
Source document (meeting notes, article, transcript)
    │
    ▼
gbrain ingest (or brain_ingest MCP tool)
    │
    ├─→ Parse entities, decisions, relationships
    │
    ├─→ For each entity:
    │     ├─ gbrain get <slug>  →  exists? update compiled_truth
    │     └─ doesn't exist?     →  gbrain put <slug> (create)
    │
    ├─→ gbrain link (cross-references)
    │
    ├─→ gbrain timeline-add (structured entries)
    │
    ├─→ gbrain embed <slug> (update vectors)
    │
    └─→ ingest_log entry (automatic)
```

### Data flow: Query

```
"Who knows Jensen Huang?"
    │
    ▼
gbrain query
    │
    ├─→ FTS5: search for "Jensen Huang" → ranked page list
    │
    ├─→ Vector: embed question → cosine similarity → ranked chunks
    │
    ├─→ Merge + deduplicate + re-rank
    │
    ├─→ For top results: gbrain get <slug> → full page content
    │
    └─→ Return: ranked pages with relevant excerpts
```

---

## 8. Tech Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Runtime | **Bun** | Same as GStack. Compiled binary via `bun build --compile`. Native SQLite, native TypeScript. No `node_modules` at runtime. |
| Database | **SQLite via bun:sqlite** | Built into Bun. No native addons. No `better-sqlite3`. `new Database("brain.db")`. |
| Full-text search | **FTS5** | Built into SQLite. Porter stemmer + unicode61 tokenizer. Handles 100K+ documents easily. |
| Vector search | **Float32 blobs + JS cosine similarity** | Zero native extensions. Store embeddings as raw Float32Array bytes. Cosine similarity in ~10 lines of TypeScript. Fast enough for <100K vectors. (See Open Questions for sqlite-vec discussion.) |
| Embeddings | **OpenAI text-embedding-3-small** (configurable) | 1536 dimensions, $0.02/1M tokens. Configurable via config table — can swap to Voyage, nomic-embed, or any provider. |
| MCP | **@modelcontextprotocol/sdk** | Official MCP SDK. Stdio transport. |
| Markdown | **unified/remark + gray-matter** | Frontmatter parsing (gray-matter), markdown AST for link extraction (remark-parse). Battle-tested, well-maintained. |
| YAML | **yaml** (npm) | YAML 1.2 compliant. For frontmatter round-tripping. |

### Build

```bash
# Development
bun run src/cli.ts -- get people/pedro-franceschi

# Compile
bun build --compile --outfile bin/gbrain src/cli.ts

# Test
bun test

# Install globally
cp bin/gbrain /usr/local/bin/gbrain
```

### Dependencies (minimal)

```json
{
  "name": "gbrain",
  "version": "0.1.0",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "gray-matter": "^4.0.3",
    "yaml": "^2.4.0"
  },
  "devDependencies": {
    "bun-types": "latest"
  }
}
```

No remark needed at build time — link extraction uses regex (faster, simpler for wiki-link patterns). gray-matter handles frontmatter. Everything else is Bun built-ins.

---

## 9. What Makes This Different

| | Obsidian | Notion | RAG frameworks | GBrain |
|---|---|---|---|---|
| GUI | Electron app | Web app | N/A | None. CLI + MCP. |
| Storage | Markdown files | Cloud DB | External vector store | Single SQLite file |
| Search | Plugin-based | Cloud search | Vector only | FTS5 + vector + structured |
| AI integration | Plugin marketplace | Built-in AI | Framework-dependent | MCP native. Any client. |
| Data ownership | Local files | SaaS lock-in | Depends | Single file. You own it. |
| Intelligence | In plugins (JS) | In platform | In application code | In skills (markdown). Fat skills, thin code. |
| Knowledge model | Flat notes + links | Pages + databases | Documents + chunks | Compiled truth + timeline. Above/below the line. |
| Scale | Fine to ~10K files | Fine | Depends on vector DB | SQLite handles millions of rows |
| Git-friendly | Yes (it's files) | No | No | Via export (escape hatch). DB itself needs no git. |

**The core insight:** GBrain is not a note-taking app. It's a **compiled knowledge graph** with structured workflows, maintained by AI agents, queryable by any MCP client. The intelligence lives in fat markdown skills, not in application code. Claude Code reads `ingest/SKILL.md` and knows exactly how to process a meeting transcript into cross-referenced, timeline-annotated brain pages — without any of that logic being coded into the binary.

---

## 10. Open Questions

### sqlite-vec vs pure JS cosine similarity

**Option A: sqlite-vec extension**
- Pros: 10-100x faster vector search, native SQL integration (`SELECT * FROM page_embeddings WHERE embedding MATCH ?`), index support (IVF/HNSW possible)
- Cons: Native extension. Must compile or download for each platform. Bun's native module support is improving but not guaranteed. Additional install step.

**Option B: Pure JS cosine similarity (recommended for v1)**
- Pros: Zero native deps. Works everywhere Bun works. ~10 lines of code. No install friction.
- Cons: O(n) full scan. For 50K chunks at 1536 dimensions, a query takes ~200-500ms. Acceptable for personal use.
- Code: load all embeddings into memory on startup (~300MB for 50K chunks × 6KB each), compute cosine similarity in a loop, return top-k.

**Recommendation:** Start with pure JS. It works. Add sqlite-vec as an optional acceleration layer when the brain exceeds 100K chunks or query latency exceeds 1s.

### Embedding model

**Recommended default:** OpenAI `text-embedding-3-small` (1536 dims, $0.02/1M tokens)
- Configurable via `config` table. The `page_embeddings.model` column tracks which model generated each embedding, allowing mixed models during migration.
- Alternative providers: Voyage AI (`voyage-3`, better for code), local nomic-embed (free, slower, requires local inference).
- Config: `gbrain config set embedding_model voyage-3`

### Chunk strategy

**Recommended:** Section-level (`## Header` boundaries)
- Per-page: too coarse. A 5,000-word person page has many distinct topics.
- Per-paragraph: too fine. Loses context. Embedding quality drops.
- Per-section: right balance. Each `## State`, `## Assessment`, `## Timeline` section becomes a chunk. ~200-800 tokens per chunk. Good embedding quality, good retrieval precision.
- Fallback for pages without headers: chunk at ~500 token boundaries.

### Timeline entries table: duplicate or replace?

**Recommended: Supplement, don't replace.**
- The `timeline` column in `pages` keeps the full markdown timeline (the source of truth for round-trip export).
- The `timeline_entries` table provides structured access (query by date, source, filter).
- On import: parse the markdown timeline into `timeline_entries` rows.
- On export: regenerate timeline markdown from `timeline_entries` if the structured data is richer, otherwise use the `timeline` column as-is.
- On add: write to both (append markdown line to `timeline` column + insert `timeline_entries` row).

### Multi-brain support

**Recommended: Yes, from day one.**
- Each brain is one `.db` file. `GBRAIN_DB=/path/to/work.db gbrain stats`
- The CLI, MCP server, and all commands work against whichever DB is specified.
- No application-level complexity needed — just a different file path.
- Use cases: personal brain, work brain, project-specific brain, shared team brain.

### Real-time sync / file watching

**Recommended: Explicit commands only (v1).**
- `gbrain import` and `gbrain put` are explicit writes.
- No file watcher. No fsnotify. No daemon sitting in the background.
- Rationale: The brain is written by AI agents, not by humans editing markdown in Vim. The agents use the CLI or MCP. There's no "file on disk changed" event to watch for.
- Future: if someone wants an Obsidian-like editing experience, a `gbrain watch <dir>` command could sync a markdown directory to the DB. But that's v2.

---

## 11. Repository Structure

```
gbrain/
├── README.md                  # Project overview + quick start
├── CLAUDE.md                  # Claude Code instructions
├── LICENSE                    # MIT
├── package.json
├── tsconfig.json
├── bun.lock
│
├── bin/
│   └── gbrain                 # compiled binary (gitignored, built via bun build)
│
├── src/
│   ├── cli.ts                 # entry point: arg parsing + command dispatch
│   ├── commands/
│   │   ├── get.ts
│   │   ├── put.ts
│   │   ├── search.ts
│   │   ├── query.ts
│   │   ├── ingest.ts
│   │   ├── link.ts
│   │   ├── tags.ts
│   │   ├── timeline.ts
│   │   ├── list.ts
│   │   ├── stats.ts
│   │   ├── export.ts
│   │   ├── import.ts
│   │   ├── embed.ts
│   │   ├── serve.ts
│   │   ├── call.ts
│   │   ├── init.ts
│   │   ├── config.ts
│   │   └── version.ts
│   ├── core/
│   │   ├── db.ts              # Database class, connection, schema init
│   │   ├── fts.ts             # FTS5 search helpers
│   │   ├── embeddings.ts      # embed(), cosineSimilarity(), search()
│   │   ├── markdown.ts        # parseFrontmatter(), splitContent(), renderPage()
│   │   ├── links.ts           # extractLinks(), resolveSlug()
│   │   └── types.ts           # TypeScript interfaces
│   ├── mcp/
│   │   └── server.ts          # MCP server: tool definitions + handlers
│   └── schema.sql             # DDL (embedded in db.ts, also standalone for reference)
│
├── skills/
│   ├── ingest/SKILL.md
│   ├── query/SKILL.md
│   ├── maintain/SKILL.md
│   ├── enrich/SKILL.md
│   └── briefing/SKILL.md
│
├── test/
│   ├── import.test.ts         # round-trip: import → export → diff
│   ├── fts.test.ts            # FTS5 search tests
│   ├── embeddings.test.ts     # vector search tests
│   ├── links.test.ts          # link extraction + resolution
│   └── fixtures/              # sample markdown files for testing
│       ├── person.md
│       ├── company.md
│       └── .raw/person.json
│
└── .github/
    └── workflows/
        └── ci.yml             # bun test + bun build --compile
```

---

## 12. CLAUDE.md (Ships with Repo)

```markdown
# CLAUDE.md

GBrain is a personal knowledge brain. SQLite + FTS5 + vector embeddings in one file.

## Architecture

Thin CLI + fat skills. The CLI (`src/cli.ts`) dispatches commands to handler files in
`src/commands/`. The core library (`src/core/`) handles database, search, embeddings,
and markdown parsing. Skills (`skills/`) are fat markdown files that tell you HOW to
use the tools — ingest meetings, answer queries, maintain the brain, enrich from APIs.

## Key files

- `src/core/db.ts` — Database connection, schema initialization, WAL mode
- `src/core/fts.ts` — FTS5 search: `searchFTS(query)` → ranked results
- `src/core/embeddings.ts` — Vector ops: `embed(text)`, `cosineSimilarity(a, b)`, `searchSemantic(query)`
- `src/core/markdown.ts` — Parse frontmatter, split compiled_truth/timeline, render pages
- `src/mcp/server.ts` — MCP stdio server exposing all tools
- `src/schema.sql` — Full SQLite DDL

## Commands

Run `gbrain --help` or `gbrain --tools-json` for full command reference.

## Testing

`bun test` runs all tests. Key test: `test/import.test.ts` validates round-trip
(import markdown → export → diff against original). This must always pass.

## Skills

Read the skill files in `skills/` before doing brain operations. They contain the
workflows, heuristics, and quality rules for ingestion, querying, maintenance, and
enrichment.

## Build

`bun build --compile --outfile bin/gbrain src/cli.ts`
```

---

## 13. Implementation Order

For Claude Code to build this in a single session:

### Phase 1: Foundation (~30 min)
1. `bun init` + package.json + tsconfig.json
2. `src/core/types.ts` — TypeScript interfaces for Page, Link, Tag, TimelineEntry, etc.
3. `src/core/db.ts` — Database class. `open()`, `close()`, schema initialization (run DDL), WAL mode.
4. `src/core/markdown.ts` — `parseFrontmatter()`, `splitCompiledTruthAndTimeline()`, `renderPage()`
5. Basic tests for markdown parsing

### Phase 2: Core commands (~30 min)
6. `src/cli.ts` — Argument parser + command dispatch
7. `src/commands/init.ts` — Create new brain.db
8. `src/commands/get.ts` — Read page by slug
9. `src/commands/put.ts` — Write/update page (parse markdown → insert/update)
10. `src/commands/list.ts` — List pages with filters
11. `src/commands/stats.ts` — Brain statistics
12. `src/commands/tags.ts` + `tag.ts` — Tag operations
13. `src/commands/link.ts` — Create/read links

### Phase 3: Search (~20 min)
14. `src/core/fts.ts` — FTS5 search logic
15. `src/commands/search.ts` — Full-text search command
16. `src/core/embeddings.ts` — embed(), cosineSimilarity(), vector search
17. `src/commands/query.ts` — Semantic search (FTS5 + vector merge)
18. `src/commands/embed.ts` — Generate/refresh embeddings

### Phase 4: Import/Export (~30 min)
19. `src/core/links.ts` — Link extraction from markdown
20. `src/commands/import.ts` — Full migration: scan → parse → insert → validate
21. `src/commands/export.ts` — Reconstruct markdown directory from DB
22. `test/import.test.ts` — Round-trip validation

### Phase 5: Timeline + Ingest (~15 min)
23. `src/commands/timeline.ts` — Read/add timeline entries
24. `src/commands/ingest.ts` — Source document ingestion

### Phase 6: MCP Server (~20 min)
25. `src/mcp/server.ts` — MCP stdio server with all tools
26. `src/commands/serve.ts` — Start MCP server
27. `src/commands/call.ts` — Raw tool call (GL pattern)

### Phase 7: Polish (~15 min)
28. `src/commands/version.ts`, `src/commands/config.ts`
29. `--tools-json` output, `pipe` mode
30. Copy skill files to `skills/`
31. Write CLAUDE.md, README.md
32. `bun build --compile`
33. Run full test suite

**Total estimated build time: ~2.5 hours for Claude Code.**

---

## Timeline

- **2026-04-05** | Garry asked Wintermute to spec GBrain as open-source project. Inspired by hitting git scaling limits at 7,471 files / 2.3GB in the wiki brain.
- **2026-04-05** | Spec v1 complete. Schema designed, CLI defined, migration plan detailed, skills drafted, architecture documented. Ready to build.