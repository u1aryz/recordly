import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./tests/setup.ts"],
		// Limit unit tests to tests/ so e2e/ (Playwright) isn't picked up.
		include: ["tests/**/*.test.{ts,tsx}"],
	},
	resolve: {
		alias: {
			"@": new URL(".", import.meta.url).pathname,
		},
	},
});
