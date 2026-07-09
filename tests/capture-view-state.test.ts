import { describe, expect, it } from "vitest";
import {
	type CaptureViewState,
	isEditableTarget,
	reduceCaptureViewOnPortMessage,
} from "@/entrypoints/captures/capture-view-state";
import type { CaptureMetadata } from "@/shared/types";

function createCapture(
	overrides: Partial<CaptureMetadata> = {},
): CaptureMetadata {
	return {
		id: "capture-1",
		videoId: "video-1",
		tabId: 1,
		pageUrl: "https://example.test",
		title: "Demo",
		startedAt: 1000,
		status: "recording",
		fileStatus: "writing",
		mimeType: "video/mp4",
		fileName: "demo.mp4",
		sizeBytes: 0,
		elapsedMs: 0,
		width: 1920,
		height: 1080,
		chunkCount: 0,
		...overrides,
	};
}

function emptyState(): CaptureViewState {
	return { captures: [], selectedId: null };
}

describe("reduceCaptureViewOnPortMessage", () => {
	it("loads captures and selects the first one when nothing was selected", () => {
		const captures = [createCapture({ id: "a" }), createCapture({ id: "b" })];
		const next = reduceCaptureViewOnPortMessage(emptyState(), {
			type: "CAPTURES_LOADED",
			captures,
		});
		expect(next.captures).toBe(captures);
		expect(next.selectedId).toBe("a");
	});

	it("keeps an existing selection when captures are (re)loaded", () => {
		const state: CaptureViewState = { captures: [], selectedId: "from-url" };
		const next = reduceCaptureViewOnPortMessage(state, {
			type: "CAPTURES_LOADED",
			captures: [createCapture({ id: "a" })],
		});
		expect(next.selectedId).toBe("from-url");
	});

	it("upserts a created/updated capture sorted by startedAt descending", () => {
		const older = createCapture({ id: "older", startedAt: 1000 });
		const state: CaptureViewState = { captures: [older], selectedId: "older" };
		const newer = createCapture({ id: "newer", startedAt: 2000 });
		const next = reduceCaptureViewOnPortMessage(state, {
			type: "CAPTURE_CREATED",
			metadata: newer,
		});
		expect(next.captures).toEqual([newer, older]);
		expect(next.selectedId).toBe("older");
	});

	it("selects a newly created capture when nothing was selected yet", () => {
		const next = reduceCaptureViewOnPortMessage(emptyState(), {
			type: "CAPTURE_CREATED",
			metadata: createCapture({ id: "a" }),
		});
		expect(next.selectedId).toBe("a");
	});

	it("replaces an existing entry in place when the same capture is updated", () => {
		const original = createCapture({ id: "a", title: "Original" });
		const state: CaptureViewState = { captures: [original], selectedId: "a" };
		const updated = createCapture({ id: "a", title: "Updated" });
		const next = reduceCaptureViewOnPortMessage(state, {
			type: "CAPTURE_UPDATED",
			metadata: updated,
		});
		expect(next.captures).toHaveLength(1);
		expect(next.captures[0]?.title).toBe("Updated");
	});

	it("applies progress only to the matching capture", () => {
		const a = createCapture({ id: "a", sizeBytes: 0 });
		const b = createCapture({ id: "b", sizeBytes: 0 });
		const state: CaptureViewState = { captures: [a, b], selectedId: "a" };
		const next = reduceCaptureViewOnPortMessage(state, {
			type: "CAPTURE_PROGRESS",
			progress: {
				id: "a",
				status: "recording",
				sizeBytes: 2048,
				elapsedMs: 5000,
				chunkCount: 3,
			},
		});
		expect(next.captures.find((c) => c.id === "a")?.sizeBytes).toBe(2048);
		expect(next.captures.find((c) => c.id === "b")?.sizeBytes).toBe(0);
		expect(next.selectedId).toBe("a");
	});

	it("keeps the previous thumbnail when progress omits one", () => {
		const a = createCapture({ id: "a", thumbnailDataUrl: "data:previous" });
		const state: CaptureViewState = { captures: [a], selectedId: "a" };
		const next = reduceCaptureViewOnPortMessage(state, {
			type: "CAPTURE_PROGRESS",
			progress: {
				id: "a",
				status: "recording",
				sizeBytes: 1,
				elapsedMs: 1,
				chunkCount: 1,
			},
		});
		expect(next.captures[0]?.thumbnailDataUrl).toBe("data:previous");
	});

	it("moves the selection down after deleting the selected capture", () => {
		const state: CaptureViewState = {
			captures: [
				createCapture({ id: "a" }),
				createCapture({ id: "b" }),
				createCapture({ id: "c" }),
			],
			selectedId: "b",
		};
		const next = reduceCaptureViewOnPortMessage(state, {
			type: "CAPTURE_DELETED",
			captureId: "b",
		});
		expect(next.captures.map((c) => c.id)).toEqual(["a", "c"]);
		expect(next.selectedId).toBe("c");
	});

	it("moves the selection up when deleting the last capture", () => {
		const state: CaptureViewState = {
			captures: [createCapture({ id: "a" }), createCapture({ id: "b" })],
			selectedId: "b",
		};
		const next = reduceCaptureViewOnPortMessage(state, {
			type: "CAPTURE_DELETED",
			captureId: "b",
		});
		expect(next.selectedId).toBe("a");
	});

	it("clears the selection when deleting the only remaining capture", () => {
		const state: CaptureViewState = {
			captures: [createCapture({ id: "a" })],
			selectedId: "a",
		};
		const next = reduceCaptureViewOnPortMessage(state, {
			type: "CAPTURE_DELETED",
			captureId: "a",
		});
		expect(next.selectedId).toBeNull();
	});

	it("leaves the selection untouched when deleting a non-selected capture", () => {
		const state: CaptureViewState = {
			captures: [createCapture({ id: "a" }), createCapture({ id: "b" })],
			selectedId: "a",
		};
		const next = reduceCaptureViewOnPortMessage(state, {
			type: "CAPTURE_DELETED",
			captureId: "b",
		});
		expect(next.selectedId).toBe("a");
	});

	it("selects an explicit capture id", () => {
		const state: CaptureViewState = {
			captures: [createCapture({ id: "a" }), createCapture({ id: "b" })],
			selectedId: "a",
		};
		const next = reduceCaptureViewOnPortMessage(state, {
			type: "SELECT",
			captureId: "b",
		});
		expect(next.selectedId).toBe("b");
	});

	it("moves the selection with SELECT_ADJACENT", () => {
		const state: CaptureViewState = {
			captures: [
				createCapture({ id: "a" }),
				createCapture({ id: "b" }),
				createCapture({ id: "c" }),
			],
			selectedId: "b",
		};
		expect(
			reduceCaptureViewOnPortMessage(state, {
				type: "SELECT_ADJACENT",
				key: "ArrowUp",
			}).selectedId,
		).toBe("a");
		expect(
			reduceCaptureViewOnPortMessage(state, {
				type: "SELECT_ADJACENT",
				key: "ArrowDown",
			}).selectedId,
		).toBe("c");
	});

	it("ignores CAPTURES_SUBSCRIBE", () => {
		const state: CaptureViewState = {
			captures: [createCapture({ id: "a" })],
			selectedId: "a",
		};
		expect(
			reduceCaptureViewOnPortMessage(state, { type: "CAPTURES_SUBSCRIBE" }),
		).toBe(state);
	});
});

describe("isEditableTarget", () => {
	it("treats form fields as editable", () => {
		expect(isEditableTarget(document.createElement("input"))).toBe(true);
		expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
		expect(isEditableTarget(document.createElement("select"))).toBe(true);
	});

	it("treats contentEditable elements as editable", () => {
		const div = document.createElement("div");
		// jsdom does not derive isContentEditable from the attribute.
		Object.defineProperty(div, "isContentEditable", { value: true });
		expect(isEditableTarget(div)).toBe(true);
	});

	it("ignores non-editable targets", () => {
		expect(isEditableTarget(null)).toBe(false);
		expect(isEditableTarget(document.createElement("div"))).toBe(false);
	});
});
