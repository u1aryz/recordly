import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecordingHudManager } from "@/shared/recording-hud";
import type { CaptureMetadata } from "@/shared/types";

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
	document.documentElement
		.querySelectorAll("[data-recordly-recording-hud]")
		.forEach((element) => {
			element.remove();
		});
});

describe("recording HUD manager", () => {
	it("renders multiple recordings in one shadow host", () => {
		const manager = createRecordingHudManager({
			onOpen: vi.fn(),
			onStop: vi.fn(),
		});

		manager.add(createMetadata("first", "First"));
		manager.add(createMetadata("second", "Second"));

		const hosts = document.documentElement.querySelectorAll(
			"[data-recordly-recording-hud]",
		);
		expect(hosts).toHaveLength(1);
		expect(hosts[0]?.shadowRoot?.querySelectorAll(".item")).toHaveLength(2);
		expect(hosts[0]?.shadowRoot?.querySelector(".summary")).toHaveTextContent(
			"録画中 2件",
		);
	});

	it("routes controls and updates only the selected recording", () => {
		const onOpen = vi.fn();
		const onStop = vi.fn();
		const manager = createRecordingHudManager({ onOpen, onStop });
		manager.add(createMetadata("first", "First"));
		manager.add(createMetadata("second", "Second"));
		manager.update("first", 65_000);
		manager.markStopping("second", 5000);

		const shadow = document.querySelector<HTMLElement>(
			"[data-recordly-recording-hud]",
		)?.shadowRoot;
		const first = shadow?.querySelector<HTMLElement>(
			'[data-capture-id="first"]',
		);
		const second = shadow?.querySelector<HTMLElement>(
			'[data-capture-id="second"]',
		);
		expect(first?.querySelector(".time")).toHaveTextContent("1:05");
		expect(first?.querySelector(".stop")).not.toBeDisabled();
		expect(second?.querySelector(".detail")).toHaveTextContent(
			"MP4ファイルを確定しています。",
		);
		expect(second?.querySelector(".stop")).toBeDisabled();

		first?.querySelector<HTMLButtonElement>(".open")?.click();
		first?.querySelector<HTMLButtonElement>(".stop")?.click();
		expect(onOpen).toHaveBeenCalledWith("first");
		expect(onStop).toHaveBeenCalledWith("first");
	});

	it("keeps other recordings active while removing a finished row", () => {
		vi.useFakeTimers();
		const manager = createRecordingHudManager({
			onOpen: vi.fn(),
			onStop: vi.fn(),
		});
		manager.add(createMetadata("first", "First"));
		manager.add(createMetadata("second", "Second"));
		manager.finish("first", "保存しました。", "success");

		const host = document.querySelector<HTMLElement>(
			"[data-recordly-recording-hud]",
		);
		expect(host?.shadowRoot?.querySelector(".summary")).toHaveTextContent(
			"録画中 1件",
		);
		expect(
			host?.shadowRoot?.querySelector('[data-capture-id="first"]'),
		).toHaveClass("success");

		vi.advanceTimersByTime(8000);

		expect(
			host?.shadowRoot?.querySelector('[data-capture-id="first"]'),
		).toBeNull();
		expect(
			host?.shadowRoot?.querySelector('[data-capture-id="second"]'),
		).toBeInTheDocument();
	});

	it("removes the host after the final result expires", () => {
		vi.useFakeTimers();
		const manager = createRecordingHudManager({
			onOpen: vi.fn(),
			onStop: vi.fn(),
		});
		manager.add(createMetadata("only", "Only"));
		manager.finish("only", "保存しました。", "success");

		vi.advanceTimersByTime(8000);

		expect(document.querySelector("[data-recordly-recording-hud]")).toBeNull();
	});

	it("temporarily highlights an existing recording", () => {
		vi.useFakeTimers();
		const manager = createRecordingHudManager({
			onOpen: vi.fn(),
			onStop: vi.fn(),
		});
		manager.add(createMetadata("existing", "Existing"));

		manager.highlight("existing");

		const row = document
			.querySelector<HTMLElement>("[data-recordly-recording-hud]")
			?.shadowRoot?.querySelector('[data-capture-id="existing"]');
		expect(row).toHaveClass("highlight");

		vi.advanceTimersByTime(1600);

		expect(row).not.toHaveClass("highlight");
	});

	it("temporarily shows a notice then reverts to the part label", () => {
		vi.useFakeTimers();
		const manager = createRecordingHudManager({
			onOpen: vi.fn(),
			onStop: vi.fn(),
		});
		manager.add(createMetadata("first", "First"));
		manager.updatePart("first", 2);

		manager.notify(
			"first",
			"解像度が変わったため、新しいファイルに切り替えました",
		);

		const detail = document
			.querySelector<HTMLElement>("[data-recordly-recording-hud]")
			?.shadowRoot?.querySelector('[data-capture-id="first"] .detail');
		expect(detail).toHaveTextContent(
			"解像度が変わったため、新しいファイルに切り替えました",
		);

		vi.advanceTimersByTime(5000);

		expect(detail).toHaveTextContent("2つ目を録画中");
	});

	it("restores and saves a dragged position", async () => {
		const onPositionChange = vi.fn();
		const manager = createRecordingHudManager({
			getPosition: () => Promise.resolve({ left: 40, top: 50 }),
			onOpen: vi.fn(),
			onPositionChange,
			onStop: vi.fn(),
		});
		manager.add(createMetadata("existing", "Existing"));
		await Promise.resolve();

		const host = document.querySelector<HTMLElement>(
			"[data-recordly-recording-hud]",
		);
		const header = host?.shadowRoot?.querySelector<HTMLElement>(".header");
		expect(host?.style.left).toBe("40px");
		expect(host?.style.top).toBe("50px");

		header?.dispatchEvent(
			new PointerEvent("pointerdown", {
				button: 0,
				clientX: 10,
				clientY: 10,
				pointerId: 1,
			}),
		);
		header?.dispatchEvent(
			new PointerEvent("pointermove", {
				clientX: 90,
				clientY: 100,
				pointerId: 1,
			}),
		);
		header?.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));

		expect(host?.style.left).toBe("80px");
		expect(host?.style.top).toBe("90px");
		expect(onPositionChange).toHaveBeenCalledWith({ left: 80, top: 90 });
		manager.destroy();
	});
});
