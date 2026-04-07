# MD Ingest Design

## Overview

新增 `gbrain ingest` 命令，支持从 1 个或 N 个 markdown 文件导入知识到 brain.db。每个文件生成 1 个 page，文件内的每个 `## ` 章节生成独立的 embedding chunk。

## Command

```bash
gbrain ingest <file1.md> [file2.md] [...]
```

## Processing Flow (per .md file)

1. **Parse frontmatter** — extract `title`, `type`, `agenda`
2. **Slug** — file path minus `.md` extension, e.g. `docs/go-guide.md` → `docs/go-guide`
3. **Content split** — split body at `\n---\n` into compiled_truth / timeline
4. **Title** — frontmatter `title` > first `# ` heading in content > filename
5. **Agenda** — frontmatter `agenda` (if array) > collect all `## ` headings from content
6. **Type** — frontmatter `type` > default `"md"`
7. **Chunks** — split compiled_truth and timeline separately by `## ` headings

## Chunk Text Format

Every chunk is wrapped with metadata so any retrieved chunk has full context:

```
[CHUNK_META]
title: 如何学习 Go
agenda: [概述, 安装, 基础语法, 并发编程, 实战项目]
section: 基础语法
section_index: 2
[/CHUNK_META]

<chunk content>
```

Fields:
- `title` — page title
- `agenda` — JSON array of all section titles in document order
- `section` — current section heading (empty string for intro chunk before first `##`)
- `section_index` — 0-based position in agenda

## Storage

- **Page** — one .md file = one page (slug is unique key)
- **Embeddings** — each `## ` section = one chunk in `page_embeddings`
- **Upsert** — if slug exists, update page + delete old embeddings + regenerate

## Edge Cases

| Case | Behavior |
|------|----------|
| No frontmatter | Auto-extract title from `# ` heading, agenda from `## ` headings |
| No `## ` in section | Entire compiled_truth or timeline becomes 1 chunk |
| Slug already exists | Upsert page, re-embed all chunks |
| File doesn't exist | Error with clear message |

## Test Files

- `/Users/d_d/codes/gbrain/GBrain.md`
- `/Users/d_d/codes/gbrain/README.md`
