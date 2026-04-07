# Delete

Remove pages from the brain. All deletions are safe — a backup is created automatically before any page is removed.

## Commands

```bash
# Delete a single page (silent, auto-backup)
gbrain delete <slug>

# Delete multiple pages (prompts for confirmation, auto-backup)
gbrain delete <slug1> <slug2> <slug3>

# Delete multiple pages without prompt (scripting / automation)
gbrain delete -y <slug1> <slug2> <slug3>
```

## Safety

- **Auto-backup**: Every `delete` command creates a timestamped backup before removing any page
- **Cascading deletes**: Deleting a page also removes its embeddings, links, tags, and timeline entries automatically (via SQLite foreign keys + FTS triggers)
- **Recovery**: Use `gbrain backups` to list backups and `gbrain restore <path>` to recover

## Finding Pages to Delete

```bash
# List all pages
gbrain list

# Find by type
gbrain list --type person

# Search before deleting (confirm slug is correct)
gbrain get <slug>
gbrain search "<query>"
```

## Examples

```bash
# Delete a test entry
gbrain delete test-stale-page

# Clean up multiple test pages
gbrain delete -y test-page-1 test-page-2 test-page-3

# Verify before deleting
gbrain get test-page
# (review content...)
gbrain delete test-page
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All requested pages deleted |
| `1` | User aborted, or no pages found |

## Notes

- Pages that don't exist are skipped with a warning — they don't cause deletion to abort
- The `-y` flag skips the interactive confirmation but still creates a backup
- Backups are named `brain.db_backup_YYYY-MM-DDTHH-mm-ss.db` in the same directory as `brain.db`
