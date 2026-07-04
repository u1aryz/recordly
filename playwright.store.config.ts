import { defineConfig } from "@playwright/test";

// Config dedicated to Chrome Web Store asset generation, used via pnpm store:assets.
export default defineConfig({
	testDir: "./e2e/store",
	workers: 1,
	fullyParallel: false,
	timeout: 120_000,
	reporter: "list",
});
