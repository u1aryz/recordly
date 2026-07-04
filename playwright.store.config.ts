import { defineConfig } from "@playwright/test";

// Config dedicated to Chrome Web Store asset generation, used via pnpm store:assets.
export default defineConfig({
	testDir: "./e2e/store",
	// Screenshots are captured with the English extension UI (see the setup file).
	globalSetup: "./e2e/english-ui-global-setup.ts",
	workers: 1,
	fullyParallel: false,
	timeout: 120_000,
	reporter: "list",
});
