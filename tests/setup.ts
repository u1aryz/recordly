import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { vi } from "vitest";
import jaMessages from "@/public/_locales/ja/messages.json";

type LocaleMessage = {
	message: string;
	placeholders?: Record<string, { content: string }>;
};

function normalizeSubstitutions(substitutions?: string | string[]): string[] {
	if (Array.isArray(substitutions)) {
		return substitutions;
	}
	return substitutions ? [substitutions] : [];
}

function replacePlaceholders(
	definition: LocaleMessage,
	values: string[],
): string {
	const message = values.reduce(
		(message, value, index) => message.replaceAll(`$${index + 1}`, value),
		definition.message,
	);
	return Object.entries(definition.placeholders ?? {}).reduce(
		(message, [name, placeholder]) => {
			const value = getPlaceholderValue(placeholder.content, values);
			if (!value) {
				return message;
			}
			return message.replaceAll(`$${name.toUpperCase()}$`, value);
		},
		message,
	);
}

function getPlaceholderValue(
	content: string,
	values: string[],
): string | undefined {
	const match = content.match(/^\$(\d+)$/);
	return match ? values[Number(match[1]) - 1] : undefined;
}

vi.mock("wxt/browser", () => ({
	browser: {
		i18n: {
			getMessage(
				key: keyof typeof jaMessages,
				substitutions?: string | string[],
			) {
				const definition = jaMessages[key] as LocaleMessage | undefined;
				if (!definition) {
					return "";
				}
				return replacePlaceholders(
					definition,
					normalizeSubstitutions(substitutions),
				);
			},
		},
	},
}));
