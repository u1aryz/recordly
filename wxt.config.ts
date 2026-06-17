import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
	modules: ["@wxt-dev/module-react", "@wxt-dev/webextension-polyfill"],
	outDir: "output",
	manifest: {
		name: "__MSG_extName__",
		description: "__MSG_extDescription__",
		default_locale: "en",
		permissions: ["activeTab", "tabs", "storage", "downloads"],
		host_permissions: ["<all_urls>"],
	},
	webExt: {
		binaries: {
			chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		},
		keepProfileChanges: true,
		chromiumArgs: [
			"--disable-blink-features=AutomationControlled",
			"--disable-features=IsolateOrigins,site-per-process",
			"--remote-debugging-port=9222",
		],
		startUrls: ["https://kick.com/"],
	},
	dev: {
		server: {
			port: 3033,
		},
	},
	vite: () => ({
		plugins: [tailwindcss()],
	}),
});
