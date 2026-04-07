# GBrain Backup & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `gbrain backup`, `gbrain backups`, and `gbrain restore` commands to CLI

**Architecture:** Single-file modification to `src/cli.ts`. Helper functions for backup scanning, file copying, and interactive selection. No new dependencies.

**Tech Stack:** Bun runtime, `bun:fs` for file operations, existing `BrainDB` class for database access

---

## File Map

- Modify: `src/cli.ts` — add three new commands and helper functions

---

## Task 1: Add `backup` Command

**Files:**
- Modify: `src/cli.ts:16-26` (add case in switch statement after line 26)

- [ ] **Step 1: Add case "backup" in switch**

Add this case block after line 26 (after the `init` case):

```typescript
case "backup": {
  const fs = await import("bun:fs");
  const pathModule = await import("path");
  const dbPath = DB_PATH;
  const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const backupName = pathModule.basename(dbPath) + "_backup_" + timestamp + ".db";
  const backupPath = pathModule.join(pathModule.dirname(dbPath), backupName);

  await Bun.write(backupPath, await Bun.file(dbPath).arrayBuffer());
  console.log("Backup created: " + backupPath);
  break;
}
```

- [ ] **Step 2: Test backup command**

```bash
cd /Users/d_d/codes/gbrain && GBRAIN_DB=./brain.db bun run src/cli.ts backup
```
Expected: prints "Backup created: ./brain.db_backup_2026-04-07T..." and file exists

- [ ] **Step 3: Verify backup file created**

```bash
ls -la *.db_backup_*.db 2>/dev/null | head -5
```

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts && git commit -m "feat: add gbrain backup command"
```

---

## Task 2: Add `backups` Command

**Files:**
- Modify: `src/cli.ts` — add helper function and case

- [ ] **Step 1: Add helper function after line 11 (after `getDb` function)**

```typescript
function listBackups(): { name: string; path: string; mtime: Date; size: number }[] {
  const fs = await import("bun:fs");
  const pathModule = await import("path");
  const dbDir = pathModule.dirname(DB_PATH);
  const dbBasename = pathModule.basename(DB_PATH);
  const pattern = new RegExp("^" + dbBasename.replace(".", "\\.") + "_backup_\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.db$");

  try {
    const files = fs.readdirSync(dbDir);
    const backups = files
      .filter(f => pattern.test(f))
      .map(f => {
        const stat = fs.statSync(pathModule.join(dbDir, f));
        return { name: f, path: pathModule.join(dbDir, f), mtime: stat.mtime, size: stat.size };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return backups;
  } catch {
    return [];
  }
}
```

Note: Since this is inside `src/cli.ts` which is top-level await compatible, we can use async import pattern.

Actually, `listBackups` should be synchronous since we use `await import` inside. Let me reconsider:

```typescript
async function listBackups() {
  const fs = await import("bun:fs");
  const pathModule = await import("path");
  const dbDir = pathModule.dirname(DB_PATH);
  const dbBasename = pathModule.basename(DB_PATH);
  const pattern = new RegExp("^" + dbBasename.replace(".", "\\.") + "_backup_\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.db$");

  try {
    const files = fs.readdirSync(dbDir);
    const backups = files
      .filter(f => pattern.test(f))
      .map(f => {
        const stat = fs.statSync(pathModule.join(dbDir, f));
        return { name: f, path: pathModule.join(dbDir, f), mtime: stat.mtime, size: stat.size };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return backups;
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Add case "backups" in switch**

Add after line 26 (after backup case):

```typescript
case "backups": {
  const backups = await listBackups();
  if (backups.length === 0) {
    console.log("No backups found.");
  } else {
    console.log("Available backups (most recent first):");
    backups.forEach((b, i) => {
      const sizeMB = (b.size / 1024 / 1024).toFixed(1);
      const dateStr = b.mtime.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
      console.log(`  ${i + 1}. ${b.name}   ${dateStr}   ${sizeMB} MB`);
    });
  }
  break;
}
```

- [ ] **Step 3: Test backups command**

```bash
cd /Users/d_d/codes/gbrain && GBRAIN_DB=./brain.db bun run src/cli.ts backups
```
Expected: Lists backup files found

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts && git commit -m "feat: add gbrain backups command"
```

---

## Task 3: Add `restore` Command

**Files:**
- Modify: `src/cli.ts` — add case and prompt function

- [ ] **Step 1: Add `promptBackupSelection` helper function**

Add after line 11 (after `getDb` function):

```typescript
async function promptBackupSelection(backups: { name: string; path: string }[]): Promise<string | null> {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question("Select backup number to restore: ", (answer) => {
      rl.close();
      const idx = parseInt(answer) - 1;
      if (isNaN(idx) || idx < 0 || idx >= backups.length) {
        resolve(null);
      } else {
        resolve(backups[idx].path);
      }
    });
  });
}
```

- [ ] **Step 2: Add case "restore" in switch**

Add after line 26 (after backups case):

```typescript
case "restore": {
  const fs = await import("bun:fs");
  const pathModule = await import("path");
  const dbPath = DB_PATH;
  const targetFile = args[1];

  let backupPath: string;

  if (targetFile) {
    // Direct path provided
    if (!fs.existsSync(targetFile)) {
      console.error(`Backup file not found: ${targetFile}`);
      process.exit(1);
    }
    backupPath = targetFile;
  } else {
    // Interactive mode
    const backups = await listBackups();
    if (backups.length === 0) {
      console.error("No backups found. Cannot restore.");
      process.exit(1);
    }

    console.log("Available backups (most recent first):");
    backups.forEach((b, i) => {
      const sizeMB = (b.size / 1024 / 1024).toFixed(1);
      const dateStr = b.mtime.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
      console.log(`  ${i + 1}. ${b.name}   ${dateStr}   ${sizeMB} MB`);
    });

    const selected = await promptBackupSelection(backups);
    if (!selected) {
      console.error("Invalid selection.");
      process.exit(1);
    }
    backupPath = selected;
  }

  // Pre-restore backup of current database
  const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const preBackupName = pathModule.basename(dbPath) + "_backup_" + timestamp + ".db";
  const preBackupPath = pathModule.join(pathModule.dirname(dbPath), preBackupName);

  console.log("Creating pre-restore backup: " + preBackupPath);
  await Bun.write(preBackupPath, await Bun.file(dbPath).arrayBuffer());

  // Restore from backup
  console.log("Restoring from: " + backupPath);
  await Bun.write(dbPath, await Bun.file(backupPath).arrayBuffer());
  console.log("Restore complete.");

  break;
}
```

- [ ] **Step 3: Test restore command with direct path**

```bash
cd /Users/d_d/codes/gbrain && GBRAIN_DB=./brain.db bun run src/cli.ts restore ./brain.db_backup_2026-04-07T*.db 2>/dev/null || echo "No backup to test with"
```
Expected: Error if no backup found, or restores if found

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts && git commit -m "feat: add gbrain restore command"
```

---

## Task 4: Update Help Text

**Files:**
- Modify: `src/cli.ts:393-415` (printHelp function)

- [ ] **Step 1: Update help text**

In `printHelp()`, add these lines to the Commands section:

```typescript
gbrain backup               Create a timestamped backup of the database
gbrain backups              List all available backups
gbrain restore [file]       Restore from a backup (interactive if no file specified)
```

- [ ] **Step 2: Test help output**

```bash
cd /Users/d_d/codes/gbrain && bun run src/cli.ts --help
```
Expected: Help text includes backup, backups, restore commands

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts && git commit -m "docs: add backup/restore commands to help text"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|------------------|------|
| `gbrain backup` command | Task 1 |
| `gbrain backups` command | Task 2 |
| `gbrain restore [file]` | Task 3 |
| Pre-restore automatic backup | Task 3 |
| Interactive restore | Task 3 |
| Help text | Task 4 |

All spec requirements are covered.
