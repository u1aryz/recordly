import { defineConfig } from "@playwright/test";

// デモ録画専用の設定。pnpm demo:record から使う。
export default defineConfig({
	testDir: "./e2e/demo",
	workers: 1,
	fullyParallel: false,
	timeout: 120_000,
	reporter: "list",
});
