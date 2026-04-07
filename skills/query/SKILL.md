---
name: gbrain-query
description: |
  Answer questions from the brain using FTS5 + semantic search + structured queries.
  Synthesize across multiple pages. Cite sources.
---

# Query Skill

## Strategy: Three-layer search

1. **FTS5 keyword search** — `gbrain search "<query>"` — fast, exact matches.
   Best for: names, company names, specific terms.

2. **Semantic vector search** — `gbrain query "<question>"` — meaning-based.
   Best for: "who knows X?", "what's our thesis on Y?", conceptual questions.

3. **Structured queries** — `gbrain list --type person --tag yc-alum` +
   `gbrain backlinks <slug>` — relational navigation.
   Best for: "all YC founders in batch W25", "who links to Jensen Huang?"

## Workflow

1. Decompose the question into search strategies.
2. Run FTS5 search for key terms.
3. Run semantic query for the full question.
4. Merge and deduplicate results.
5. For top results, `gbrain get <slug>` to read full pages.
6. Synthesize answer with citations: "[Pedro Franceschi](people/pedro-franceschi)"
7. If the answer is valuable enough to keep, consider creating a new page.

## Ranking heuristic

- FTS5 score × 0.4 + vector similarity × 0.6 = combined score
- Boost pages with type matching the question intent (+0.2 for person queries hitting person pages)
- Boost pages updated in last 30 days (+0.1)
- Penalize pages with score/skill < 2 in frontmatter (-0.1)

## When you don't know

Say so. "The brain doesn't have info on X" is better than hallucinating.
Suggest enrichment: "Want me to research X via Happenstance/Crustdata and add them?"
