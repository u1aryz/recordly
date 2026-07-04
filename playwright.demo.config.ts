import { defineConfig } from "@playwright/test";

// Config dedicated to demo recording, used via pnpm demo:record.
export default defineConfig({
	testDir: "./e2e/demo",
	// Demos are recorded with the English extension UI (see the setup file).
	globalSetup: "./e2e/english-ui-global-setup.ts",
	workers: 1,
	fullyParallel: false,
	timeout: 120_000,
	reporter: "list",
});
