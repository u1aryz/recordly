import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { vi } from "vitest";
import jaMessages from "@/public/_locales/ja/messages.json";

vi.mock("wxt/browser", () => ({
	browser: {
		i18n: {
			getMessage(
				key: keyof typeof jaMessages,
				substitutions?: string | string[],
			) {
				const definition = jaMessages[key];
				if (!definition) {
					return "";
				}
				const values = Array.isArray(substitutions)
					? substitutions
					: substitutions
						? [substitutions]
						: [];
				return values.reduce(
					(message, value, index) =>
						message
							.replaceAll(`$${index + 1}`, value)
							.replaceAll(/\$[A-Z_]+\$/g, value),
					definition.message,
				);
			},
		},
	},
}));
