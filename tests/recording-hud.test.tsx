import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHudStore } from "@/entrypoints/content/hud-store";
import { RecordingHud } from "@/entrypoints/content/RecordingHud";
import type { CaptureMetadata } from "@/shared/types";
import { t } from "@/utils/i18n";

function createMetadata(
	id: string,
	title: string,
	videoId = `${id}-video`,
): CaptureMetadata {
	return {
		id,
		videoId,
		tabId: 1,
		pageUrl: "https://example.test",
		title,
		startedAt: Date.now(),
		status: "recording",
		fileStatus: "writing",
		mimeType: "video/mp4",
		fileName: `${id}.mp4`,
		sizeBytes: 0,
		elapsedMs: 0,
		width: 1280,
		height: 720,
		chunkCount: 0,
		storageMode: "direct-file",
		scope: "element",
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("RecordingHud", () => {
	it("renders nothing while there are no active recordings", () => {
		const store = createHudStore();
		render(<RecordingHud onOpen={vi.fn()} onStop={vi.fn()} store={store} />);

		expect(
			screen.queryByRole("region", { name: t("recordingStatus") }),
		).not.toBeInTheDocument();
	});

	it("renders multiple recordings in one panel", () => {
		const store = createHudStore();
		render(<RecordingHud onOpen={vi.fn()} onStop={vi.fn()} store={store} />);

		act(() => {
			store.add(createMetadata("first", "First"));
			store.add(createMetadata("second", "Second"));
		});

		expect(screen.getByText("First")).toBeInTheDocument();
		expect(screen.getByText("Second")).toBeInTheDocument();
		expect(screen.getByText(t("recordingCount", "2"))).toBeInTheDocument();
	});

	it("routes controls and updates only the selected recording", () => {
		const onOpen = vi.fn();
		const onStop = vi.fn();
		const store = createHudStore();
		const { container } = render(
			<RecordingHud onOpen={onOpen} onStop={onStop} store={store} />,
		);

		act(() => {
			store.add(createMetadata("first", "First"));
			store.add(createMetadata("second", "Second"));
			store.update("first", 65_000);
			store.markStopping("second", 5000);
		});

		const first = container.querySelector('[data-capture-id="first"]');
		const second = container.querySelector('[data-capture-id="second"]');
		expect(first).toHaveTextContent("1:05");
		expect(first?.querySelector("button:last-of-type")).not.toBeDisabled();
		expect(second).toHaveTextContent(t("finalizingMp4"));
		expect(second?.querySelector("button:last-of-type")).toBeDisabled();

		fireEvent.click(
			first?.querySelector("button:first-of-type") as HTMLButtonElement,
		);
		fireEvent.click(
			first?.querySelector("button:last-of-type") as HTMLButtonElement,
		);
		expect(onOpen).toHaveBeenCalledWith("first");
		expect(onStop).toHaveBeenCalledWith("first");
	});

	it("keeps other recordings active while removing a finished row", () => {
		vi.useFakeTimers();
		const store = createHudStore();
		const { container } = render(
			<RecordingHud onOpen={vi.fn()} onStop={vi.fn()} store={store} />,
		);

		act(() => {
			store.add(createMetadata("first", "First"));
			store.add(createMetadata("second", "Second"));
			store.finish("first", "Saved.", "success");
		});

		expect(
			container.querySelector('[data-capture-id="first"]'),
		).toHaveAttribute("data-tone", "success");
		expect(screen.getByText(t("recordingCount", "1"))).toBeInTheDocument();

		act(() => {
			vi.advanceTimersByTime(8000);
		});

		expect(container.querySelector('[data-capture-id="first"]')).toBeNull();
		expect(
			container.querySelector('[data-capture-id="second"]'),
		).toBeInTheDocument();
	});

	it("hides the panel after the final result expires", () => {
		vi.useFakeTimers();
		const store = createHudStore();
		render(<RecordingHud onOpen={vi.fn()} onStop={vi.fn()} store={store} />);

		act(() => {
			store.add(createMetadata("only", "Only"));
			store.finish("only", "Saved.", "success");
		});

		act(() => {
			vi.advanceTimersByTime(8000);
		});

		expect(
			screen.queryByRole("region", { name: t("recordingStatus") }),
		).not.toBeInTheDocument();
	});

	it("temporarily highlights an existing recording", () => {
		vi.useFakeTimers();
		const store = createHudStore();
		const { container } = render(
			<RecordingHud onOpen={vi.fn()} onStop={vi.fn()} store={store} />,
		);

		act(() => {
			store.add(createMetadata("existing", "Existing"));
			store.highlight("existing");
		});

		const row = container.querySelector('[data-capture-id="existing"]');
		expect(row).toHaveAttribute("data-highlighted", "true");

		act(() => {
			vi.advanceTimersByTime(1600);
		});

		expect(row).not.toHaveAttribute("data-highlighted");
	});

	it("temporarily shows a notice then reverts to the part label", () => {
		vi.useFakeTimers();
		const store = createHudStore();
		render(<RecordingHud onOpen={vi.fn()} onStop={vi.fn()} store={store} />);

		act(() => {
			store.add(createMetadata("first", "First"));
			store.updatePart("first", 2);
			store.notify("first", "Resolution changed, switched to a new file");
		});

		expect(
			screen.getByText("Resolution changed, switched to a new file"),
		).toBeInTheDocument();

		act(() => {
			vi.advanceTimersByTime(5000);
		});

		expect(screen.getByText(t("recordingPart", "2"))).toBeInTheDocument();
	});

	it("restores and saves a dragged position", () => {
		const onPositionChange = vi.fn();
		const store = createHudStore();
		render(
			<RecordingHud
				onOpen={vi.fn()}
				onPositionChange={onPositionChange}
				onStop={vi.fn()}
				store={store}
			/>,
		);

		act(() => {
			store.add(createMetadata("existing", "Existing"));
			store.setPosition({ left: 40, top: 50 });
		});

		const header = screen.getByTitle(t("moveRecordingHud"));
		const panel = header.parentElement as HTMLElement;
		expect(panel.style.left).toBe("40px");
		expect(panel.style.top).toBe("50px");

		fireEvent.pointerDown(header, {
			button: 0,
			clientX: 10,
			clientY: 10,
			pointerId: 1,
		});
		fireEvent.pointerMove(header, { clientX: 90, clientY: 100, pointerId: 1 });
		fireEvent.pointerUp(header, { pointerId: 1 });

		expect(panel.style.left).toBe("80px");
		expect(panel.style.top).toBe("90px");
		expect(onPositionChange).toHaveBeenCalledWith({ left: 80, top: 90 });
	});
});
