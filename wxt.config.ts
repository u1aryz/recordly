import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// Inside the shadow DOM, rem still resolves against the host page's html
// font-size, so convert every rem left in the content CSS (daisyUI/Tailwind
// internals) to px at build time (1rem = 16px).
function contentCssRemToPx() {
	return {
		name: "content-css-rem-to-px",
		transform(code: string, id: string) {
			if (!/entrypoints\/content\/.*\.css/.test(id)) {
				return;
			}
			return {
				code: code.replaceAll(
					/(\d*\.?\d+)rem\b/g,
					(_, value: string) => `${Number.parseFloat(value) * 16}px`,
				),
				map: null,
			};
		},
	};
}

// See https://wxt.dev/api/config.html
export default defineConfig({
	modules: ["@wxt-dev/module-react", "@wxt-dev/webextension-polyfill"],
	outDir: "output",
	manifest: {
		name: "__MSG_extName__",
		description: "__MSG_extDescription__",
		default_locale: "en",
		permissions: ["tabs", "storage"],
		host_permissions: ["<all_urls>"],
	},
	dev: {
		server: {
			port: 3033,
		},
	},
	vite: () => ({
		plugins: [tailwindcss(), contentCssRemToPx()],
	}),
});
