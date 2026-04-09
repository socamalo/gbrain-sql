#!/usr/bin/env bun
import { BrainDB } from "./core/db";
import { parseMarkdownFile, renderPage, extractLinks, slugFromPath, extractAgenda, extractTitle } from "./core/markdown";
import { splitIntoChunks, splitIntoChunksWithMeta, embedToBytes, embed } from "./core/embeddings";
import matter from "gray-matter";
import os from "os";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import { getConfig } from "./core/config";

const DEFAULT_DB = path.join(os.homedir(), "gbrain-data", "brain.db");
const DB_PATH = process.env.GBRAIN_DB || DEFAULT_DB;

function getDb(): BrainDB {
  const dbDir = path.dirname(DB_PATH);
  if (dbDir && dbDir !== "." && !existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  return new BrainDB(DB_PATH);
}

function localTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function createBackup(): Promise<string> {
  const fs = await import("bun:fs");
  const pathModule = await import("path");
  const dbPath = DB_PATH;
  const timestamp = localTimestamp();
  const backupName = pathModule.basename(dbPath) + "_backup_" + timestamp + ".db";
  const backupPath = pathModule.join(pathModule.dirname(dbPath), backupName);
  await Bun.write(backupPath, await Bun.file(dbPath).arrayBuffer());
  return backupPath;
}

function formatLocalDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function promptBackupSelection(backups: { name: string; path: string }[]): Promise<string | null> {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question("Select backup number to restore: ", (answer) => {
      rl.close();
      const idx = parseInt(answer) - 1;
      if (isNaN(idx) || idx < 0 || idx >= backups.length) {
        resolve(null);
      } else {
        resolve(backups[idx].path);
      }
    });
  });
}

async function listBackups(): Promise<{ name: string; path: string; mtime: Date; size: number }[]> {
  const fs = await import("bun:fs");
  const pathModule = await import("path");
  const dbDir = pathModule.dirname(DB_PATH);
  const dbBasename = pathModule.basename(DB_PATH);
  const pattern = new RegExp("^" + dbBasename.replace(".", "\\.") + "_backup_\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.db$");

  try {
    const files = fs.readdirSync(dbDir);
    const backups = files
      .filter(f => pattern.test(f))
      .map(f => {
        const stat = fs.statSync(pathModule.join(dbDir, f));
        return { name: f, path: pathModule.join(dbDir, f), mtime: stat.mtime, size: stat.size };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return backups;
  } catch {
    return [];
  }
}

const args = process.argv.slice(2);
const command = args[0];

// Handle --version before command switch
if (command === "--version" || command === "-v") {
  console.log("gbrain 0.3.2 (argv[1]-based config lookup)");
  process.exit(0);
}

switch (command) {
  case "init": {
    const db = getDb();
    db.setConfig("version", "1");
    db.setConfig("embedding_model", "qwen3-embedding:latest");
    db.setConfig("embedding_dimensions", "4096");
    db.setConfig("chunk_strategy", "section");
    console.log(`Initialized brain.db at ${DB_PATH}`);
    db.close();
    break;
  }

  case "backup": {
    const pathModule = await import("path");
    const dbPath = DB_PATH;
    const timestamp = localTimestamp();
    const backupName = pathModule.basename(dbPath) + "_backup_" + timestamp + ".db";
    const backupPath = pathModule.join(pathModule.dirname(dbPath), backupName);

    try {
      await Bun.write(backupPath, await Bun.file(dbPath).arrayBuffer());
      console.log("Backup created: " + backupPath);
    } catch (err) {
      console.error("Backup failed: " + (err instanceof Error ? err.message : err));
      process.exit(1);
    }
    break;
  }

  case "backups": {
    const backups = await listBackups();
    if (backups.length === 0) {
      console.log("No backups found.");
    } else {
      console.log("Available backups (most recent first):");
      backups.forEach((b, i) => {
        const sizeMB = (b.size / 1024 / 1024).toFixed(1);
        const dateStr = formatLocalDate(b.mtime);
        console.log(`  ${i + 1}. ${b.name}   ${dateStr}   ${sizeMB} MB`);
      });
    }
    break;
  }

  case "restore": {
    const fs = await import("bun:fs");
    const pathModule = await import("path");
    const dbPath = DB_PATH;
    const targetFile = args[1];

    let backupPath: string;

    if (targetFile) {
      // Direct path provided
      if (!fs.existsSync(targetFile)) {
        console.error(`Backup file not found: ${targetFile}`);
        process.exit(1);
      }
      backupPath = targetFile;
    } else {
      // Interactive mode
      const backups = await listBackups();
      if (backups.length === 0) {
        console.error("No backups found. Cannot restore.");
        process.exit(1);
      }

      console.log("Available backups (most recent first):");
      backups.forEach((b, i) => {
        const sizeMB = (b.size / 1024 / 1024).toFixed(1);
        const dateStr = formatLocalDate(b.mtime);
        console.log(`  ${i + 1}. ${b.name}   ${dateStr}   ${sizeMB} MB`);
      });

      const selected = await promptBackupSelection(backups);
      if (!selected) {
        console.error("Invalid selection.");
        process.exit(1);
      }
      backupPath = selected;
    }

    // Pre-restore backup of current database
    const timestamp = localTimestamp();
    const preBackupName = pathModule.basename(dbPath) + "_backup_" + timestamp + ".db";
    const preBackupPath = pathModule.join(pathModule.dirname(dbPath), preBackupName);

    console.log("Creating pre-restore backup: " + preBackupPath);
    try {
      await Bun.write(preBackupPath, await Bun.file(dbPath).arrayBuffer());
    } catch (err) {
      console.error("Failed to create pre-restore backup: " + (err instanceof Error ? err.message : err));
      console.error("Aborting restore to prevent data loss.");
      process.exit(1);
    }

    // Restore from backup
    console.log("Restoring from: " + backupPath);
    await Bun.write(dbPath, await Bun.file(backupPath).arrayBuffer());
    console.log("Restore complete.");

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
    const content = args[2] ? (args[2] === "-" ? await readStdin() : args[2]) : await readStdin();
    const parsed = parseMarkdownFile(content, slug);
    const db = getDb();

    // Get page ID (for embeddings)
    let pageId = db.getPageId(parsed.slug);

    // Save the page
    db.putPage(parsed.slug, parsed.type, parsed.title, parsed.compiled_truth, parsed.timeline, parsed.frontmatter);

    // Get page ID after put (may have changed)
    pageId = db.getPageId(parsed.slug)!;

    // Delete old embeddings
    db.deleteEmbeddingsForPage(pageId);

    // Auto-embed content chunks
    const fullContent = parsed.compiled_truth + "\n\n" + parsed.timeline;
    const chunks = splitIntoChunks(fullContent);

    if (chunks.length > 0) {
      const model = db.getConfig("embedding_model") || "qwen3-embedding:latest";
      let embeddedCount = 0;

      for (const chunk of chunks) {
        try {
          const embeddingBytes = await embedToBytes(chunk.text, model);
          db.insertEmbedding(pageId, chunk.index, chunk.text, embeddingBytes, model);
          embeddedCount++;
        } catch (err) {
          console.warn(`  Warning: failed to embed chunk ${chunk.index}: ${err}`);
        }
      }
      console.log(`Saved: ${parsed.slug} (${embeddedCount}/${chunks.length} chunks embedded)`);
    } else {
      console.log(`Saved: ${parsed.slug}`);
    }

    db.close();
    break;
  }

  case "note": {
    const content = args[1];
    if (!content) {
      console.error("Usage: gbrain note \"<content>\"");
      process.exit(1);
    }

    const cfg = getConfig();
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0]; // YYYY-MM-DD

    // Call LLM to infer metadata via Anthropic API
    const prompt = `你是一个元数据推断助手。用户输入："${content.replace(/"/g, '\\"')}"

请推断并返回以下 JSON（只返回 JSON，不要其他内容）：
{
  "type": "页面类型，如 credential, note, project, person, book, idea 等",
  "title": "简短标题，不超过30字",
  "tags": ["tag1", "tag2", "tag3"],
  "compiled_truth": "一句话摘要"
}`;

    let llmResponse: { type: string; title: string; tags: string[]; compiled_truth: string };

    // Check if API is configured
    if (!cfg.api.base_url || !cfg.api.api_key || !cfg.api.model) {
      console.error("Error: API not configured. Set [api] section in config.toml:");
      console.error("  base_url = \"https://api.minimaxi.com/anthropic\"");
      console.error("  api_key = \"env:MINIMAX_API_KEY\"");
      console.error("  model = \"MiniMax-M2.7\"");
      process.exit(1);
    }

    try {
      const response = await fetch(cfg.api.base_url + "/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.api.api_key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: cfg.api.model,
          max_tokens: 8192,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API error ${response.status}: ${errText}`);
      }

      const data = await response.json() as { content?: { type?: string; text?: string }[] };
      const textBlock = data.content?.find(c => c.type === "text");
      const rawContent = textBlock?.text ?? "{}";

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawContent.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : rawContent;
      llmResponse = JSON.parse(jsonStr);
    } catch (err) {
      console.error("Error calling API: " + (err instanceof Error ? err.message : err));
      process.exit(1);
    }

    // Generate slug from title + date
    const slugBase = llmResponse.title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 40);
    const slug = `${slugBase}-${dateStr}`;

    const timeline = `### ${dateStr} | user | 创建页面\n- ${content}\n`;

    const frontmatter = {
      tags: llmResponse.tags,
      created: dateStr,
    };

    const db = getDb();
    db.putPage(slug, llmResponse.type, llmResponse.title, llmResponse.compiled_truth, timeline, frontmatter);

    const pageId = db.getPageId(slug)!;
    db.deleteEmbeddingsForPage(pageId);

    const fullContent = llmResponse.compiled_truth + "\n\n" + timeline;
    const chunks = splitIntoChunks(fullContent);

    if (chunks.length > 0) {
      let embeddedCount = 0;
      for (const chunk of chunks) {
        try {
          const embeddingBytes = await embedToBytes(chunk.text, cfg.ollama.embedding_model);
          db.insertEmbedding(pageId, chunk.index, chunk.text, embeddingBytes, cfg.ollama.embedding_model);
          embeddedCount++;
        } catch (err) {
          console.warn(`  Warning: failed to embed chunk ${chunk.index}: ${err}`);
        }
      }
      console.log(`Saved: ${slug} (${embeddedCount}/${chunks.length} chunks embedded)`);
    } else {
      console.log(`Saved: ${slug}`);
    }

    // Insert tags
    for (const tag of llmResponse.tags) {
      db.insertTag(pageId, tag);
    }

    db.close();
    break;
  }

  case "list": {
    const db = getDb();
    const type = args.find(a => a === "--type") ? args[args.indexOf("--type") + 1] : undefined;
    const limit = parseInt(args.find(a => a === "--limit") ? args[args.indexOf("--limit") + 1] : "100");
    const pages = db.listPages(type, limit);
    if (pages.length === 0) {
      console.log("No pages found.");
    } else {
      console.log("Slug                          Type");
      console.log("------------------------------ ---------------");
      for (const page of pages) {
        console.log(`${page.slug.padEnd(28)} ${page.type}`);
      }
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

  case "query": {
    const question = args[1];
    if (!question) {
      console.error("Usage: gbrain query <question>");
      process.exit(1);
    }
    const db = getDb();
    const limit = parseInt(args.find(a => a === "--limit") ? args[args.indexOf("--limit") + 1] : "10");

    console.log(`Searching for: "${question}"`);
    console.log("");

    try {
      // Embed the question
      const model = db.getConfig("embedding_model") || "qwen3-embedding:latest";
      const queryEmbedding = await embed(question, model);

      // Search semantic
      const results = db.searchSemantic(queryEmbedding, limit);

      if (results.length === 0) {
        console.log("No semantic results found.");
      } else {
        console.log("Semantic results:");
        for (const r of results) {
          console.log(`  ${r.title} (${r.type}) - similarity: ${(r.similarity * 100).toFixed(1)}%`);
          console.log(`    ${r.chunk_text.substring(0, 150).replace(/\n/g, " ")}...`);
          console.log("");
        }
      }
    } catch (err) {
      console.error(`Error: ${err}`);
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

  case "ingest": {
    const files = args.slice(1);
    if (files.length === 0) {
      console.error("Usage: gbrain ingest <file1.md> [file2.md] ...");
      process.exit(1);
    }
    await ingestFiles(files);
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

  case "delete": {
    const rawArgs = args.slice(1);
    const skipConfirm = rawArgs.includes("-y") || rawArgs.includes("--yes");
    const slugs = rawArgs.filter(a => !a.startsWith("-"));
    if (slugs.length === 0) {
      console.error("Usage: gbrain delete [-y|--yes] <slug> [<slug>...]");
      process.exit(1);
    }

    const db = getDb();

    // Backup before any deletion
    const backupPath = await createBackup();
    console.log("Backup created: " + backupPath);

    // Check which slugs exist
    const found: string[] = [];
    const notFound: string[] = [];
    for (const slug of slugs) {
      if (db.getPage(slug)) {
        found.push(slug);
      } else {
        notFound.push(slug);
      }
    }

    if (found.length === 0) {
      console.log("No pages found to delete.");
      db.close();
      process.exit(0);
    }

    // Multi-page: interactive confirmation (skip with -y)
    if (found.length > 1 && !skipConfirm) {
      console.log("The following pages will be deleted:");
      for (const slug of found) {
        console.log("  " + slug);
      }
      const readline = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question(`Delete ${found.length} pages? [y/N] `, resolve);
      });
      rl.close();
      if (answer.toLowerCase() !== "y") {
        console.log("Aborted.");
        db.close();
        process.exit(1);
      }
    }

    // Delete
    for (const slug of found) {
      db.deletePage(slug);
      console.log("Deleted: " + slug);
    }

    if (notFound.length > 0) {
      for (const slug of notFound) {
        console.warn("Warning: page not found: " + slug);
      }
    }

    db.close();
    break;
  }

  case "embed": {
    const slug = args[1];
    const db = getDb();
    const model = db.getConfig("embedding_model") || "qwen3-embedding:latest";

    // Handle gbrain embed --all
    if (slug === "--all") {
      const pages = db.listPages(undefined, 10000);
      let totalEmbedded = 0;
      let totalChunks = 0;

      console.log(`Embedding ${pages.length} pages...`);

      for (const page of pages) {
        const pageId = db.getPageId(page.slug)!;
        db.deleteEmbeddingsForPage(pageId);

        const fullContent = page.compiled_truth + "\n\n" + page.timeline;
        const chunks = splitIntoChunks(fullContent);

        for (const chunk of chunks) {
          try {
            const embeddingBytes = await embedToBytes(chunk.text, model);
            db.insertEmbedding(pageId, chunk.index, chunk.text, embeddingBytes, model);
            totalChunks++;
          } catch (err) {
            // Skip failed chunks
          }
        }
        totalEmbedded++;
        process.stdout.write(".");
      }

      console.log("");
      console.log(`Done. ${totalEmbedded} pages, ${totalChunks} chunks embedded.`);
      db.close();
      break;
    }

    // Handle gbrain embed --stale
    if (slug === "--stale") {
      const stalePages = db.getStalePages();

      if (stalePages.length === 0) {
        console.log("Done. 0 pages, 0 chunks re-embedded.");
        db.close();
        break;
      }

      let totalPages = 0;
      let totalChunks = 0;

      console.log(`Re-embedding ${stalePages.length} stale pages...`);

      for (const page of stalePages) {
        const pageData = db.getPage(page.slug);
        if (!pageData) continue;

        db.deleteEmbeddingsForPage(page.pageId);

        const fullContent = pageData.compiled_truth + "\n\n" + pageData.timeline;
        const chunks = splitIntoChunks(fullContent);

        if (page.slug.length <= 50) {
          console.log(`Embedding ${page.slug}... ${chunks.length} chunks.`);
        }

        let pageChunks = 0;
        for (const chunk of chunks) {
          try {
            const embeddingBytes = await embedToBytes(chunk.text, model);
            db.insertEmbedding(page.pageId, chunk.index, chunk.text, embeddingBytes, model);
            pageChunks++;
          } catch (err) {
            console.error(`\nError embedding ${page.slug} chunk ${chunk.index}: ${err}`);
            db.close();
            process.exit(1);
          }
        }
        totalChunks += pageChunks;
        totalPages++;
      }

      console.log(`Done. ${totalPages} pages, ${totalChunks} chunks re-embedded.`);
      db.close();
      break;
    }

    if (slug) {
      // Embed single page
      const page = db.getPage(slug);
      if (!page) {
        console.error(`Page not found: ${slug}`);
        db.close();
        process.exit(1);
      }

      const pageId = db.getPageId(slug)!;
      db.deleteEmbeddingsForPage(pageId);

      const fullContent = page.compiled_truth + "\n\n" + page.timeline;
      const chunks = splitIntoChunks(fullContent);

      console.log(`Embedding ${chunks.length} chunks for ${slug}...`);
      for (const chunk of chunks) {
        try {
          const embeddingBytes = await embedToBytes(chunk.text, model);
          db.insertEmbedding(pageId, chunk.index, chunk.text, embeddingBytes, model);
          process.stdout.write(".");
        } catch (err) {
          process.stdout.write("x");
        }
      }
      console.log("");
      console.log(`Done. ${slug}: ${chunks.length} chunks embedded.`);
    } else {
      // No slug provided - embed all pages
      const pages = db.listPages(undefined, 10000);
      let totalEmbedded = 0;
      let totalChunks = 0;

      console.log(`Embedding ${pages.length} pages...`);

      for (const page of pages) {
        const pageId = db.getPageId(page.slug)!;
        db.deleteEmbeddingsForPage(pageId);

        const fullContent = page.compiled_truth + "\n\n" + page.timeline;
        const chunks = splitIntoChunks(fullContent);

        for (const chunk of chunks) {
          try {
            const embeddingBytes = await embedToBytes(chunk.text, model);
            db.insertEmbedding(pageId, chunk.index, chunk.text, embeddingBytes, model);
            totalChunks++;
          } catch (err) {
            // Skip failed chunks
          }
        }
        totalEmbedded++;
        process.stdout.write(".");
      }

      console.log("");
      console.log(`Done. ${totalEmbedded} pages, ${totalChunks} chunks embedded.`);
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
GBrain v0.3.2 - Personal Knowledge Brain

Commands:
  gbrain init <path>              Initialize a new brain.db
  gbrain get <slug>               Get a page by slug
  gbrain put <slug> [file.md]     Create or update a page (auto-embeds)
  gbrain note "<content>"        Create a quick note with LLM-inferred metadata
  gbrain list [--type <type>]     List pages
  gbrain search <query>           Full-text search (FTS5)
  gbrain query <question>         Semantic search (vector)
  gbrain embed [slug|--all]       Regenerate embeddings
  gbrain tags <slug>              Get tags for a page
  gbrain backlinks <slug>         Get pages linking to this page
  gbrain delete [-y|--yes] <slug> [...]  Delete pages (auto-backup first)
  gbrain stats                    Show brain statistics
  gbrain import <dir>             Import markdown files (bulk)
  gbrain ingest <file.md> [...]   Ingest one or more markdown files (with chunk metadata)
  gbrain backup                  Create a timestamped backup of the database
  gbrain backups                 List all available backups
  gbrain restore [file]          Restore from a backup (interactive if no file specified)
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
  const pathModule = await import("path");

  // Find all .md files recursively
  const files: string[] = [];
  function walk(d: string) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(pathModule.join(d, entry.name));
      } else if (entry.name.endsWith(".md") && entry.name !== "schema.md" && entry.name !== "index.md" && entry.name !== "log.md" && entry.name !== "README.md") {
        files.push(pathModule.join(d, entry.name));
      }
    }
  }
  walk(dir);

  console.log(`Importing ${files.length} files...`);

  // First pass: import all pages
  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const relPath = pathModule.relative(dir, file).replace(/\\/g, "/");
    const parsed = parseMarkdownFile(content, relPath);

    const pageId = db.insertPageBulk(parsed.slug, parsed.type, parsed.title, parsed.compiled_truth, parsed.timeline, JSON.stringify(parsed.frontmatter));
    db.insertFTSBulk(pageId, parsed.title, parsed.compiled_truth, parsed.timeline);

    // Extract and insert tags
    if (parsed.frontmatter.tags && Array.isArray(parsed.frontmatter.tags)) {
      for (const tag of parsed.frontmatter.tags) {
        db.insertTag(pageId, tag);
      }
    }
  }

  // Second pass: resolve slugs and insert links
  const slugToId = db.getAllSlugs();
  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const relPath = pathModule.relative(dir, file).replace(/\\/g, "/");
    const parsed = parseMarkdownFile(content, relPath);
    const fromId = slugToId.get(parsed.slug);
    if (!fromId) continue;

    const links = extractLinks(parsed.compiled_truth + "\n" + parsed.timeline);
    for (const link of links) {
      // Resolve relative path based on current page's directory
      let targetSlug = link.target;
      const pageDir = pathModule.dirname(parsed.slug);
      if (targetSlug.startsWith("./")) {
        // Relative to current directory
        targetSlug = pageDir ? pageDir + "/" + targetSlug.substring(2) : targetSlug.substring(2);
      } else if (targetSlug.startsWith("../")) {
        // Go up directories
        let remaining = targetSlug.substring(3);
        let currentDir = pageDir;
        while (remaining.startsWith("../")) {
          currentDir = pathModule.dirname(currentDir);
          remaining = remaining.substring(3);
        }
        targetSlug = currentDir ? currentDir + "/" + remaining : remaining;
      }
      // Remove .md if still present (shouldn't be, but just in case)
      targetSlug = targetSlug.replace(/\.md$/, "");

      const toId = slugToId.get(targetSlug);
      if (toId) {
        db.insertLink(fromId, toId, link.text);
      }
    }
  }

  console.log("Done!");
  db.close();
}

async function ingestFiles(files: string[]) {
  const fs = await import("fs");
  const pathModule = await import("path");

  // Check all files exist first
  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }
  }

  const db = getDb();
  const model = db.getConfig("embedding_model") || "qwen3-embedding:latest";

  console.log(`Ingesting ${files.length} file(s)...`);

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const relPath = pathModule.relative(".", file).replace(/\\/g, "/");
    const parsed = parseMarkdownFile(content, relPath);

    // Determine title: frontmatter > extract from content > filename
    const title = parsed.frontmatter.title as string
      || extractTitle(parsed.compiled_truth + "\n" + parsed.timeline)
      || pathModule.basename(file, ".md");

    // Determine type: frontmatter.type > "md"
    const type = (parsed.frontmatter.type as string) || "md";

    // Determine agenda: frontmatter.agenda > auto-extract from content
    let agenda: string[];
    if (Array.isArray(parsed.frontmatter.agenda)) {
      agenda = parsed.frontmatter.agenda as string[];
    } else {
      // Auto-extract from ## headings
      const fullContent = parsed.compiled_truth + "\n" + parsed.timeline;
      agenda = extractAgenda(fullContent);
    }

    // Slug from file path
    const slug = relPath.replace(/\.md$/, "");

    // Delete existing page embeddings if page exists
    const existingPageId = db.getPageId(slug);
    if (existingPageId) {
      db.deleteEmbeddingsForPage(existingPageId);
    }

    // Upsert page
    db.putPage(slug, type, title, parsed.compiled_truth, parsed.timeline, parsed.frontmatter);

    // Get page ID after put
    const pageId = db.getPageId(slug)!;

    // Delete old FTS entry and re-insert
    // Note: putPage doesn't update FTS (only insert), so we need manual FTS update
    // Actually looking at db.ts, putPage uses INSERT ON CONFLICT which triggers the UPDATE trigger
    // So FTS should be updated automatically

    // Extract and insert tags
    if (parsed.frontmatter.tags && Array.isArray(parsed.frontmatter.tags)) {
      for (const tag of parsed.frontmatter.tags) {
        db.insertTag(pageId, tag as string);
      }
    }

    // Generate chunks with metadata for compiled_truth
    const fullContent = parsed.compiled_truth + "\n\n" + parsed.timeline;
    const chunks = splitIntoChunksWithMeta(fullContent, title, agenda);

    if (chunks.length > 0) {
      let embeddedCount = 0;
      for (const chunk of chunks) {
        try {
          const embeddingBytes = await embedToBytes(chunk.text, model);
          db.insertEmbedding(pageId, chunk.index, chunk.text, embeddingBytes, model);
          embeddedCount++;
        } catch (err) {
          console.warn(`  Warning: failed to embed chunk ${chunk.index}: ${err}`);
        }
      }
      console.log(`Ingested: ${slug} (${embeddedCount}/${chunks.length} chunks embedded)`);
    } else {
      console.log(`Ingested: ${slug} (no chunks)`);
    }
  }

  db.close();
  console.log("Done!");
}

function getTools() {
  return [
    { name: "brain_init", description: "Initialize a new brain.db", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "brain_get", description: "Get a page by slug", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
    { name: "brain_put", description: "Create or update a page (auto-embeds)", inputSchema: { type: "object", properties: { slug: { type: "string" }, content: { type: "string" } }, required: ["slug", "content"] } },
    { name: "brain_note", description: "Quick capture with LLM-inferred metadata (type, title, tags, compiled_truth)", inputSchema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] } },
    { name: "brain_list", description: "List pages with optional type filter", inputSchema: { type: "object", properties: { type: { type: "string" }, limit: { type: "number" } } } },
    { name: "brain_search", description: "Full-text search (FTS5)", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
    { name: "brain_query", description: "Semantic search (vector embedding)", inputSchema: { type: "object", properties: { question: { type: "string" }, limit: { type: "number" } }, required: ["question"] } },
    { name: "brain_embed", description: "Regenerate embeddings for a page or all pages", inputSchema: { type: "object", properties: { slug: { type: "string" }, all: { type: "boolean" } } } },
    { name: "brain_tags", description: "Get tags for a page", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
    { name: "brain_backlinks", description: "Get pages linking to a page", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
    { name: "brain_delete", description: "Delete pages (auto-backup first)", inputSchema: { type: "object", properties: { slugs: { type: "array", items: { type: "string" } }, yes: { type: "boolean" } }, required: ["slugs"] } },
    { name: "brain_stats", description: "Show brain statistics", inputSchema: { type: "object" } },
    { name: "brain_import", description: "Bulk import markdown files from a directory", inputSchema: { type: "object", properties: { dir: { type: "string" } }, required: ["dir"] } },
    { name: "brain_ingest", description: "Ingest one or more markdown files (with chunk metadata)", inputSchema: { type: "object", properties: { files: { type: "array", items: { type: "string" } } }, required: ["files"] } },
    { name: "brain_backup", description: "Create a timestamped backup of the database", inputSchema: { type: "object" } },
    { name: "brain_backups", description: "List all available backups", inputSchema: { type: "object" } },
    { name: "brain_restore", description: "Restore from a backup", inputSchema: { type: "object", properties: { file: { type: "string" } } } },
  ];
}
