# Backups, export and erasing

Pendum Lift has no server and no account, so a backup is a file you keep. Export, restore and the recovery copy come from
the shared Vector Vault; [vault.md](vault.md) describes the format, the restore pipeline and the developer rules. This page
covers what is specific to Lift. Everything here lives in **Settings**.

## Backup

**Backup → Export data** writes one file, `PendumLift-<date>-<time>.pendumlift`, and opens the share sheet (Android
also offers **Save to device**). The file is a ZIP and is **not encrypted**; keep it somewhere private.

It holds, row for row (the descriptor `src/vault-app.ts` lists the tables):

- every workout with its exercises and sets, including what was prescribed
- programs, their days and slots, skipped sessions, muscle feedback and the model's nudges
- custom exercises and per-exercise settings (favorite, avoid, rest)
- gyms, with their left-out and added exercises, your main gym and a trip in progress
- body weights
- units, appearance and language
- the Health bookkeeping: every link between a record and its Apple Health or Health Connect sample (deleted imports
  included) and the installation ids this library's samples were written under
- CSV copies of sets and body weight (informational; never read back)

It leaves out the bundled exercise library, the running rest timer and its Live Activity, Health permissions and the
sync switch, and the old recovery copy's path.

## Restore

**Backup → Restore from a file**: choose the file, check its date and counts, confirm. Restore replaces your records; it
doesn't merge them. Before anything is replaced, the current library is kept as a recovery set; **Restore data from before
…** puts it back (the newest two are kept). A library holding only the default gym has nothing to keep.

Every restore stops the rest timer and turns Health sync off. Turning it on again doesn't duplicate anything:

- Restored records keep the client ids they were saved to Health under, so writing them again replaces those samples.
- Samples written under any installation of this library count as Lift's own and are never imported as readings.
- An import you deleted stays deleted.
- On another phone, every linked record is written once more (replacing its sample where that Health has it). From the
  other platform, records are written under their original client ids, and records deleted there are removed here.

Values the app accepts are restored as they are: there are no business limits on a restore, only checks for data the app
couldn't open (damaged JSON, unknown set kinds). Two open workouts or two active programs are reported but restored.

## Older backups (v1)

The encrypted `.backup.json` files from earlier versions still restore through **Restore from a file**:

- `lift-track-encrypted-backup` asks for its password (there is no password recovery); `lift-track-backup` opens directly.
- They're read by the old code (`decryptBackupText` in `src/lib/backup-crypto.ts`, `parseBackup` in
  `src/lib/backup-data.ts`) and written by `writeBackupRows`, the same insert code the old restore used
  (`src/vault-legacy.ts`).
- They replace the training records, body weights, Health links and the main gym. Units, appearance, language and
  everything else stay as they are on this phone; a trip in progress ends.
- This phone keeps its Health installation and treats every Lift sample as its own afterwards, so turning sync back on
  never imports them as readings. A file from **another** phone carries no client ids: its weights are written to Health
  again under this phone's installation (the preview says so).
- The last pre-restore copy the old version kept (`LiftTrackBackups/before-restore-<ms>.backup.json`) is still offered as
  **Restore data from before …** until a `.pendumlift` file is next restored. It's found by file name, so a reinstall that
  moved the app's folder doesn't lose it.

The old **Create backup** and its password are gone: new backups are the unencrypted files above.

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
- deletes the recovery sets, the old recovery copies, pre-migration copies and export cache files
- stops the rest timer and turns Health sync off
- keeps the list of Health installations, so turning sync on again doesn't import the erased weights back from Health
- starts a new library for backups

Deleted rows are overwritten (`secure_delete`), the database is compacted and its write-ahead log emptied.

Erase doesn't touch files you already shared, or Apple Health and Health Connect records.

## Pre-migration copies

Before an app update migrates the database, the app saves a copy (`VACUUM INTO`) as
`LiftTrackBackups/pre-migration-<n>.db` and keeps the newest two. Fresh installs skip it.

If a migration fails, the error screen offers **Share database copy**. These copies are unencrypted, like the live
database, and aren't part of a backup.

## Verification

- `tests/vault/*.cjs` (synced) run the vault's export, restore, recovery, crash and v1-import tests against Lift's
  descriptor and fixture (`tests/vault-fixture.cjs`).
- `tests/vault-app.test.cjs` covers Lift's Health sync after restores (no duplicated weights, deleted imports stay
  deleted, `restored:` workout links, iPhone → Android → iPhone), out-of-range values, recovery sets, v1 files with and
  without a password, preference repairs, validators and erase.
- `tests/backup.test.cjs` keeps covering the v1 code: encryption, exact restore, rejected files, a restored workout not
  saved twice, erase and CSV.

Share-sheet, folder-picker and file-picker flows need checking on devices.
