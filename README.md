# Recordly

[![CI](https://github.com/u1aryz/recordly/actions/workflows/ci.yml/badge.svg)](https://github.com/u1aryz/recordly/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/u1aryz/recordly)](https://github.com/u1aryz/recordly/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Pick any video on a web page, record it, and save it straight to disk as MP4 — no screen-share dialogs, no re-encoding step.

English | [日本語](docs/readme/README_ja.md) | [Español](docs/readme/README_es.md) | [한국어](docs/readme/README_ko.md) | [简体中文](docs/readme/README_zh-CN.md)

![Demo](docs/assets/demo.gif)

## Features

- **Click to pick a video** — select the exact `<video>` element on the page you want to record, no tab or screen sharing.
- **MP4, saved directly to disk** — recorded data streams straight to the destination you choose via the File System Access API, so there is no export or re-encoding step when you stop.
- **Long recordings** — recording data is split into parts of roughly 2GB each, so lengthy sessions are safe.
- **Recording HUD and progress page** — an on-page HUD while recording, plus a captures page for progress and downloads.
- **5 languages** — English, 日本語, Español, 한국어, 简体中文.

## Install

Recordly is not on the Chrome Web Store yet. Install it from a release:

1. Download `recordly-x.x.x-chrome.zip` from the [latest release](https://github.com/u1aryz/recordly/releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.

### Supported browsers

Recordly targets Chromium/Chrome. Firefox is not supported: Recordly relies on the File System Access API (`showSaveFilePicker`) to write recorded data directly to the destination and on MP4 output from `MediaRecorder`, and Firefox does not provide these required capabilities in the same configuration.

## Usage

1. On a page with a video, click the extension icon and use **Select a video to record on this page** in the popup.
2. Click the video you want to record. In the menu that appears, choose **Choose folder and start recording** to pick a destination and start recording.
3. While recording, check progress on the captures page; when you stop, the MP4 finishes saving to the chosen destination.

## Development

Prerequisites: Node.js >= 22 and pnpm. Alternatively, [mise](https://mise.jdx.dev/) can set up the toolchain for you with `mise install`.

```bash
pnpm install
pnpm dev        # Start the WXT dev server for Chromium/Chrome
pnpm build      # Build the extension
```

### Testing

Run the unit tests for the shared logic (Vitest):

```bash
pnpm test
```

The E2E tests (Playwright) load the built extension into a real browser and verify everything from selecting a video to starting a recording and saving the MP4.

```bash
pnpm test:e2e
```

Before running the E2E tests for the first time, install the Playwright browser:

```bash
pnpm exec playwright install chromium
```

## Contributing

See the [Contributing Guide](docs/CONTRIBUTING.md). This project follows the [Code of Conduct](docs/CODE_OF_CONDUCT.md); to report a vulnerability, see the [Security Policy](docs/SECURITY.md). Recordly does not collect any user data — see the [Privacy Policy](docs/PRIVACY.md).

## License

[MIT](LICENSE)
