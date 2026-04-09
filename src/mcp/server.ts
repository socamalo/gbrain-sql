import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListToolsResultSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { BrainDB } from "../core/db";
import { renderPage } from "../core/markdown";
import { parseMarkdownFile } from "../core/markdown.js";
import { splitIntoChunks, embedToBytes } from "../core/embeddings";
import os from "os";
import path from "path";
import { existsSync, mkdirSync } from "fs";

const DEFAULT_DB = path.join(os.homedir(), "gbrain-data", "brain.db");
const DB_PATH = process.env.GBRAIN_DB || DEFAULT_DB;

const server = new Server(
  { name: "gbrain", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "brain_search",
        description: "Full-text search using FTS5",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Max results", default: 20 }
          },
          required: ["query"]
        }
      },
      {
        name: "brain_get",
        description: "Get a page by slug",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Page slug" }
          },
          required: ["slug"]
        }
      },
      {
        name: "brain_put",
        description: "Create or update a page",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string" },
            content: { type: "string" }
          },
          required: ["slug", "content"]
        }
      },
      {
        name: "brain_list",
        description: "List pages with optional type filter",
        inputSchema: {
          type: "object",
          properties: {
            type: { type: "string" },
            limit: { type: "number", default: 100 }
          }
        }
      },
      {
        name: "brain_stats",
        description: "Get brain statistics",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "brain_tags",
        description: "Get tags for a page",
        inputSchema: {
          type: "object",
          properties: { slug: { type: "string" } },
          required: ["slug"]
        }
      },
      {
        name: "brain_backlinks",
        description: "Get pages linking to a page",
        inputSchema: {
          type: "object",
          properties: { slug: { type: "string" } },
          required: ["slug"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const dbDir = path.dirname(DB_PATH);
  if (dbDir && dbDir !== "." && !existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  const db = new BrainDB(DB_PATH);
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "brain_search": {
        const results = db.searchFTS(args.query, args.limit || 20);
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
      }
      case "brain_get": {
        const page = db.getPage(args.slug);
        if (!page) return { content: [{ type: "text", text: "Not found" }], isError: true };
        const fm = JSON.parse(page.frontmatter);
        return { content: [{ type: "text", text: renderPage(page.title, page.type, page.compiled_truth, page.timeline, fm) }] };
      }
      case "brain_put": {
        const parsed = parseMarkdownFile(args.content, args.slug);
        let pageId = db.getPageId(parsed.slug);
        db.putPage(parsed.slug, parsed.type, parsed.title, parsed.compiled_truth, parsed.timeline, parsed.frontmatter);
        pageId = db.getPageId(parsed.slug)!;

        // Auto-embed content chunks
        const fullContent = parsed.compiled_truth + "\n\n" + parsed.timeline;
        const chunks = splitIntoChunks(fullContent);

        db.deleteEmbeddingsForPage(pageId);

        if (chunks.length > 0) {
          const model = db.getConfig("embedding_model") || "qwen3-embedding:latest";
          let embeddedCount = 0;

          for (const chunk of chunks) {
            try {
              const embeddingBytes = await embedToBytes(chunk.text, model);
              db.insertEmbedding(pageId, chunk.index, chunk.text, embeddingBytes, model);
              embeddedCount++;
            } catch (err) {
              // Skip failed chunks
            }
          }
          return { content: [{ type: "text", text: `Saved: ${args.slug} (${embeddedCount}/${chunks.length} chunks embedded)` }] };
        }
        return { content: [{ type: "text", text: `Saved: ${args.slug}` }] };
      }
      case "brain_list": {
        const pages = db.listPages(args.type, args.limit || 100);
        return { content: [{ type: "text", text: JSON.stringify(pages) }] };
      }
      case "brain_stats": {
        return { content: [{ type: "text", text: JSON.stringify(db.getStats()) }] };
      }
      case "brain_tags": {
        const tags = db.getTags(args.slug);
        return { content: [{ type: "text", text: tags.join(", ") }] };
      }
      case "brain_backlinks": {
        const pages = db.getBacklinks(args.slug);
        return { content: [{ type: "text", text: JSON.stringify(pages) }] };
      }
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } finally {
    db.close();
  }
});

export async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
