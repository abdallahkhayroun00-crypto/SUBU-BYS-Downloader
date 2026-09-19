# SUBÜ BYS Downloader v2.0.1

A Chrome extension for downloading course documents from Sakarya University of Applied Sciences (SUBÜ) BYS. This repository contains the recovered **v2.0.1** source files.

## Install (Chrome)

1. On this repository page, choose **Code → Download ZIP**, then extract the downloaded repository.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
3. Disable or remove an older copy of SUBÜ BYS Downloader, if present.
4. Click **Load unpacked**, and select the extracted folder **containing `manifest.json`**.
5. Refresh any open SUBÜ BYS tab, then open a course’s **Dokümanlar** page.
6. If you want to save files to Google Drive, choose **Connect Drive** in the extension and authorize your account.

The included Google OAuth client is configured for the original extension ID. If Google sign-in fails on a different installation or account, check your Chrome extension ID and the OAuth application's access settings. The original `README.txt` and `README_AR.txt` are preserved for reference. The legacy `CONFIGURE_GOOGLE_DRIVE.bat` script is **not required** for the recovered configured build.

## Features

- Download all files, selected files, or only files not recorded in download history.
- Save to your computer, Google Drive, or both.
- Smart week-based file names and optional per-course folders.
- Download progress, retry/skip/stop controls, and resume after interruption.
- Select a Google Drive destination folder and configure duplicate handling.
- Export a course document list as CSV.
- ON/OFF switch that disables page monitoring while the extension is OFF.

## Privacy and permissions

This extension accesses SUBÜ BYS course pages and the Google Drive account you authorize. The recovered manifest requests the broad Google Drive OAuth scope, so review the permissions before authorizing it. No Google password is needed by the extension.

This is an independent project, not an official SUBÜ extension.
