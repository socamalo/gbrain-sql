import { Database } from "bun:sqlite";
import type { Page, SearchResult, Stats } from "./types";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL UNIQUE,
  type          TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  compiled_truth TEXT   NOT NULL DEFAULT '',
  timeline      TEXT    NOT NULL DEFAULT '',
  frontmatter   TEXT    NOT NULL DEFAULT '{}',
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(type);
CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);

CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(
  title,
  compiled_truth,
  timeline,
  content='pages',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO page_fts(rowid, title, compiled_truth, timeline)
  VALUES (new.id, new.title, new.compiled_truth, new.timeline);
END;

CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
  INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline)
  VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline);
END;

CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
  INSERT INTO page_fts(page_fts, rowid, title, compiled_truth, timeline)
  VALUES ('delete', old.id, old.title, old.compiled_truth, old.timeline);
  INSERT INTO page_fts(rowid, title, compiled_truth, timeline)
  VALUES (new.id, new.title, new.compiled_truth, new.timeline);
END;

CREATE TABLE IF NOT EXISTS page_embeddings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text  TEXT    NOT NULL,
  embedding   BLOB    NOT NULL,
  model       TEXT    NOT NULL DEFAULT 'text-embedding-3-small',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_embeddings_page ON page_embeddings(page_id);

CREATE TABLE IF NOT EXISTS links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  to_page_id   INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  context      TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(from_page_id, to_page_id)
);

CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_page_id);
CREATE INDEX IF NOT EXISTS idx_links_to   ON links(to_page_id);

CREATE TABLE IF NOT EXISTS tags (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL,
  UNIQUE(page_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag     ON tags(tag);
CREATE INDEX IF NOT EXISTS idx_tags_page_id ON tags(page_id);

CREATE TABLE IF NOT EXISTS raw_data (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  source     TEXT    NOT NULL,
  data       TEXT    NOT NULL,
  fetched_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(page_id, source)
);

CREATE INDEX IF NOT EXISTS idx_raw_data_page ON raw_data(page_id);

CREATE TABLE IF NOT EXISTS timeline_entries (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id  INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  date     TEXT    NOT NULL,
  source   TEXT    NOT NULL DEFAULT '',
  summary  TEXT    NOT NULL,
  detail   TEXT    NOT NULL DEFAULT '',
  created_at TEXT  NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_timeline_page ON timeline_entries(page_id);
CREATE INDEX IF NOT EXISTS idx_timeline_date ON timeline_entries(date);

CREATE TABLE IF NOT EXISTS ingest_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type   TEXT    NOT NULL,
  source_ref    TEXT    NOT NULL,
  pages_updated TEXT    NOT NULL DEFAULT '[]',
  summary       TEXT    NOT NULL DEFAULT '',
  timestamp     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export class BrainDB {
  db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  getPage(slug: string): Page | null {
    const stmt = this.db.prepare("SELECT * FROM pages WHERE slug = ?");
    return stmt.get(slug) as Page | null;
  }

  putPage(slug: string, type: string, title: string, compiled_truth: string, timeline: string, frontmatter: object): void {
    const fm = JSON.stringify(frontmatter);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        type = excluded.type,
        title = excluded.title,
        compiled_truth = excluded.compiled_truth,
        timeline = excluded.timeline,
        frontmatter = excluded.frontmatter,
        updated_at = excluded.updated_at
    `).run(slug, type, title, compiled_truth, timeline, fm, now, now);
  }

  listPages(type?: string, limit = 100): Page[] {
    if (type) {
      return this.db.prepare("SELECT * FROM pages WHERE type = ? ORDER BY updated_at DESC LIMIT ?").all(type, limit) as Page[];
    }
    return this.db.prepare("SELECT * FROM pages ORDER BY updated_at DESC LIMIT ?").all(limit) as Page[];
  }

  searchFTS(query: string, limit = 20): SearchResult[] {
    const results = this.db.prepare(`
      SELECT p.slug, p.title, p.type, p.compiled_truth, p.timeline,
             rank, bm25(page_fts) as score
      FROM page_fts
      JOIN pages p ON page_fts.rowid = p.id
      WHERE page_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as any[];

    return results.map(r => ({
      slug: r.slug,
      title: r.title,
      type: r.type,
      compiled_truth: r.compiled_truth,
      timeline: r.timeline,
      score: r.score
    }));
  }

  getStats(): Stats {
    const totalPages = this.db.prepare("SELECT COUNT(*) as count FROM pages").get() as { count: number };

    const pagesByType = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM pages GROUP BY type
    `).all() as { type: string; count: number }[];

    const totalLinks = this.db.prepare("SELECT COUNT(*) as count FROM links").get() as { count: number };
    const totalTags = this.db.prepare("SELECT COUNT(*) as count FROM tags").get() as { count: number };
    const totalEmbeddings = this.db.prepare("SELECT COUNT(*) as count FROM page_embeddings").get() as { count: number };

    const dbInfo = this.db.prepare("PRAGMA page_count").get() as { page_count: number };
    const pageSize = this.db.prepare("PRAGMA page_size").get() as { page_size: number };
    const dbSize = dbInfo.page_count * pageSize.page_size;

    return {
      total_pages: totalPages.count,
      pages_by_type: Object.fromEntries(pagesByType.map(r => [r.type, r.count])),
      total_links: totalLinks.count,
      total_tags: totalTags.count,
      total_embeddings: totalEmbeddings.count,
      db_size_bytes: dbSize
    };
  }

  setConfig(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(key, value);
  }

  getConfig(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | null;
    return row?.value ?? null;
  }

  // For import: insert page without triggers (bulk import)
  insertPageBulk(slug: string, type: string, title: string, compiled_truth: string, timeline: string, frontmatter: string): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(slug, type, title, compiled_truth, timeline, frontmatter, now, now);
    return result.lastInsertRowid as number;
  }

  // Insert FTS entry manually (for bulk import)
  insertFTSBulk(rowid: number, title: string, compiled_truth: string, timeline: string): void {
    this.db.prepare(`
      INSERT INTO page_fts(rowid, title, compiled_truth, timeline) VALUES (?, ?, ?, ?)
    `).run(rowid, title, compiled_truth, timeline);
  }

  // Insert tags
  insertTag(pageId: number, tag: string): void {
    this.db.prepare("INSERT OR IGNORE INTO tags (page_id, tag) VALUES (?, ?)").run(pageId, tag);
  }

  // Get all page slugs for link resolution
  getAllSlugs(): Map<string, number> {
    const rows = this.db.prepare("SELECT id, slug FROM pages").all() as { id: number; slug: string }[];
    return new Map(rows.map(r => [r.slug, r.id]));
  }

  // Insert link
  insertLink(fromId: number, toId: number, context: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO links (from_page_id, to_page_id, context) VALUES (?, ?, ?)
    `).run(fromId, toId, context);
  }

  // Get backlinks
  getBacklinks(slug: string): Page[] {
    return this.db.prepare(`
      SELECT p.* FROM pages p
      JOIN links l ON p.id = l.from_page_id
      JOIN pages target ON l.to_page_id = target.id
      WHERE target.slug = ?
    `).all(slug) as Page[];
  }

  // Get page ID by slug
  getPageId(slug: string): number | null {
    const row = this.db.prepare("SELECT id FROM pages WHERE slug = ?").get(slug) as { id: number } | null;
    return row?.id ?? null;
  }

  // Get tags for a page
  getTags(slug: string): string[] {
    const pageId = this.getPageId(slug);
    if (!pageId) return [];
    const rows = this.db.prepare("SELECT tag FROM tags WHERE page_id = ?").all(pageId) as { tag: string }[];
    return rows.map(r => r.tag);
  }

  // ============================================================
  // Embeddings
  // ============================================================

  // Insert a single embedding
  insertEmbedding(pageId: number, chunkIndex: number, chunkText: string, embeddingBytes: Uint8Array, model: string): void {
    this.db.prepare(`
      INSERT INTO page_embeddings (page_id, chunk_index, chunk_text, embedding, model)
      VALUES (?, ?, ?, ?, ?)
    `).run(pageId, chunkIndex, chunkText, embeddingBytes, model);
  }

  // Delete all embeddings for a page (for re-embedding on update)
  deleteEmbeddingsForPage(pageId: number): void {
    this.db.prepare("DELETE FROM page_embeddings WHERE page_id = ?").run(pageId);
  }

  // Get all embeddings for a page
  getEmbeddingsForPage(pageId: number): { chunk_index: number; chunk_text: string; embedding: Blob; model: string }[] {
    return this.db.prepare(
      "SELECT chunk_index, chunk_text, embedding, model FROM page_embeddings WHERE page_id = ? ORDER BY chunk_index"
    ).all(pageId) as any[];
  }

  // Search semantic: find pages with highest similarity to query embedding
  searchSemantic(queryEmbedding: Float32Array, limit = 10): { page_id: number; slug: string; title: string; type: string; similarity: number; chunk_text: string }[] {
    // Load all embeddings and compute similarity in JS (O(n) scan, fine for personal brain scale)
    const rows = this.db.prepare(`
      SELECT pe.page_id, pe.chunk_text, pe.embedding, p.slug, p.title, p.type
      FROM page_embeddings pe
      JOIN pages p ON pe.page_id = p.id
    `).all() as any[];

    const results: { page_id: number; slug: string; title: string; type: string; similarity: number; chunk_text: string }[] = [];

    for (const row of rows) {
      // Convert Blob back to Float32Array
      const bytes = new Uint8Array(row.embedding);
      const floats = new Float32Array(bytes.buffer);
      const similarity = cosineSimilarityJs(queryEmbedding, floats);

      results.push({
        page_id: row.page_id,
        slug: row.slug,
        title: row.title,
        type: row.type,
        similarity,
        chunk_text: row.chunk_text,
      });
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, limit);
  }

  // Get all embeddings count
  getEmbeddingCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM page_embeddings").get() as { count: number };
    return row.count;
  }
}

// Cosine similarity for JS (avoid importing from embeddings.ts to keep db.ts clean)
function cosineSimilarityJs(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  return dotProduct / denom;
}
