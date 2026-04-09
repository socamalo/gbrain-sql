# GBrain Note Reference

Quick-create a page from a natural language input. LLM infers metadata automatically.

## Usage

```bash
gbrain note "<content>"
```

**Example:**
```bash
gbrain note "Daniel is a senior software engineer, works on AI infra at Anthropic"
```

The LLM automatically infers: `type`, `title`, `tags`, and `compiled_truth`.

## Config Requirement

`gbrain note` requires the `[api]` section in `config.toml`:

```toml
[api]
base_url = "https://api.minimaxi.com/anthropic"
api_key = "env:MINIMAX_API_KEY"
model = "MiniMax-M2.7"
```

Config is found via `argv[1]` — works from any directory.

## Metadata Inference

The LLM returns this structure:

```json
{
  "type": "person, credential, project, note, idea, book, etc.",
  "title": "short title, max 30 chars",
  "tags": ["tag1", "tag2", "tag3"],
  "compiled_truth": "one-sentence summary"
}
```

## Page Creation

- **Slug:** `title-YYYY-MM-DD` (lowercased, sanitized)
- **Type:** LLM-inferred
- **Title:** LLM-inferred
- **Compiled truth:** LLM-inferred
- **Timeline:** Auto-generated with creation entry
- **Tags:** LLM-inferred (inserted as page tags)
- **Embeddings:** Auto-generated

## When to Use

- Quick hands-free capture when speed is not critical
- Best for: meeting notes, entity snapshots, quick thoughts

## vs `gbrain put` (Preferred)

| | `gbrain note` | `gbrain put` |
|---|---|---|
| Speed | Slower (LLM inference) | Fast |
| Input | Natural language | Pre-written markdown |
| Metadata | LLM-inferred | Agent controls explicitly |
| Use case | Rapid capture | Structured authoring |

**Agent recommendation:** Prefer `gbrain put <slug>` — agent generates slug, writes frontmatter, controls metadata. Only use `gbrain note` when you need rapid hands-free capture and can tolerate LLM inference overhead.
