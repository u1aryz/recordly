import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { afterEach, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
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

function getMessage(
	key: keyof typeof jaMessages,
	substitutions?: string | string[],
): string {
	const definition = jaMessages[key] as LocaleMessage | undefined;
	if (!definition) {
		return "";
	}
	return replacePlaceholders(definition, normalizeSubstitutions(substitutions));
}

function applyI18nMock(): void {
	fakeBrowser.i18n.getMessage =
		getMessage as typeof fakeBrowser.i18n.getMessage;
}

applyI18nMock();

vi.mock("wxt/browser", () => ({ browser: fakeBrowser }));
// entrypoints/**/App.tsx references the global `browser` via WXT's
// auto-import, so make component tests see the same fakeBrowser instance.
vi.stubGlobal("browser", fakeBrowser);

afterEach(() => {
	fakeBrowser.reset();
	applyI18nMock();
});
