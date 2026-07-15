This file is a guide for code agents to understand this project.

## Project overview

Recordly is a WXT-based browser extension that lets you select a video on a web page, capture it, and save it as MP4. The popup and captures screens are built with React, and the extension's background/content scripts handle recording state and video information through shared logic.

The supported target is Chromium/Chrome. Firefox is not supported because the File System Access API (`showSaveFilePicker`) used for saving files directly and MP4 output from `MediaRecorder` are not available there in the required configuration.

The main structure is as follows.

- `entrypoints/background.ts`: Background processing for the extension.
- `entrypoints/content/`: Content script injected into web pages. Includes the React UI for the video picker and recording HUD.
- `entrypoints/popup/`: Popup UI opened from the extension icon.
- `entrypoints/captures/`: UI for capture progress and downloads after stopping.
- `shared/`: Shared logic such as message, storage, capture state, recording session/monitor, video, and file-system.
- `utils/`: Helpers such as i18n.
- `tests/`: Vitest tests for the shared logic.
- `e2e/`: Playwright E2E tests (load the extension into a real browser and verify everything from picker interaction to saving a recording).

## Development commands

Code agents work with pnpm. Only the commands used in ordinary implementation and verification are listed here.

- `pnpm install`: Install dependencies.
- `pnpm dev`: Start the WXT dev server for Chromium/Chrome.
- `pnpm build`: Build the extension for Chromium/Chrome.
- `pnpm typecheck`: Run TypeScript type checking.
- `pnpm test`: Run Vitest unit tests (only `tests/`; E2E is not included).
- `pnpm test:e2e`: Run Playwright E2E tests (includes a build). `pnpm exec playwright install chromium` is required only before the first run.
- `pnpm format`: Run Biome check with autofix.

## Code style

- Formatting and linting follow `biome.json`.
- Use tabs for indentation and double quotes for strings.
- Assume Biome recommended rules, no unused imports, required block statements, and Tailwind class sorting.
- Prefer `async/await` for asynchronous code.
- Do not intentionally throw errors inside `try` blocks. Do not use exceptions as control flow; prefer designs that express outcomes with conditionals and return values.
- Do not hardcode user-facing strings; add messages for each locale under `public/_locales/` and retrieve them via `t()` in `utils/i18n.ts`.
- For work involving WXT browser extensions, React/UI, daisyUI/Tailwind, Playwright, and the like, consult the available skills before implementing and verifying.
- Prefer existing types, shared functions, and the current directory layout; avoid unnecessary abstractions and large moves.

## Development flow

- Before making changes, review the related files, existing tests, and configuration files.
- Match the implementation to the existing structure. Put shared logic under `shared/` and UI under the relevant `entrypoints/` directory.
- After changes, run `pnpm typecheck` and `pnpm test`.
- For changes involving the build, manifest, entrypoints, or permissions, also run `pnpm build` as needed.
- For behavior changes in the content script UI (video picker, recording HUD) or the recording flow, also run `pnpm test:e2e`.
- For UI or extension behavior changes, keep the work verifiable manually with `pnpm dev`.
- Treat existing uncommitted changes as the user's work; do not revert or overwrite them on your own.

## Notes

- Commits follow Conventional Commits, with descriptions written in English.
- Prefer resolving linter errors through refactoring. If the Biome configuration needs revisiting, check with the user first.
- For browser extensions, carefully assess the impact of permission additions, manifest changes, and storage schema changes.
- The size-based part split (`PART_SPLIT_BYTES` in `shared/file-system.ts`) works around a Chromium limitation: the MediaRecorder MP4 muxer crashes the capture tab once a single recorder session emits about 4 GiB. Never remove the split; when adjusting the threshold, keep a safe margin below 4 GiB.
- `zip`-related commands and mise commands are assumed not to be used in ordinary code agent work.
