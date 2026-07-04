import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	// Demo recording (pnpm demo:record) and store asset generation
	// (pnpm store:assets) are excluded from the normal test suite.
	testIgnore: ["**/demo/**", "**/store/**"],
	// Run serially since the extension occupies a persistent context.
	workers: 1,
	fullyParallel: false,
	timeout: 60_000,
	reporter: "list",
});
