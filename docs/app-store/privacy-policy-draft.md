# Pendum Lift privacy policy — draft for publication

Effective date: [publication date]
Operator: [legal person or company]
Privacy contact: [contact email]

Pendum Lift stores the workouts, sets, programs, custom exercises, gyms, body weights and preferences you add in the app's local storage on your device. You do not need an account. The developer does not operate a server, an account system or a cloud-storage service for these records, does not use analytics or advertising, and never receives your data.

## Camera and photos

If you choose to import a training program from a photo, the app asks for camera permission, or you pick an image from your photo library. The image is read on your device to find the program's text and is deleted from the app's storage right after; it is not kept, uploaded or included in exports.

## On-device text features

Typing or dictating sets, importing a program and describing a program are read on your device: by the app's own parser, and on supported phones by the phone's built-in model (Apple Intelligence on iPhone, Gemini Nano on Android). Nothing you enter is sent to the developer or to a cloud model.

## Apple Health and Health Connect

Health integration is optional. With your authorization, the app reads body weight from Apple Health (on Android, from Health Connect: the last 29 days, including in the background when you allow it) and writes the body weights you log and your finished workouts. A workout is saved as a strength-training session with its name (the name you gave it or its program day's name, or "Strength training" when it has none) and its start and end times; its exercises, sets and loads stay in the app, and no calorie estimate is written. Each weight and workout the app writes carries an identifier the app creates, so it can update or remove that record later. You control these permissions in iOS or Health Connect. Apple's and Google's services and any other apps you authorize, which can read what the app writes there, are subject to their respective privacy practices.

Turning sync off stops scheduled integration; it does not erase records already saved there. Imported weights remain managed by their original source. Deleting an imported weight in Pendum Lift hides it locally without deleting the source record. Editing or deleting a weight or workout the app saved replaces or removes its Health copy at the next successful sync. Restoring an export file turns Health sync off until you turn it on again; when you do, the app brings the weights and workouts it saved in Apple Health or Health Connect in line with the restored records.

## Notifications, Live Activity and Apple Watch

Rest-timer notifications and the Lock Screen Live Activity are scheduled on your device. The Apple Watch app exchanges the current workout with the paired iPhone directly; nothing passes through the developer.

## Exports and restores

You can export your data from Settings › Backup › Export data. The export is a single file containing your records (workouts, sets, programs, custom exercises, gyms and body weights, including weights imported from Apple Health or Health Connect), your preferences, and the links that keep Health sync from duplicating records. It also contains readable spreadsheet (CSV) copies of your sets and weights. The app creates the file on your device and hands it to the share sheet (or, on Android, the folder you pick); where the file goes from there is your choice. The app does not upload export files anywhere; the developer has no server for them, never receives a copy and cannot access them. If you save a file to a cloud service such as iCloud Drive or Google Drive, it is stored under that service's privacy policy.

Restoring a file (Settings › Backup › Restore from a file) replaces the records in the app with the file's contents. Password-protected backup files made by earlier versions of the app can still be restored; the password you type is used only on your device to open the file and is not stored.

Export files are not encrypted by the app. Anyone who can open the file can read your records, so keep exported files somewhere private. Erasing all data in the app does not delete files you exported.

## Retention and device backups

Records remain in local app storage until you delete them or erase all data in the app. Before a restore replaces your data, the app keeps a copy of the replaced data on your device (the two most recent are kept) so you can put it back; erasing all data deletes these copies. Operating-system backups may include the app's database depending on your device settings (iCloud or computer backups on iPhone; Google's device backup and device-to-device transfer on Android). Removing the app removes its local records. Retention of operating-system backups is controlled by the operating system and your backup provider.

## Contact and changes

For questions about privacy, contact [contact email]. We will update this policy when the app's data practices change.

---

Publication checklist: replace all bracketed fields; confirm the release binary and third-party dependencies do not transmit analytics, diagnostics or other data to the developer or partners; confirm the in-app wording of the export and restore actions matches the released version; host at a public HTTPS URL. This draft describes the source reviewed on October 5, 2026, and is not yet a published policy. The app has no automatic cloud backup; if one is added later, this policy must describe it before that release.
