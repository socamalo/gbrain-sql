# GBrain

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![bun](https://img.shields.io/badge/bun-v1.3+-f9f2f4?logo=bun)](https://bun.sh)
[![Ollama](https://img.shields.io/badge/Ollama-11434-blue?logo=ollama)](https://ollama.com)

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
│  │  gbrain CLI (thin harness)                     │   │
│  └─────────────────────────────────────────────────┘   │
│                           │                             │
│                           ▼                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │  SQLite brain.db                                │   │
│  │  pages | page_fts | page_embeddings | links   │   │
│  └─────────────────────────────────────────────────┘   │
│                           │                             │
│                           ▼                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Ollama (qwen3-embedding:latest)               │   │
│  │  localhost:11434                                │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Skills are the brain. CLI is just the hands.** The intelligence lives in markdown skill files. Claude Code reads the skill and uses the CLI to interact with the brain — but the skill defines the behavior, not the code.

## Skills (Fat Markdown)

Skills are the core of GBrain. They define HOW to work with the brain — not as code, but as markdown documents that Claude Code reads and follows.

### Available Skills

| Skill | Purpose |
|-------|---------|
| `gbrain-memory` | Permanent memory: ingest, query, maintain |
| `references/ingest.md` | Ingest meetings, articles, docs |
| `references/query.md` | Three-layer search: FTS5 + vector + structured |
| `references/maintain.md` | Lint: contradictions, stale info, orphans |
| `references/enrich.md` | External enrichment (LinkedIn, company data) |
| `references/briefing.md` | Compile daily briefings |
| `references/note.md` | Quick capture with LLM-inferred metadata |

### Core Memory Slugs

| Slug | Content |
|------|---------|
| `user/me` | Facts about you (name, role, background) |
| `user/projects` | Active projects and their goals |
| `user/context` | Current session context and ongoing work |
| `user/preferences` | How you like to work (tools, communication style) |
| `feedback/*` | Lessons learned from past feedback |
| `reference/*` | Pointers to external systems (Linear, Grafana, etc.) |

### Quick Commands

```bash
# Retrieve
gbrain get user/me

# Store a fact
gbrain put user/me << 'EOF'
# My Profile
> Current understanding of me.

## State
- Name: Daniel
- Working on: GBrain
EOF

# Full-text search
gbrain search "preferences"

# Semantic search
gbrain query "what projects am I working on"
```

## CLI (Thin Harness)

The CLI is intentionally thin — it just moves data. All intelligence comes from skills.

```bash
# Initialize (first time only)
gbrain init

# Add a page (auto-embeds on put)
gbrain put people/elon-musk < elon.md

# Quick note with LLM-inferred metadata
gbrain note "Daniel works at Anthropic on AI infra"

# Ingest one or more markdown files (each ## section becomes a chunk with metadata)
gbrain ingest article.md
gbrain ingest doc1.md doc2.md doc3.md

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

### CLI Reference

| Command | Description |
|---------|-------------|
| `gbrain init <path>` | Initialize a new brain.db |
| `gbrain get <slug>` | Get a page by slug |
| `gbrain put <slug> [file.md]` | Create/update a page (auto-embeds) |
| `gbrain note "<content>"` | Quick capture with LLM-inferred metadata |
| `gbrain list [--type <type>]` | List pages with optional filter |
| `gbrain search <query>` | Full-text search (FTS5) |
| `gbrain query <question>` | Semantic search (vector) |
| `gbrain embed [slug\|--all]` | Regenerate embeddings |
| `gbrain tags <slug>` | Get tags for a page |
| `gbrain backlinks <slug>` | Get pages linking to a page |
| `gbrain delete [-y\|--yes] <slug> [...]` | Delete pages (auto-backup first) |
| `gbrain stats` | Show brain statistics |
| `gbrain import <dir>` | Import markdown files (bulk) |
| `gbrain ingest <file.md> [...]` | Ingest one or more markdown files (with chunk metadata) |
| `gbrain backup` | Create a timestamped backup |
| `gbrain backups` | List all available backups |
| `gbrain restore [file]` | Restore from a backup |
| `gbrain --tools-json` | Show Claude Code tools |

## Claude Code Memory Integration

GBrain provides a permanent memory skill that survives session boundaries. Unlike session context which is lost when Claude Code exits, gbrain stores knowledge indefinitely and loads it at the start of every new conversation.

### Setup

```bash
# Link the skill to Claude Code's skills directory
ln -s /path/to/gbrain/skills/gbrain-memory ~/.claude/skills/gbrain-memory
```

After restarting Claude Code, invoke with `/gbrain-memory`.

### Proactive Memory Usage (CLAUDE.md / AGENTS.md)

To make Claude Code proactively use memory, add the following to your global `~/.claude/CLAUDE.md` or project-level `AGENTS.md`:

```markdown
## Memory

**Before acting, always check memory first.** Permanent memory is a collection of past experiences.

When you encounter names, projects, decisions, or requirements — first ask yourself: have I seen this before?

- Invoke the `gbrain-memory` skill to interact with permanent memory
- Use `gbrain get <slug>` to retrieve known facts
- Use `gbrain search "<query>"` to find relevant past context
- Use `gbrain put <slug> < content.md` to store new knowledge

### When to Write to Memory

1. User introduces themselves or shares a fact about who they are
2. User expresses a preference or working style
3. A project goal or deadline is mentioned
4. User gives feedback on how to approach work
5. Anything that would be useful in future sessions

### When to Read from Memory

1. Start of conversation: retrieve `user/me`, `user/projects`, `user/preferences`
2. When user asks about their projects or prior work
3. When making suggestions that should account for user preferences
4. When encountering names or terms you're unsure about
```

This configuration ensures Claude Code treats memory as a first-class tool — not an afterthought, but a proactive part of every session.

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

`config.toml` in the project root is automatically found via `argv[1]` — works from any directory.

```toml
[ollama]
url = "http://localhost:11434"
embedding_model = "qwen3-embedding:latest"
chat_model = "qwen3:latest"

[api]
base_url = "https://api.minimaxi.com/anthropic"
api_key = "env:MINIMAX_API_KEY"
model = "MiniMax-M2.7"
```

| Key | Default | Description |
|-----|---------|-------------|
| `embedding_model` | `qwen3-embedding:latest` | Ollama embedding model |
| `embedding_dimensions` | `4096` | Embedding vector dimensions |
| `chunk_strategy` | `section` | How content is split for embedding |

Config is looked up via `argv[1]` (the CLI script path) — walk up from script dir to find project root with `config.toml`. Falls back to `~/.gbrain/config.toml`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GBRAIN_DB` | `./brain.db` | Path to SQLite database |

## License

MIT
