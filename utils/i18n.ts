import { browser } from "wxt/browser";
import type enMessages from "@/public/_locales/en/messages.json";
import { isExtensionContextValid } from "@/shared/extension-context";

export type MessageKey = keyof typeof enMessages;

const getMessage = browser.i18n.getMessage as (
	key: string,
	substitutions?: string | string[],
) => string;

export function t(key: MessageKey, substitutions?: string | string[]): string {
	// i18n.getMessage throws once the extension context is invalidated, and
	// content script cleanup paths still build messages after that.
	if (!isExtensionContextValid()) {
		return key;
	}
	return getMessage(key, substitutions) || key;
}
