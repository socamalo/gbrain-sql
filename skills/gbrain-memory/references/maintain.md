# GBrain Maintain Reference

Periodic brain maintenance. Find contradictions, stale info, orphan pages, missing cross-references.

## Lint Checks (run every few days)

### 1. Contradictions
- Compare State sections across linked pages
- Flag: Page A says "CEO of X" but Page B says "left X in 2025"
- Resolution: check timeline entries for latest evidence, update the stale page

### 2. Stale Info
- `gbrain list --type person` → for each, check if compiled_truth references
  dates > 6 months old without newer timeline entries
- Flag pages where the State section hasn't been updated but timeline has new entries
- These need their compiled_truth rewritten from latest timeline evidence

### 3. Orphan Pages
- `gbrain list` → for each, `gbrain backlinks <slug>`
- Pages with zero inbound links are orphans
- Either add links from related pages or flag for potential deletion

### 4. Missing Cross-references
- Scan compiled_truth for mentions of known page titles that aren't linked
- "Person mentioned Company" but no link → add link

### 5. Dead Links
- For each link in the links table, verify both pages still exist
- Remove links to deleted pages

### 6. Open Thread Audit
- Pages with Open Threads items older than 30 days → flag for review
- Resolved items still in Open Threads → move to timeline

### 7. Tag Consistency
- List all unique tags. Flag near-duplicates: "yc-alum" vs "yc_alum" vs "yc alum"
- Normalize tag format: lowercase, hyphens

### 8. Embedding Freshness
- Pages updated since last embedding generation need re-embedding
- `gbrain embed --stale` to find and re-embed outdated pages

## Output

Generate a maintenance report as a source page:
`gbrain put sources/maintenance-YYYY-MM-DD` with findings and actions taken.
