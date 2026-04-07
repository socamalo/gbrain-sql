# GBrain Setup Guide

GBrain is a personal knowledge brain backed by SQLite with FTS5 full-text search and vector embeddings powered by Ollama.

## Prerequisites

- **bun** runtime installed: https://bun.sh
- **Ollama** installed: https://ollama.com
- **git** (optional, for cloning)

## Quick Setup

### 1. Install Ollama and Pull Embedding Model

```bash
# Install Ollama (macOS/Linux)
curl -fsSL https://ollama.com/install.sh | sh

# Pull the embedding model
ollama pull qwen3-embedding:latest
```

Verify Ollama is running:

```bash
curl http://localhost:11434/api/tags
```

### 2. Clone and Install

```bash
git clone <repo-url> GBrain
cd GBrain
bun install
bun link
```

### 3. Set Environment Variable

Add to your shell config (`~/.zshrc` or `~/.bashrc`):

```bash
export GBRAIN_DB=/path/to/your/gbrain/brain.db
```

Then reload your shell:

```bash
source ~/.zshrc
```

### 4. Verify CLI

```bash
gbrain init              # Initialize database (first time only)
gbrain stats             # Show brain statistics
gbrain list              # List all pages
gbrain --help            # Show all commands
```

### 5. Configure MCP Server

Add to your MCP config file:

**For Claude Code:** `~/.claude/mcp.json`
**For Cursor:** `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "gbrain": {
      "command": "gbrain",
      "args": ["serve"],
      "env": {
        "GBRAIN_DB": "/path/to/your/gbrain/brain.db"
      }
    }
  }
}
```

### 6. Restart MCP

Reload your IDE or Claude Code session to pick up the new MCP server.

### 7. Test MCP

In Claude Code, try:

```
search gbrain for Elon Musk
query gbrain about Tesla autonomous driving
```

## Project Structure

```
GBrain/
├── src/
│   ├── cli.ts          # CLI entry point
│   ├── core/
│   │   ├── db.ts       # SQLite + FTS5 + embeddings
│   │   ├── embeddings.ts # Ollama API + chunking
│   │   ├── markdown.ts  # Markdown parser
│   │   └── types.ts    # TypeScript types
│   └── mcp/
│       └── server.ts    # MCP server (stdio)
├── skills/            # Skill files (SKILL.md)
├── brain.db           # Knowledge database
└── package.json
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GBRAIN_DB` | `./brain.db` | Path to SQLite database |

## CLI Commands

| Command | Description |
|---------|-------------|
| `gbrain init` | Initialize new brain.db |
| `gbrain get <slug>` | Get page by slug |
| `gbrain put <slug> [file.md]` | Create/update page (auto-embeds) |
| `gbrain ingest <file1.md> [file2.md] ...` | Ingest one or more markdown files (with chunk metadata) |
| `gbrain list [--type <type>] [--limit N]` | List pages |
| `gbrain search <query>` | Full-text search (FTS5) |
| `gbrain query <question>` | Semantic search (vector) |
| `gbrain embed [slug\|--all]` | Regenerate embeddings |
| `gbrain tags <slug>` | Get page tags |
| `gbrain backlinks <slug>` | Get pages linking to slug |
| `gbrain stats` | Show statistics |
| `gbrain import <dir>` | Import markdown directory |
| `gbrain serve` | Start MCP server (stdio) |

## MCP Tools

| Tool | Description |
|------|-------------|
| `brain_get` | Get a page by slug |
| `brain_put` | Create/update a page (auto-embeds) |
| `brain_search` | Full-text search (FTS5) |
| `brain_query` | Semantic search (vector) |
| `brain_list` | List pages with optional type filter |
| `brain_stats` | Get brain statistics |
| `brain_tags` | Get tags for a page |
| `brain_backlinks` | Get pages linking to a page |

## Troubleshooting

**`gbrain: command not found`**
```bash
bun link
```

**No semantic results found / embeddings not working**
```bash
# Verify Ollama is running
curl http://localhost:11434/api/tags

# Verify embedding model is available
ollama list
```

**MCP not connecting**
- Verify the `GBRAIN_DB` path is absolute, not relative
- Restart IDE/Claude Code session
- Check MCP config file syntax

**Database shows 0 pages**
- Ensure `GBRAIN_DB` environment variable is set correctly
- Verify you're running `gbrain` from the correct directory or with proper env var

## Default Configuration

| Setting | Value |
|---------|-------|
| Embedding model | `qwen3-embedding:latest` |
| Embedding dimensions | `4096` |
| Chunk strategy | `section` (by ## headers) |
