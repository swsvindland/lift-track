# Backups, export and erasing

Vector Lift has no server and no account, so a backup is a file you keep. Everything here lives in **Settings**.

## Encrypted backup

**Backup & restore → Create backup**: choose a password of at least 10 characters, then save the file from the share sheet (Files, a USB drive, AirDrop, or a cloud drive if you pick one). The file exists outside the app only once you save it somewhere. There is no password recovery.

The file contains:

- every workout with its exercises and sets, including what was prescribed
- programs, their days and slots, skipped sessions and muscle feedback
- custom exercises and per-exercise settings (favorite, avoid, rest)
- gyms and which one is active
- body weights

It leaves out:

- the bundled exercise library, which comes with the app
- appearance, units and language
- the running rest timer
- Health permissions

It keeps two kinds of Health link, so sync doesn't duplicate anything:

- **Weights imported from Health** stay linked to their samples, so they aren't imported again.
- **Workouts already saved to Health** keep their Health IDs, so they aren't saved again.

## Restore

**Restore backup**:

1. Enter the backup's password and choose the file.
2. Check its date and counts (workouts, sets, programs, weights).
3. Confirm.

Restore replaces your records; it doesn't merge them.

Before anything is replaced, the app writes an encrypted copy of your current records with the same password, reads it back and authenticates it. **Export the recovery backup** shares that copy. To undo a restore, restore that file.

Replacement is one database transaction, so a bad file, a failed recovery copy or a storage error leaves your records as they were.

Restore also:

- stops the rest timer and turns Health sync off
- starts a fresh namespace for weights written to Health (weights you logged may be written again when you turn sync back on)

It never changes Apple Health or Health Connect.

## File format

Version 1, the same scheme as Vector Macros:

- **Key:** PBKDF2-HMAC-SHA256 with 600,000 iterations and a random 16-byte salt.
- **Cipher:** AES-256-GCM with a random 12-byte nonce, from the Noble libraries. A fixed header is bound as associated data.
- **Payload:** versioned JSON checked field by field with strict schemas:
  - bounded numbers and lengths
  - known enums for muscles, equipment, set types and ratings
  - custom exercise ids in the app's own format
  - unique ids
  - every reference resolves: sets to exercises, exercises to workouts, workouts to gyms and programs, slots to days, days to programs
  - at most one open workout and one active program
- **Size:** plaintext is limited to 20 MB.
- **Safety:** file paths and SQL are never read from a backup.
- **Passwords** aren't stored. Derived keys are zeroed after use, though JavaScript can't promise every copy is gone.

## CSV export

**Your data → Export sets as CSV** writes one row per completed set, oldest first, with these columns:

- workout start and name
- program and week ("deload" for the deload week)
- exercise name and id, set type
- load in kg and lb, reps, reps in reserve
- the prescribed load, reps and RIR
- when the set was checked off

**Export body weight as CSV** writes date, kg and lb.

Text that looks like a spreadsheet formula is neutralized. CSV is unencrypted and isn't a restore format.

## Erase

**Erase all data** asks for a separate destructive confirmation. It then:

- deletes every personal table, including workouts, programs, exercises, gyms, weights, Health links and settings
- deletes the app-held recovery backups, pre-migration copies and export cache files
- stops the rest timer and turns Health sync off

Deleted rows are overwritten (`secure_delete`), the database is compacted and its write-ahead log emptied.

Erase doesn't touch files you already shared, or Apple Health and Health Connect records.

## Pre-migration copies

Before an app update migrates the database, the app saves a copy (`VACUUM INTO`) as `LiftTrackBackups/pre-migration-<n>.db` and keeps the newest two. Fresh installs skip it.

If a migration fails, the error screen offers **Share database copy**. These copies are unencrypted, like the live database, and aren't part of a backup.

## Verification

`tests/backup.test.cjs` covers:

- encryption round trip, wrong password, a changed byte, short passwords and fresh nonces
- a full history restoring exactly onto another phone, with the program continuing where it was
- inconsistent or foreign files rejected with nothing changed
- a restored workout not saved to Health twice
- erase clearing every table
- CSV rows and formula neutralizing

Share-sheet and file-picker flows need checking on devices.
