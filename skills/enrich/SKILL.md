---
name: gbrain-enrich
description: |
  Enrich person and company pages from external sources.
  Crustdata, Happenstance, Exa, Captain (Pitchbook). Validation rules enforced.
---

# Enrich Skill

## Sources

| Source | Best for | Cost |
|--------|----------|------|
| Crustdata | LinkedIn profile data (90+ fields) | API key |
| Happenstance | Career history, network search | 1-2 credits/call |
| Exa | Web search, articles, mentions | API key |
| Captain/Pitchbook | Company financials, deals, investors | API key |

## Person enrichment workflow

1. **Find LinkedIn URL** — check existing page frontmatter, Google Contacts, or Happenstance search.

2. **Hit Crustdata** — `GET /screener/person/enrich?linkedin_profile_url=...`
   - Auth: `Token` (NOT Bearer!)
   - Returns: name, title, location, headline, summary, skills, work history, education, twitter, email

3. **Validate before writing:**
   - Connection count < 20 → likely wrong person. Save to raw_data with validation flag, don't update page.
   - Name mismatch (different last name) → skip.
   - Obviously joke profiles → skip.

4. **Store raw data** — `gbrain call brain_raw '{"slug":"people/name","source":"crustdata","data":{...}}'`

5. **Distill to page** — Update compiled_truth with:
   - Location, current title, company, headline
   - Education (one line)
   - Career arc (condensed: "Auctomatic → YC Partner → Triplebyte CEO")
   - Top 3-5 skills
   - Twitter handle, LinkedIn URL

6. **DO NOT dump full data into the page.** 50 skills, 10 job descriptions → stays in raw_data only.

## Company enrichment workflow

1. **Captain API** — Search by domain, get bio, financing, investors.
2. **Crustdata** — Company search for social analytics, employee data.
3. **Store raw** → distill highlights → update page State section.

## Batch rules

- Checkpoint every 20 items to state file
- Exponential backoff on 429s (10s → 20s → 40s → ... → 5min cap)
- Dry-run mode: `--dry-run` shows what would be enriched without API calls
- Never redo already-enriched pages (check raw_data table for existing source entries)
