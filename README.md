# Recordly

[![CI](https://github.com/u1aryz/recordly/actions/workflows/ci.yml/badge.svg)](https://github.com/u1aryz/recordly/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

English | [日本語](docs/readme/README_ja.md) | [Español](docs/readme/README_es.md) | [한국어](docs/readme/README_ko.md) | [简体中文](docs/readme/README_zh-CN.md)

## Overview

Recordly is a browser extension for selecting videos on a web page, capturing them, and saving the result.

Selecting a video, choosing a destination, starting the capture, checking progress, and saving the MP4 on stop all happen within the extension.

Recording data is saved in parts of roughly 2GB each.

![Demo](docs/assets/demo.gif)

## Supported browsers

Recordly targets Chromium/Chrome. Firefox is not supported.

It relies on the File System Access API (`showSaveFilePicker`) to write recorded data directly to the destination and on MP4 output from `MediaRecorder`; Firefox does not provide these required capabilities in the same configuration.

## Prerequisites

- Node.js >= 22
- pnpm

Alternatively, [mise](https://mise.jdx.dev/) can set up the toolchain for you with `mise install`.

## Setup

```bash
pnpm install
```

## Usage

Start the dev server:

```bash
pnpm dev
```

To build, use:

```bash
pnpm build
```

Once running, load the extension into the browser. On a page with a video, click the extension icon and use "Select a video to record on this page" in the popup to pick the video you want to record. In the menu that appears, choose "Choose folder and start recording" to pick a destination and start recording. While recording, you can check progress on the captures page; when you stop, the MP4 finishes saving to the chosen destination.

## Testing

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

See the [Contributing Guide](docs/CONTRIBUTING.md).

## License

[MIT](LICENSE)
