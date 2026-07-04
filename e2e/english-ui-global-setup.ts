import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Bundle ID of the Chromium build Playwright launches via channel: "chromium". */
const CHROME_DEFAULTS_DOMAIN = "com.google.chrome.for.testing";

/**
 * Forces the English browser UI while recording demo videos and store assets.
 *
 * Playwright's `locale` option only affects web content (navigator.language,
 * Accept-Language); the extension UI language (chrome.i18n) follows the
 * browser UI language, which on macOS comes from the app bundle's
 * AppleLanguages preference rather than the --lang flag. Override it for the
 * duration of the run and restore the previous state afterwards.
 */
export default async function forceEnglishBrowserUi(): Promise<
	(() => Promise<void>) | undefined
> {
	if (process.platform !== "darwin") {
		return undefined;
	}
	const previous = await exec("defaults", [
		"read",
		CHROME_DEFAULTS_DOMAIN,
		"AppleLanguages",
	]).then(
		(result) => result.stdout.trim(),
		// The key doesn't exist yet; remember to delete it on teardown.
		() => null,
	);
	await exec("defaults", [
		"write",
		CHROME_DEFAULTS_DOMAIN,
		"AppleLanguages",
		'("en-US")',
	]);
	return async () => {
		if (previous === null) {
			await exec("defaults", [
				"delete",
				CHROME_DEFAULTS_DOMAIN,
				"AppleLanguages",
			]).then(
				() => undefined,
				// Nothing to clean up if the key is already gone.
				() => undefined,
			);
			return;
		}
		await exec("defaults", [
			"write",
			CHROME_DEFAULTS_DOMAIN,
			"AppleLanguages",
			previous,
		]);
	};
}
