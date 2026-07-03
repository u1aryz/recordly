import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./tests/setup.ts"],
		// e2e/(Playwright)を巻き込まないよう、ユニットテストは tests/ 配下に限定する。
		include: ["tests/**/*.test.{ts,tsx}"],
	},
	resolve: {
		alias: {
			"@": new URL(".", import.meta.url).pathname,
		},
	},
});
