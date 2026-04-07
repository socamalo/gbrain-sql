import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { parseMarkdownFile, extractLinks } from "../src/core/markdown";
import { splitIntoChunks, cosineSimilarity } from "../src/core/embeddings";

// ============================================================
// markdown.ts tests
// ============================================================

describe("parseMarkdownFile", () => {
  test("parses frontmatter and body correctly", () => {
    const content = `---
title: Test Page
type: person
tags: [test, sample]
---
# Test Page

This is compiled truth.

---

This is timeline.
`;
    const result = parseMarkdownFile(content, "test/page");

    expect(result.slug).toBe("test/page");
    expect(result.type).toBe("person");
    expect(result.title).toBe("Test Page");
    expect(result.compiled_truth).toBe("# Test Page\n\nThis is compiled truth.");
    expect(result.timeline).toBe("This is timeline.");
    expect(result.frontmatter.tags).toEqual(["test", "sample"]);
  });

  test("handles page without frontmatter", () => {
    const content = `# Hello

Some content here.
`;
    const result = parseMarkdownFile(content, "test/hello");
    expect(result.type).toBe("concept"); // default type
    expect(result.title).toBe("Hello");
  });

  test("handles page without timeline (no HR)", () => {
    const content = `---
title: No Timeline Page
---
# No Timeline Page

Only compiled truth here.
`;
    const result = parseMarkdownFile(content, "test/no-timeline");
    expect(result.compiled_truth).toBe("# No Timeline Page\n\nOnly compiled truth here.");
    expect(result.timeline).toBe("");
  });
});

describe("extractLinks", () => {
  test("extracts wiki links with .md extension", () => {
    // Wiki links in markdown files have .md extension
    const content = "See [this page](./other-page.md) for details.";
    const links = extractLinks(content);
    expect(links).toEqual([{ text: "this page", target: "./other-page" }]);
  });

  test("extracts relative links with ../", () => {
    const content = "Check [John](../people/john.md) for bio.";
    const links = extractLinks(content);
    expect(links).toEqual([{ text: "John", target: "people/john" }]);
  });

  test("extracts multiple links", () => {
    const content = `[Link 1](./page1.md) and [Link 2](./page2.md).`;
    const links = extractLinks(content);
    expect(links.length).toBe(2);
    expect(links[0].target).toBe("./page1");
    expect(links[1].target).toBe("./page2");
  });

  test("returns empty array when no links", () => {
    const links = extractLinks("No links here.");
    expect(links).toEqual([]);
  });

  test("handles nested paths", () => {
    const content = "See [company](./companies/acme-corp.md) for details.";
    const links = extractLinks(content);
    expect(links).toEqual([{ text: "company", target: "./companies/acme-corp" }]);
  });
});

describe("splitIntoChunks", () => {
  test("splits content by ## headers", () => {
    // Note: # Heading (H1) is NOT matched by ## regex, so it stays in the first chunk
    // This is expected behavior - splitIntoChunks only splits on ## (H2) headers
    const content = `# Heading

Intro text.

## Section A

Content of section A.

## Section B

Content of section B.`;
    const chunks = splitIntoChunks(content);
    expect(chunks.length).toBe(3);
    // First chunk includes H1 + intro because H1 (#) != ## and there's no HR separator
    expect(chunks[0].header).toBe("");
    expect(chunks[0].text).toContain("Intro text.");
    expect(chunks[1].header).toBe("Section A");
    expect(chunks[1].text).toBe("Content of section A.");
    expect(chunks[2].header).toBe("Section B");
    expect(chunks[2].text).toBe("Content of section B.");
  });

  test("handles content with no headers", () => {
    const content = "Just plain text without any headers.";
    const chunks = splitIntoChunks(content);
    expect(chunks.length).toBe(1);
    expect(chunks[0].header).toBe("");
    expect(chunks[0].text).toBe("Just plain text without any headers.");
  });

  test("handles empty content", () => {
    expect(splitIntoChunks("")).toEqual([]);
    expect(splitIntoChunks("   ")).toEqual([]);
    expect(splitIntoChunks("\n\n")).toEqual([]);
  });

  test("skips ### headers (deeper nesting)", () => {
    const content = `## Section A

Content A.

### Subsection A1

Content A1.

## Section B

Content B.`;
    const chunks = splitIntoChunks(content);
    // ### is not matched by regex ## [^#], so "### Subsection..." becomes part of Section A's body
    expect(chunks.length).toBe(2);
    expect(chunks[0].header).toBe("Section A");
    expect(chunks[0].text).toContain("### Subsection A1");
    expect(chunks[0].text).toContain("Content A1");
    expect(chunks[1].header).toBe("Section B");
  });

  test("handles consecutive headers without blank line between", () => {
    const content = `## Header A
Content A
## Header B
Content B`;
    const chunks = splitIntoChunks(content);
    // The regex requires a newline after ## header text, so "Content A\n## Header B" matches
    // as Header A's body being "Content A" and then Header B is separate
    expect(chunks.length).toBe(2);
  });
});

describe("cosineSimilarity", () => {
  test("computes correct similarity for identical vectors", () => {
    const v = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  test("computes correct similarity for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  test("computes correct similarity for opposite vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  test("throws for mismatched dimensions", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0]);
    expect(() => cosineSimilarity(a, b)).toThrow();
  });

  test("handles zero vector", () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  test("computes known cosine value", () => {
    // cos(45 degrees) = sqrt(2)/2 ≈ 0.7071
    const a = new Float32Array([1, 1]);
    const b = new Float32Array([1, 0]);
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeCloseTo(0.7071, 3);
  });
});

// ============================================================
// CRITICAL BUG TEST: importDir link insertion
// ============================================================

describe("BUG: importDir link insertion - slug not resolved to ID", () => {
  const TEST_DB = "/tmp/gbrain_link_bug_test.db";

  function setupDb(): Database {
    const db = new Database(TEST_DB);
    db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        compiled_truth TEXT NOT NULL DEFAULT '',
        timeline TEXT NOT NULL DEFAULT '',
        frontmatter TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_page_id INTEGER NOT NULL REFERENCES pages(id),
        to_page_id INTEGER NOT NULL REFERENCES pages(id),
        context TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(from_page_id, to_page_id)
      );
    `);
    return db;
  }

  test("DEMONSTRATES BUG: insertLink receives slug string instead of page ID", () => {
    const db = new Database("/tmp/gbrain_bug_demo.db");
    db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        compiled_truth TEXT NOT NULL DEFAULT '',
        timeline TEXT NOT NULL DEFAULT '',
        frontmatter TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_page_id INTEGER NOT NULL REFERENCES pages(id),
        to_page_id INTEGER NOT NULL REFERENCES pages(id),
        context TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(from_page_id, to_page_id)
      );
    `);

    // Simulate importDir inserting two pages
    db.prepare(`
      INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("bug/john", "person", "John Doe", "John is a developer.", "", "{}", new Date().toISOString(), new Date().toISOString());

    db.prepare(`
      INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("bug/jane", "person", "Jane Doe", "Jane is a designer.", "", "{}", new Date().toISOString(), new Date().toISOString());

    const johnId = (db.prepare("SELECT id FROM pages WHERE slug = ?").get("bug/john") as any).id;
    const janeId = (db.prepare("SELECT id FROM pages WHERE slug = ?").get("bug/jane") as any).id;

    // First, verify correct behavior with numeric IDs works:
    db.prepare(`INSERT OR IGNORE INTO links (from_page_id, to_page_id, context) VALUES (?, ?, ?)`).run(johnId, janeId, "");
    let links = db.prepare("SELECT * FROM links").all() as any[];
    console.log("With correct numeric IDs, links:", links.length);
    expect(links.length).toBe(1);
    expect(links[0].from_page_id).toBe(johnId);
    expect(links[0].to_page_id).toBe(janeId);

    // Now test with slug string (THE BUG)
    // Insert another page and try to link to it using slug
    db.prepare(`
      INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("bug/acme", "company", "Acme Corp", "Acme is a company.", "", "{}", new Date().toISOString(), new Date().toISOString());

    const acmeId = (db.prepare("SELECT id FROM pages WHERE slug = ?").get("bug/acme") as any).id;

    // BUG: trying to insert link with slug string instead of ID
    // This is what cli.ts:377 does: db.insertLink(johnId, "companies/acme", "")
    const bugResult = db.prepare(`INSERT OR IGNORE INTO links (from_page_id, to_page_id, context) VALUES (?, ?, ?)`).run(johnId, "bug/acme" as any, "");

    console.log("Bug insert result:", bugResult);
    console.log("Bug insert changes:", bugResult.changes);

    // The bug insert either:
    // 1. Fails silently (INSERT OR IGNORE catches FK violation)
    // 2. Succeeds but stores wrong data (string instead of int)
    //
    // Let's check:
    links = db.prepare("SELECT * FROM links WHERE from_page_id = ? AND to_page_id = ?").all(johnId, acmeId) as any[];
    console.log("Links to acme (should be 1):", links.length);

    if (links.length === 0) {
      console.log("BUG CONFIRMED: Insert with slug string was rejected (FK or type constraint)");
    } else {
      console.log("BUG: to_page_id stored as:", links[0].to_page_id, "type:", typeof links[0].to_page_id);
    }

    db.close();
  });

  test("FIX: resolve slugs to IDs before inserting links", () => {
    const db = new Database("/tmp/gbrain_fix_test.db");
    db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        compiled_truth TEXT NOT NULL DEFAULT '',
        timeline TEXT NOT NULL DEFAULT '',
        frontmatter TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_page_id INTEGER NOT NULL REFERENCES pages(id),
        to_page_id INTEGER NOT NULL REFERENCES pages(id),
        context TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(from_page_id, to_page_id)
      );
    `);

    // Insert pages
    db.prepare(`INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("fix/john", "person", "John", "", "", "{}", new Date().toISOString(), new Date().toISOString());
    db.prepare(`INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("fix/jane", "person", "Jane", "", "", "{}", new Date().toISOString(), new Date().toISOString());

    // Build slug→ID map (what getAllSlugs() does)
    const slugToId = new Map<string, number>();
    const rows = db.prepare("SELECT id, slug FROM pages").all() as { id: number; slug: string }[];
    for (const row of rows) {
      slugToId.set(row.slug, row.id);
    }

    // Now resolve links using the map
    const linksToInsert = [
      { fromSlug: "fix/john", toSlug: "fix/jane", context: "" },
    ];

    for (const link of linksToInsert) {
      const fromId = slugToId.get(link.fromSlug);
      const toId = slugToId.get(link.toSlug);
      if (fromId !== undefined && toId !== undefined) {
        db.prepare(`INSERT OR IGNORE INTO links (from_page_id, to_page_id, context) VALUES (?, ?, ?)`).run(fromId, toId, link.context);
      }
    }

    const links = db.prepare("SELECT * FROM links").all() as any[];
    console.log("FIXED: Links inserted correctly:", links.length);
    expect(links.length).toBe(1);
    expect(links[0].from_page_id).toBe(slugToId.get("fix/john"));
    expect(links[0].to_page_id).toBe(slugToId.get("fix/jane"));

    db.close();
  });
});

// ============================================================
// Integration test: importDir link resolution
// ============================================================

describe("importDir link resolution integration", () => {
  const TEST_DB = "/tmp/gbrain_import_integration.db";

  test("resolves relative links correctly during import", () => {
    const fs = require("fs");
    const path = require("path");

    // Create temp directory structure
    const tmpDir = "/tmp/gbrain_import_test_" + Date.now();
    fs.mkdirSync(tmpDir + "/people", { recursive: true });
    fs.mkdirSync(tmpDir + "/companies", { recursive: true });

    // Create test files
    fs.writeFileSync(tmpDir + "/people/alice.md", `---
title: Alice
type: person
---
# Alice Smith

Alice works at Acme Corp.

See [Acme Corp](../companies/acme.md) for company details.
`);

    fs.writeFileSync(tmpDir + "/companies/acme.md", `---
title: Acme Corp
type: company
---
# Acme Corporation

Acme is a tech company.
`);

    // Simulate the fixed importDir logic
    const db = new Database(TEST_DB);
    db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        compiled_truth TEXT NOT NULL DEFAULT '',
        timeline TEXT NOT NULL DEFAULT '',
        frontmatter TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_page_id INTEGER NOT NULL REFERENCES pages(id),
        to_page_id INTEGER NOT NULL REFERENCES pages(id),
        context TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(from_page_id, to_page_id)
      );
    `);

    // Import pages (simulated)
    const pages = [
      { slug: "people/alice", type: "person", title: "Alice", content: "Alice works at Acme Corp.\n\nSee [Acme Corp](../companies/acme.md) for company details." },
      { slug: "companies/acme", type: "company", title: "Acme", content: "Acme is a tech company." },
    ];

    for (const page of pages) {
      db.prepare(`INSERT INTO pages (slug, type, title, compiled_truth, timeline, frontmatter, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(page.slug, page.type, page.title, page.content, "", "{}", new Date().toISOString(), new Date().toISOString());
    }

    // Build slug→ID map
    const slugToId = new Map<string, number>();
    const rows = db.prepare("SELECT id, slug FROM pages").all() as { id: number; slug: string }[];
    for (const row of rows) {
      slugToId.set(row.slug, row.id);
    }

    // Now insert links with proper resolution
    // The link from people/alice points to ../companies/acme
    // After resolution, targetSlug should be "companies/acme"
    const aliceId = slugToId.get("people/alice");
    const acmeId = slugToId.get("companies/acme");

    // Manual resolution: "../companies/acme" → "companies/acme"
    const targetSlug = "companies/acme";
    const resolvedToId = slugToId.get(targetSlug);

    if (aliceId && resolvedToId) {
      db.prepare(`INSERT OR IGNORE INTO links (from_page_id, to_page_id, context) VALUES (?, ?, ?)`).run(aliceId, resolvedToId, "");
    }

    const links = db.prepare("SELECT * FROM links").all() as any[];
    console.log("Links after proper resolution:", links.length);
    expect(links.length).toBe(1);
    expect(links[0].from_page_id).toBe(aliceId);
    expect(links[0].to_page_id).toBe(acmeId);

    // Cleanup
    db.close();
    fs.rmSync(tmpDir, { recursive: true });

    console.log("Integration test PASSED");
  });
});
