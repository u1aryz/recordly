import type {
	CaptureMetadata,
	CaptureProgress,
	PortMessage,
} from "@/shared/types";

export type CaptureViewState = {
	captures: CaptureMetadata[];
	selectedId: string | null;
};

export type CaptureViewEvent =
	| PortMessage
	| { type: "CAPTURES_LOADED"; captures: CaptureMetadata[] }
	| { type: "SELECT"; captureId: string }
	| { type: "SELECT_ADJACENT"; key: "ArrowUp" | "ArrowDown" };

export function reduceCaptureViewOnPortMessage(
	state: CaptureViewState,
	event: CaptureViewEvent,
): CaptureViewState {
	switch (event.type) {
		case "CAPTURES_LOADED":
			return {
				captures: event.captures,
				selectedId: state.selectedId ?? event.captures[0]?.id ?? null,
			};
		case "SELECT":
			return { ...state, selectedId: event.captureId };
		case "SELECT_ADJACENT":
			return {
				...state,
				selectedId: getAdjacentCaptureId(
					state.captures,
					state.selectedId,
					event.key,
				),
			};
		case "CAPTURE_CREATED":
		case "CAPTURE_UPDATED":
			return {
				captures: upsertCapture(state.captures, event.metadata),
				selectedId: state.selectedId ?? event.metadata.id,
			};
		case "CAPTURE_PROGRESS":
			return {
				...state,
				captures: state.captures.map((capture) =>
					applyCaptureProgress(capture, event.progress),
				),
			};
		case "CAPTURE_DELETED":
			return {
				captures: state.captures.filter(
					(capture) => capture.id !== event.captureId,
				),
				selectedId:
					state.selectedId === event.captureId
						? getCaptureIdAfterDeletion(state.captures, event.captureId)
						: state.selectedId,
			};
		case "CAPTURES_SUBSCRIBE":
			return state;
	}
}

export function getAdjacentCaptureId(
	captures: CaptureMetadata[],
	selectedId: string | null,
	key: "ArrowUp" | "ArrowDown",
): string | null {
	if (captures.length === 0) {
		return null;
	}

	const selectedIndex = captures.findIndex(
		(capture) => capture.id === selectedId,
	);
	const currentIndex = selectedIndex === -1 ? 0 : selectedIndex;
	const offset = key === "ArrowUp" ? -1 : 1;
	const nextIndex = Math.min(
		Math.max(currentIndex + offset, 0),
		captures.length - 1,
	);
	return captures[nextIndex]?.id ?? null;
}

export function isCaptureDeleteKey(key: string): boolean {
	return key === "Delete" || key === "Backspace";
}

export function getCaptureIdAfterDeletion(
	captures: CaptureMetadata[],
	deletedId: string,
): string | null {
	const deletedIndex = captures.findIndex(
		(capture) => capture.id === deletedId,
	);
	if (deletedIndex === -1) {
		return captures[0]?.id ?? null;
	}

	const captureBelow = captures[deletedIndex + 1];
	const captureAbove = captures[deletedIndex - 1];
	return captureBelow?.id ?? captureAbove?.id ?? null;
}

export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

export function getPageHost(pageUrl: string): string {
	try {
		return new URL(pageUrl).host || pageUrl;
	} catch {
		return pageUrl;
	}
}

function upsertCapture(
	captures: CaptureMetadata[],
	capture: CaptureMetadata,
): CaptureMetadata[] {
	const remaining = captures.filter((item) => item.id !== capture.id);
	return [capture, ...remaining].sort((a, b) => b.startedAt - a.startedAt);
}

function applyCaptureProgress(
	capture: CaptureMetadata,
	progress: CaptureProgress,
): CaptureMetadata {
	if (capture.id !== progress.id) {
		return capture;
	}
	return {
		...capture,
		...progress,
		thumbnailDataUrl: progress.thumbnailDataUrl ?? capture.thumbnailDataUrl,
	};
}
