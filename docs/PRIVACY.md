# Privacy Policy for Recordly

Last updated: July 4, 2026

Recordly is a browser extension that lets you pick a video on a web page, record it, and save it to your device as MP4. This policy describes what data the extension handles and how.

## Summary

Recordly does not collect, transmit, sell, or share any user data. Everything the extension processes stays on your device.

## Data collection

Recordly collects **no** personal information, browsing history, analytics, or telemetry. The extension makes no network requests to any server operated by the developer or by third parties. There are no accounts, no sign-in, and no advertising or tracking of any kind.

## Data stored on your device

All of the following is created and stored locally on your device only, and never leaves it:

- **Recorded video files (MP4)** — written directly to the folder you choose through the browser's File System Access API when you start a recording. Only you decide where these files go, and only you can access them.
- **Capture history** — metadata about your recordings (such as the page URL and title where the video was recorded, recording duration, file size, resolution, and save status) is stored in the extension's local IndexedDB so the captures page can show progress and history. You can remove entries from the captures page at any time.
- **Settings** — small preferences (such as the on-page HUD position and the resolution-change behavior) are stored via `chrome.storage.local`.

Uninstalling the extension removes the capture history and settings. Recorded MP4 files remain in the folders you chose, under your control.

## Permissions

Recordly requests the minimum permissions it needs to work:

- **`tabs`** — used to find the active tab when you open the popup, send start/stop messages to the tab being recorded, open the captures page, and record the page URL and title into the local capture history described above.
- **`storage`** — used to save your settings locally.
- **Host access to all sites (`<all_urls>`)** — the video picker and the recording HUD are provided by a content script that must be able to run on whatever page contains the video you want to record. The content script only reads the page to locate `<video>` elements and to draw its own UI; it does not extract, store, or transmit page content.

## Third parties

Recordly does not share any data with third parties, does not use third-party analytics or advertising services, and does not transfer data off your device.

## Changes to this policy

If this policy changes, the update will be published in this repository and reflected in the "Last updated" date above. Material changes will be noted in the release notes.

## Contact

If you have questions about this policy or how Recordly handles data:

- Open an issue: https://github.com/u1aryz/recordly/issues
- Email: u1aryz.d@gmail.com

To report a security vulnerability, see the [Security Policy](SECURITY.md).
