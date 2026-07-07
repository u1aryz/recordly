---
name: update-demo-gif
description: Regenerate docs/assets/demo.gif (the README demo animation) from a fresh Playwright recording. Use when the picker/HUD UI or the recording flow changed and the demo GIF needs to reflect it.
---

# Update the README demo GIF

`docs/assets/demo.gif` is referenced by `README.md` and every `docs/readme/README_*.md`. It is generated from a Playwright recording of the real capture flow, so it must be re-recorded (not edited) whenever the content-script UI changes.

The snippets below are POSIX sh; adapt them if running in another shell (fish, PowerShell, ...).

## Steps

### 0. Check prerequisites

The conversion and verification steps need `ffmpeg`. Check for it BEFORE recording so the slow build+record step is not wasted:

```sh
command -v ffmpeg
```

If it is missing, stop and ask the user to install it first. Do not assume a specific OS or package manager — point to https://ffmpeg.org/download.html and let the user pick what fits their platform (e.g. `apt`/`dnf` on Linux, `brew` on macOS, `winget`/`choco` on Windows). Do not install it yourself without the user's confirmation.

### 1. Record

```sh
rm -rf e2e/demo/output && pnpm demo:record
```

This runs `wxt build` and then `e2e/demo/demo.spec.ts` via `playwright.demo.config.ts` (English UI, slow viewer-friendly pacing, 1280x720). Recordings land in `e2e/demo/output/` (gitignored) as one `.webm` per page — typically three: the initial blank page, the video test page (the demo), and the captures page.

The spec asserts the MP4 was actually saved, so a passing run means the recorded flow is not broken.

### 2. Pick the right source

The demo is the **video test page** recording — usually the longest one (~13s), but verify by extracting a frame rather than guessing:

```sh
for f in e2e/demo/output/*.webm; do
	ffmpeg -v error -y -ss 6 -i "$f" -frames:v 1 "<scratchpad>/frame-$(basename "$f" .webm).png"
done
```

The right one shows the red "fixed header" bar, the "Video test page" heading, and the recording HUD in the bottom-right corner. (The others are a blank white page and the dark "Recordly Captures" page.)

### 3. Convert to GIF

Match the established output spec — 800x450, 12.5fps, palette-optimized:

```sh
ffmpeg -v error -y -i "e2e/demo/output/<source>.webm" \
	-vf "fps=12.5,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
	docs/assets/demo.gif
```

The result should be well under 1 MB.

### 4. Verify the GIF visually

Extract frames at a few timestamps and Read them:

```sh
for t in 1.5 3.5 8 12.5; do
	ffmpeg -v error -y -ss $t -i docs/assets/demo.gif -frames:v 1 "<scratchpad>/gif-$t.png"
done
```

Confirm the full story is visible: picker instruction bar ("Move the pointer over the video to record") → video highlighted with the "Choose folder and start recording" strip → recording HUD with the red status dot → final "Recording stopped, and the MP4 was saved" message. If the GIF was regenerated because of a UI change, confirm that change is actually visible in these frames.

### 5. Commit

Only `docs/assets/demo.gif` should be modified (`e2e/demo/output/` stays gitignored). Commit as:

```
docs: regenerate the demo GIF from a fresh recording
```

## Adjusting the demo content

To change what the demo shows (pacing, pauses, which interactions), edit `e2e/demo/demo.spec.ts`. Recording settings (viewport, slowMo, locale) are gated behind `DEMO_VIDEO_DIR` in `e2e/fixtures.ts`.
