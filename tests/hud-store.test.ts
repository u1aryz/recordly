import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clampHudPosition,
	createHudStore,
} from "@/entrypoints/content/hud-store";
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
});

describe("createHudStore", () => {
	it("prepends new rows and counts only recording rows", () => {
		const store = createHudStore();

		store.add(createMetadata("first", "First"));
		store.add(createMetadata("second", "Second"));

		const state = store.getSnapshot();
		expect(state.rows.map((row) => row.id)).toEqual(["second", "first"]);
		expect(state.recordingCount).toBe(2);
	});

	it("updates only the targeted row", () => {
		const store = createHudStore();
		store.add(createMetadata("first", "First"));
		store.add(createMetadata("second", "Second"));

		store.update("first", 65_000);
		store.markStopping("second", 5000);

		const rows = store.getSnapshot().rows;
		const first = rows.find((row) => row.id === "first");
		const second = rows.find((row) => row.id === "second");
		expect(first?.elapsedMs).toBe(65_000);
		expect(first?.stopping).toBe(false);
		expect(second?.elapsedMs).toBe(5000);
		expect(second?.stopping).toBe(true);
		expect(second?.detail).toEqual({ kind: "finalizing" });
	});

	it("applies finalize progress only while the row is stopping", () => {
		const store = createHudStore();
		store.add(createMetadata("first", "First"));

		store.updateFinalizeProgress("first", {
			currentPart: 1,
			totalParts: 2,
			percent: 40,
		});
		expect(store.getSnapshot().rows[0].detail).toEqual({ kind: "recording" });

		store.markStopping("first", 5000);
		store.updateFinalizeProgress("first", {
			currentPart: 2,
			totalParts: 2,
			percent: 64,
		});
		expect(store.getSnapshot().rows[0].detail).toEqual({
			kind: "finalizing",
			progress: { currentPart: 2, totalParts: 2, percent: 64 },
		});
	});

	it("keeps other recordings active while removing a finished row", () => {
		vi.useFakeTimers();
		const store = createHudStore();
		store.add(createMetadata("first", "First"));
		store.add(createMetadata("second", "Second"));

		store.finish("first", "Saved.", "success");

		let state = store.getSnapshot();
		expect(state.recordingCount).toBe(1);
		expect(state.rows.find((row) => row.id === "first")?.detail).toEqual({
			kind: "result",
			message: "Saved.",
			tone: "success",
		});

		vi.advanceTimersByTime(8000);

		state = store.getSnapshot();
		expect(state.rows.map((row) => row.id)).toEqual(["second"]);
	});

	it("removes the last row after the final result expires", () => {
		vi.useFakeTimers();
		const store = createHudStore();
		store.add(createMetadata("only", "Only"));

		store.finish("only", "Saved.", "success");
		vi.advanceTimersByTime(8000);

		expect(store.getSnapshot().rows).toHaveLength(0);
	});

	it("temporarily highlights an existing recording", () => {
		vi.useFakeTimers();
		const store = createHudStore();
		store.add(createMetadata("existing", "Existing"));

		store.highlight("existing");
		expect(
			store.getSnapshot().rows.find((row) => row.id === "existing")
				?.highlighted,
		).toBe(true);

		vi.advanceTimersByTime(1600);

		expect(
			store.getSnapshot().rows.find((row) => row.id === "existing")
				?.highlighted,
		).toBe(false);
	});

	it("increments the highlight nonce on every highlight call", () => {
		vi.useFakeTimers();
		const store = createHudStore();
		store.add(createMetadata("existing", "Existing"));

		store.highlight("existing");
		expect(
			store.getSnapshot().rows.find((row) => row.id === "existing")
				?.highlightNonce,
		).toBe(1);

		store.highlight("existing");
		expect(
			store.getSnapshot().rows.find((row) => row.id === "existing")
				?.highlightNonce,
		).toBe(2);
	});

	it("updates the resolution when a new part starts", () => {
		const store = createHudStore();
		store.add(createMetadata("first", "First"));

		store.updatePart("first", 2, { width: 1920, height: 1080 });

		const row = store.getSnapshot().rows.find((row) => row.id === "first");
		expect(row?.partCount).toBe(2);
		expect(row?.width).toBe(1920);
		expect(row?.height).toBe(1080);
	});

	it("temporarily shows a notice then reverts to the part label", () => {
		vi.useFakeTimers();
		const store = createHudStore();
		store.add(createMetadata("first", "First"));
		store.updatePart("first", 2, { width: 1920, height: 1080 });

		store.notify("first", "Resolution changed, switched to a new file");

		expect(
			store.getSnapshot().rows.find((row) => row.id === "first")?.detail,
		).toEqual({
			kind: "notice",
			message: "Resolution changed, switched to a new file",
		});

		vi.advanceTimersByTime(5000);

		const row = store.getSnapshot().rows.find((row) => row.id === "first");
		expect(row?.detail).toEqual({ kind: "part" });
		expect(row?.partCount).toBe(2);
	});

	it("cancels the pending notice timer when a new part starts", () => {
		vi.useFakeTimers();
		const store = createHudStore();
		store.add(createMetadata("first", "First"));

		store.notify("first", "notice");
		store.updatePart("first", 3, { width: 1920, height: 1080 });
		vi.advanceTimersByTime(5000);

		const row = store.getSnapshot().rows.find((row) => row.id === "first");
		expect(row?.detail).toEqual({ kind: "part" });
		expect(row?.partCount).toBe(3);
	});

	it("clears all rows and pending timers on destroy", () => {
		vi.useFakeTimers();
		const store = createHudStore();
		store.add(createMetadata("first", "First"));
		store.finish("first", "done", "success");

		store.destroy();
		vi.advanceTimersByTime(8000);

		expect(store.getSnapshot().rows).toHaveLength(0);
	});

	it("stores and clears the drag position", () => {
		const store = createHudStore();
		expect(store.getSnapshot().position).toBeNull();

		store.setPosition({ left: 40, top: 50 });
		expect(store.getSnapshot().position).toEqual({ left: 40, top: 50 });

		store.setPosition(null);
		expect(store.getSnapshot().position).toBeNull();
	});

	it("toggles the closing flag and skips redundant emits", () => {
		const store = createHudStore();
		const listener = vi.fn();
		store.subscribe(listener);
		expect(store.getSnapshot().closing).toBe(false);

		store.setClosing(true);
		expect(store.getSnapshot().closing).toBe(true);
		expect(listener).toHaveBeenCalledTimes(1);

		store.setClosing(true);
		expect(listener).toHaveBeenCalledTimes(1);

		store.setClosing(false);
		expect(store.getSnapshot().closing).toBe(false);
		expect(listener).toHaveBeenCalledTimes(2);
	});
});

describe("clampHudPosition", () => {
	const viewport = { width: 1024, height: 768 };

	it("keeps a position inside the viewport unchanged", () => {
		expect(
			clampHudPosition(100, 100, { width: 390, height: 160 }, viewport),
		).toEqual({ left: 100, top: 100 });
	});

	it("clamps to the margin when the position is negative", () => {
		expect(
			clampHudPosition(-50, -50, { width: 390, height: 160 }, viewport),
		).toEqual({ left: 16, top: 16 });
	});

	it("clamps to the far edge when the position overflows the viewport", () => {
		expect(
			clampHudPosition(2000, 2000, { width: 390, height: 160 }, viewport),
		).toEqual({
			left: viewport.width - 390 - 16,
			top: viewport.height - 160 - 16,
		});
	});

	it("falls back to the default panel size when the element has no layout yet", () => {
		expect(
			clampHudPosition(2000, 2000, { width: 0, height: 0 }, viewport),
		).toEqual({
			left: viewport.width - 390 - 16,
			top: viewport.height - 160 - 16,
		});
	});
});
