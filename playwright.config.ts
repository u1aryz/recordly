import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	// 拡張機能は persistent context を占有するため直列で実行する。
	workers: 1,
	fullyParallel: false,
	timeout: 60_000,
	reporter: "list",
});
