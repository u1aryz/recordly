import type { browser as browserType } from "wxt/browser";
import { browser } from "wxt/browser";

export type MessageKey = Exclude<
	Parameters<typeof browserType.i18n.getMessage>[0],
	`@@${string}`
>;

export function t(key: MessageKey, substitutions?: string | string[]): string {
	return browser.i18n.getMessage(key, substitutions) || key;
}
