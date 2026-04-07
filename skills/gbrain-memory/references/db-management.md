# DB Management

Backup and restore operations for the brain.db database.

## Commands

```bash
# Create a timestamped backup
gbrain backup

# List all available backups
gbrain backups

# Restore from a specific backup
gbrain restore <path-to-backup.db>

# Restore interactively (select from list)
gbrain restore
```

## Backup Naming

Backups are named with local timestamp:
```
brain.db_backup_YYYY-MM-DDTHH-mm-ss.db
```

Example: `brain.db_backup_2026-04-07T21-37-04.db`

## How It Works

### Backup

1. Reads the current `GBRAIN_DB` path (default: `./brain.db`)
2. Generates timestamp using local timezone
3. Copies database file to same directory with `_backup_{timestamp}` suffix

### Restore

1. **Pre-restore safety**: Before restoring, automatically backs up the current database
2. **Direct mode**: `gbrain restore <file>` - uses specified backup file
3. **Interactive mode**: `gbrain restore` - lists backups, prompts for selection

## Environment

```bash
GBRAIN_DB=/path/to/brain.db bun run src/cli.ts backup
```

## Safety

- Restore always creates a pre-restore backup first
- If pre-backup fails, restore aborts (won't overwrite current db)
- Backup files are never automatically deleted
