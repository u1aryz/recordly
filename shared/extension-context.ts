import { browser } from "wxt/browser";

// Chrome clears `runtime.id` for content scripts once the extension is
// reloaded, updated, or disabled; extension API calls made after that throw
// "Extension context invalidated". Check this before calling runtime,
// storage, or i18n APIs from code that can run after invalidation.
export function isExtensionContextValid(): boolean {
	return browser.runtime?.id != null;
}
