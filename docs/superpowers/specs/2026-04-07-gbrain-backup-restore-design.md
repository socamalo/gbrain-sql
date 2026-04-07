# GBrain Database Backup & Restore Design

## Overview

Add backup and restore functionality for the GBrain SQLite database (`brain.db`).

## Commands

### `gbrain backup`

Creates a timestamped copy of the current database.

**Behavior:**
- Source: `GBRAIN_DB` env var (default: `./brain.db`)
- Target naming: `{original_name}_backup_{YYYY-MM-DD}T{HH-mm-ss}.db`
  - Example: `./brain.db` → `./brain.db_backup_2026-04-07T14-30-00.db`
- Prints confirmation with the backup file path

### `gbrain backups`

Lists all available backups in the same directory as the source database.

**Output format:**
```
Available backups (most recent first):
  1. brain.db_backup_2026-04-07T14-30-00.db   2026-04-07 14:30   2.4 MB
  2. brain.db_backup_2026-04-06T09-15-00.db   2026-04-06 09:15   2.3 MB
```

### `gbrain restore [file]`

Restores the database from a backup.

**Behavior:**
- **Pre-restore backup**: Before replacing, automatically backs up the current database
- **With file argument**: Uses the specified backup file; errors if file doesn't exist
- **Without argument**: Interactive mode — lists backups, prompts user to select by number

**Safety:**
- Always creates a pre-restore backup before overwriting current database
- Validates the backup file exists and is readable before attempting restore

## File Naming Convention

Pattern: `{db_filename}_backup_{timestamp}.db`

- `brain.db` → `brain.db_backup_2026-04-07T14-30-00.db`
- Custom path like `/data/knowledge/brain.db` → `/data/knowledge/brain.db_backup_2026-04-07T14-30-00.db`

## Implementation Notes

- Use `bun:fs` for file copy operations (via `cp` or manual stream copy)
- Use `readdirSync` to scan for existing backups
- Use `statSync` to get file modification times and sizes
- Backup scanning regex: `/_backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/`

## Help Text

```
gbrain backup               Create a timestamped backup of the database
gbrain backups              List all available backups
gbrain restore [file]       Restore from a backup (interactive if no file specified)
```
