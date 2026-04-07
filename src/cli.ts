import { BrainDB } from "./core/db";
import { parseMarkdownFile, renderPage, extractLinks, slugFromPath } from "./core/markdown";
import matter from "gray-matter";

const DB_PATH = process.env.GBRAIN_DB || "./brain.db";

function getDb(): BrainDB {
  return new BrainDB(DB_PATH);
}

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "init": {
    const db = getDb();
    db.setConfig("version", "1");
    db.setConfig("embedding_model", "text-embedding-3-small");
    db.setConfig("embedding_dimensions", "1536");
    db.setConfig("chunk_strategy", "section");
    console.log(`Initialized brain.db at ${DB_PATH}`);
    db.close();
    break;
  }

  case "get": {
    const slug = args[1];
    if (!slug) {
      console.error("Usage: gbrain get <slug>");
      process.exit(1);
    }
    const db = getDb();
    const page = db.getPage(slug);
    if (!page) {
      console.error(`Page not found: ${slug}`);
      process.exit(1);
    }
    const fm = JSON.parse(page.frontmatter);
    console.log(renderPage(page.title, page.type, page.compiled_truth, page.timeline, fm));
    db.close();
    break;
  }

  case "put": {
    const slug = args[1];
    if (!slug) {
      console.error("Usage: gbrain put <slug> [< file.md]");
      process.exit(1);
    }
    const content = args[2] || await readStdin();
    const parsed = parseMarkdownFile(content, slug);
    const db = getDb();
    db.putPage(parsed.slug, parsed.type, parsed.title, parsed.compiled_truth, parsed.timeline, parsed.frontmatter);
    console.log(`Saved: ${parsed.slug}`);
    db.close();
    break;
  }

  case "list": {
    const db = getDb();
    const type = args.find(a => a === "--type") ? args[args.indexOf("--type") + 1] : undefined;
    const limit = parseInt(args.find(a => a === "--limit") ? args[args.indexOf("--limit") + 1] : "100");
    const pages = db.listPages(type, limit);
    for (const page of pages) {
      console.log(`${page.type.padEnd(12)} ${page.slug}`);
    }
    db.close();
    break;
  }

  case "search": {
    const query = args[1];
    if (!query) {
      console.error("Usage: gbrain search <query>");
      process.exit(1);
    }
    const db = getDb();
    const results = db.searchFTS(query);
    for (const r of results) {
      console.log(`${r.title} (${r.type}) - score: ${r.score}`);
      const excerpt = r.compiled_truth.substring(0, 200).replace(/\n/g, " ");
      console.log(`  ${excerpt}...`);
    }
    if (results.length === 0) {
      console.log("No results found.");
    }
    db.close();
    break;
  }

  case "stats": {
    const db = getDb();
    const stats = db.getStats();
    console.log("Brain Statistics:");
    console.log(`  Pages:          ${stats.total_pages}`);
    for (const [type, count] of Object.entries(stats.pages_by_type)) {
      console.log(`    ${type}: ${count}`);
    }
    console.log(`  Links:          ${stats.total_links}`);
    console.log(`  Tags:            ${stats.total_tags}`);
    console.log(`  Embeddings:      ${stats.total_embeddings}`);
    console.log(`  DB size:         ${(stats.db_size_bytes / 1024 / 1024).toFixed(2)} MB`);
    db.close();
    break;
  }

  case "import": {
    const dir = args[1];
    if (!dir) {
      console.error("Usage: gbrain import <dir>");
      process.exit(1);
    }
    await importDir(dir);
    break;
  }

  case "tags": {
    const slug = args[1];
    if (!slug) {
      console.error("Usage: gbrain tags <slug>");
      process.exit(1);
    }
    const db = getDb();
    const tags = db.getTags(slug);
    console.log(tags.join(", "));
    db.close();
    break;
  }

  case "backlinks": {
    const slug = args[1];
    if (!slug) {
      console.error("Usage: gbrain backlinks <slug>");
      process.exit(1);
    }
    const db = getDb();
    const pages = db.getBacklinks(slug);
    for (const page of pages) {
      console.log(`${page.type.padEnd(12)} ${page.slug}`);
    }
    db.close();
    break;
  }

  case "serve": {
    const { startServer } = await import("./mcp/server.js");
    await startServer();
    break;
  }

  case "--tools-json": {
    console.log(JSON.stringify(getTools(), null, 2));
    break;
  }

  case "--help":
  case "help":
    printHelp();
    break;

  default:
    if (command) {
      console.error(`Unknown command: ${command}`);
    }
    printHelp();
    process.exit(command ? 1 : 0);
}

function printHelp() {
  console.log(`
GBrain - Personal Knowledge Brain

Commands:
  gbrain init <path>              Initialize a new brain.db
  gbrain get <slug>               Get a page by slug
  gbrain put <slug> [file.md]     Create or update a page
  gbrain list [--type <type>]     List pages
  gbrain search <query>           Full-text search
  gbrain tags <slug>              Get tags for a page
  gbrain backlinks <slug>         Get pages linking to this page
  gbrain stats                    Show brain statistics
  gbrain import <dir>             Import markdown files
  gbrain --tools-json            Show Claude Code tools
  gbrain --help                   Show this help

Environment:
  GBRAIN_DB=/path/to/brain.db     Set brain database path
`);
}

async function readStdin(): Promise<string> {
  return await new Response(Bun.stdin).text();
}

async function importDir(dir: string) {
  const db = getDb();
  const fs = await import("fs");
  const path = await import("path");

  // Find all .md files recursively
  const files: string[] = [];
  function walk(d: string) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(d, entry.name));
      } else if (entry.name.endsWith(".md") && entry.name !== "schema.md" && entry.name !== "index.md" && entry.name !== "log.md" && entry.name !== "README.md") {
        files.push(path.join(d, entry.name));
      }
    }
  }
  walk(dir);

  console.log(`Importing ${files.length} files...`);

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const relPath = path.relative(dir, file).replace(/\\/g, "/");
    const parsed = parseMarkdownFile(content, relPath);

    const pageId = db.insertPageBulk(parsed.slug, parsed.type, parsed.title, parsed.compiled_truth, parsed.timeline, JSON.stringify(parsed.frontmatter));
    db.insertFTSBulk(pageId, parsed.title, parsed.compiled_truth, parsed.timeline);

    // Extract and insert tags
    if (parsed.frontmatter.tags && Array.isArray(parsed.frontmatter.tags)) {
      for (const tag of parsed.frontmatter.tags) {
        db.insertTag(pageId, tag);
      }
    }

    // Extract and insert links
    const links = extractLinks(parsed.compiled_truth + "\n" + parsed.timeline);
    for (const link of links) {
      db.insertLink(pageId, link.target, "");
    }
  }

  console.log("Done!");
  db.close();
}

function getTools() {
  return [
    { name: "brain_search", description: "FTS5 full-text search", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
    { name: "brain_get", description: "Get a page by slug", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
    { name: "brain_put", description: "Create or update a page", inputSchema: { type: "object", properties: { slug: { type: "string" }, content: { type: "string" } }, required: ["slug", "content"] } },
    { name: "brain_list", description: "List pages", inputSchema: { type: "object", properties: { type: { type: "string" }, limit: { type: "number" } } } },
    { name: "brain_stats", description: "Get brain statistics", inputSchema: { type: "object" } },
    { name: "brain_tags", description: "Get page tags", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
    { name: "brain_backlinks", description: "Get backlinks", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
  ];
}
