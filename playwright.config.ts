import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	// Demo recording (pnpm demo:record) is excluded from the normal test suite.
	testIgnore: "**/demo/**",
	// Run serially since the extension occupies a persistent context.
	workers: 1,
	fullyParallel: false,
	timeout: 60_000,
	reporter: "list",
});
