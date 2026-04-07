# GBrain

> Open-source personal knowledge brain. SQLite + FTS5 + vector embeddings in one file. Thin CLI harness, fat skill files.

## Inspired by Garry Tan

GBrain is a direct implementation of [Garry Tan's personal knowledge brain](https://gist.github.com/garrytan) — the "compiled truth + timeline" architecture that powers one of the most sophisticated personal knowledge management systems in Silicon Valley.

> *"Above the line: always current. Below the line: evidence base."* — Garry Tan

The architecture has been proven at scale: 1,222 people dossiers, 7,471 markdown files, 2.3GB of compiled knowledge. This project brings that same architecture to everyone, built on SQLite for zero-infrastructure simplicity.

## What is GBrain?

GBrain is a personal knowledge management system built on the "compiled truth + timeline" architecture:

- **Above the line (compiled truth):** Always current. Rewritten when new info arrives. Your intelligence assessment.
- **Below the line (timeline):** Append-only. Never rewritten. Your evidence base.

The knowledge layer to GStack's coding layer. Together: intelligence on tap.

## Features

- **Single-file database** — SQLite with FTS5 full-text search and vector embeddings. No servers, no Docker, no external services (except Ollama for embeddings).
- **FTS5 + vector search** — Keyword search and semantic search in one query, zero network hops.
- **Ollama embeddings** — Local embedding model (qwen3-embedding:latest, 4096 dimensions) via Ollama API. No API keys, no cloud costs.
- **Auto-embedding** — Pages are automatically embedded on `put`. No separate embedding step needed.
- **CLI + Skill** — Thin CLI harness, fat markdown skill files. Claude Code reads the skill and uses the CLI to interact with the brain.
- **Lossless migration** — Import existing markdown directories and export back. Every byte preserved.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Claude Code                                           │
│                           │                             │
│                           ▼                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │  gbrain-memory skill (markdown)                 │   │
│  │  references/ingest.md | query.md | maintain.md │   │
│  └─────────────────────────────────────────────────┘   │
│                           │                             │
│                           ▼                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │  gbrain CLI (bun src/cli.ts)                   │   │
│  └─────────────────────────────────────────────────┘   │
│                           │                             │
│                           ▼                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │  SQLite brain.db                                │   │
│  │  pages | page_fts | page_embeddings | links     │   │
│  └─────────────────────────────────────────────────┘   │
│                           │                             │
│                           ▼                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Ollama (qwen3-embedding:latest)               │   │
│  │  localhost:11434                                │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Prerequisites

- [bun](https://bun.sh) runtime installed
- [Ollama](https://ollama.com) installed (for embeddings)

### Install Ollama and embedding model

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull embedding model
ollama pull qwen3-embedding:latest
```

## Install

```bash
git clone https://github.com/socamalo/gbrain.git
cd gbrain
bun install
bun link
```

**Important:** Set the `GBRAIN_DB` environment variable to the brain.db path:

```bash
export GBRAIN_DB=/path/to/gbrain/brain.db  # Add to ~/.zshrc
```

## CLI Usage

```bash
# Initialize (first time only)
gbrain init

# Add a page (auto-embeds on put)
gbrain put people/elon-musk < elon.md

# Retrieve a page
gbrain get people/elon-musk

# Full-text search (FTS5)
gbrain search "Tesla autonomous"

# Semantic search (vector)
gbrain query "who builds AI supercomputers"

# Regenerate embeddings
gbrain embed people/elon-musk    # single page
gbrain embed --all               # all pages

# List pages
gbrain list
gbrain list --type person

# Show statistics
gbrain stats

# Bulk import markdown files
gbrain import ./notes/
```

## Claude Code Skill Configuration

GBrain uses Claude Code's skill system for memory. The skill is located at `skills/gbrain-memory/` and provides permanent memory storage.

### Setup

```bash
# The skill directory structure:
# skills/gbrain-memory/
# ├── SKILL.md          # Entry point, quick reference
# └── references/       # Detailed documentation
#     ├── ingest.md
#     ├── query.md
#     ├── maintain.md
#     ├── enrich.md
#     └── briefing.md

# Link the skill to Claude Code's skills directory
ln -s /path/to/gbrain/skills/gbrain-memory ~/.claude/skills/gbrain-memory
```

After restarting Claude Code, invoke with `/gbrain-memory`.

### Memory Slugs

| Slug | Content |
|------|---------|
| `user/me` | Facts about you |
| `user/projects` | Active projects |
| `user/context` | Current session context |
| `user/preferences` | How you like to work |

### Example Usage

```bash
# Store a fact
gbrain put user/me << 'EOF'
# My Profile
> Current understanding of me.

## State
- Name: Daniel
- Working on: GBrain
EOF

# Retrieve
gbrain get user/me

# Search
gbrain search "preferences"
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `gbrain get <slug>` | Get a page by slug |
| `gbrain put <slug> < file.md` | Create/update a page (auto-embeds) |
| `gbrain search "<query>"` | Full-text search (FTS5) |
| `gbrain query "<question>"` | Semantic search (vector) |
| `gbrain list [--type <type>]` | List pages with optional filter |
| `gbrain stats` | Get brain statistics |
| `gbrain tags <slug>` | Get tags for a page |
| `gbrain backlinks <slug>` | Get pages linking to a page |

## Project Structure

```
gbrain/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── core/
│   │   ├── db.ts          # SQLite + FTS5 + embeddings
│   │   ├── embeddings.ts  # Ollama API + chunking
│   │   ├── markdown.ts     # Markdown parser
│   │   └── types.ts       # TypeScript types
│   └── commands/          # CLI commands
│       ├── get.ts
│       ├── put.ts
│       ├── search.ts
│       └── ...
├── skills/                # Markdown skill files
│   └── gbrain-memory/     # Memory skill for Claude Code
│       ├── SKILL.md
│       └── references/
├── brain.db               # Knowledge database
└── package.json
```

## Database Schema

| Table | Purpose |
|-------|---------|
| `pages` | Core content: slug, type, title, compiled_truth, timeline |
| `page_fts` | FTS5 virtual table for full-text search |
| `page_embeddings` | Vector embeddings (Float32 BLOB, 4096 dims) |
| `links` | Cross-references between pages |
| `tags` | Page tags |
| `config` | Brain settings (embedding_model, dimensions, etc.) |

## Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `embedding_model` | `qwen3-embedding:latest` | Ollama embedding model |
| `embedding_dimensions` | `4096` | Embedding vector dimensions |
| `chunk_strategy` | `section` | How content is split for embedding |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GBRAIN_DB` | `./brain.db` | Path to SQLite database |

## License

MIT
