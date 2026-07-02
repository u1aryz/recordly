import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/entrypoints/popup/App";
import { continueOnResolutionChange } from "@/shared/settings";
import type { VideoDescriptor } from "@/shared/types";
import { t } from "@/utils/i18n";

function createVideo(
	overrides: Partial<VideoDescriptor> = {},
): VideoDescriptor {
	return {
		id: "video-1",
		src: "",
		currentSrc: "",
		title: "My Video",
		width: 1920,
		height: 1080,
		duration: 30,
		paused: false,
		muted: false,
		hasAudio: true,
		canCapture: true,
		...overrides,
	};
}

describe("popup App", () => {
	beforeEach(() => {
		vi.spyOn(browser.tabs, "query").mockImplementation(async () => [
			{ id: 1 } as Browser.tabs.Tab,
		]);
		vi.spyOn(browser.runtime, "sendMessage").mockImplementation(
			async () => undefined,
		);
		window.close = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders the detected videos once the page responds", async () => {
		vi.spyOn(browser.tabs, "sendMessage").mockImplementation(async () => ({
			videos: [createVideo({ title: "My Video" })],
		}));

		render(<App />);

		expect(await screen.findByText("My Video")).toBeInTheDocument();
	});

	it("shows the page-unavailable message when the content script cannot be reached", async () => {
		vi.spyOn(browser.tabs, "sendMessage").mockImplementation(async () => {
			throw new Error("no receiver");
		});

		render(<App />);

		expect(await screen.findByText(t("pageUnavailable"))).toBeInTheDocument();
	});

	it("shows a placeholder when no videos are detected", async () => {
		vi.spyOn(browser.tabs, "sendMessage").mockImplementation(async () => ({
			videos: [],
		}));

		render(<App />);

		expect(await screen.findByText(t("noVideosDetected"))).toBeInTheDocument();
	});

	it("toggles continueOnResolutionChange and persists it to storage", async () => {
		vi.spyOn(browser.tabs, "sendMessage").mockImplementation(async () => ({
			videos: [],
		}));

		render(<App />);
		await screen.findByText(t("noVideosDetected"));

		const toggle = screen.getByRole("checkbox");
		expect(toggle).toBeChecked();

		fireEvent.click(toggle);
		expect(toggle).not.toBeChecked();

		await waitFor(async () => {
			expect(await continueOnResolutionChange.getValue()).toBe(false);
		});
	});
});
