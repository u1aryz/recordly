import { defineConfig } from "@playwright/test";

// Config dedicated to demo recording, used via pnpm demo:record.
export default defineConfig({
	testDir: "./e2e/demo",
	workers: 1,
	fullyParallel: false,
	timeout: 120_000,
	reporter: "list",
});
