# Contributing to Recordly

Thank you for your interest in contributing! This guide explains how to set up the project and what we expect from contributions.

This project follows the [Code of Conduct](../CODE_OF_CONDUCT.md). To report a security vulnerability, see the [Security Policy](../SECURITY.md).

## Prerequisites

- Node.js >= 22
- pnpm

Alternatively, [mise](https://mise.jdx.dev/) can set up the toolchain for you with `mise install`.

## Setup

```bash
pnpm install
```

Installing dependencies also sets up the git hooks (lefthook).

## Development

```bash
pnpm dev        # Start the WXT dev server for Chromium/Chrome
pnpm build      # Build the extension
pnpm typecheck  # TypeScript type checking
pnpm test       # Unit tests (Vitest)
pnpm test:e2e   # E2E tests (Playwright; includes a build)
pnpm format     # Biome check with autofix
```

Before running the E2E tests for the first time, install the Playwright browser:

```bash
pnpm exec playwright install chromium
```

## Code style

- Formatting and linting follow `biome.json` (run `pnpm format`).
- Use tabs for indentation and double quotes for strings.
- Prefer `async/await` for asynchronous code.
- Do not use exceptions as control flow; prefer conditionals and return values.
- Do not hardcode user-facing strings; add messages for each locale under `public/_locales/` and retrieve them via `t()` in `utils/i18n.ts`.
- Put shared logic under `shared/` and UI under the relevant `entrypoints/` directory.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and are written in English (enforced by commitlint via a git hook):

```
feat: add shake feedback to delete attempts while recording
```

## Pull requests

- Run `pnpm typecheck` and `pnpm test` before submitting.
- For changes to the content script UI (video picker, recording HUD) or the recording flow, also run `pnpm test:e2e`.
- For changes involving the build, manifest, entrypoints, or permissions, also run `pnpm build`.
- Keep pull requests focused; smaller changes are easier to review.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](../LICENSE).
