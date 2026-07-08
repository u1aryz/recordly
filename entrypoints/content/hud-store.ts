import type { HudPosition } from "@/shared/settings";
import type { CaptureMetadata } from "@/shared/types";

export type HudTone = "success" | "warning" | "error";

export type HudRowDetail =
	| { kind: "recording" }
	| { kind: "part" }
	| { kind: "notice"; message: string }
	| { kind: "finalizing" }
	| { kind: "result"; message: string; tone: HudTone };

export type HudRow = {
	id: string;
	title: string;
	width: number;
	height: number;
	thumbnailDataUrl?: string;
	elapsedMs: number;
	partCount: number;
	recording: boolean;
	stopping: boolean;
	highlighted: boolean;
	highlightNonce: number;
	detail: HudRowDetail;
};

export type HudState = {
	rows: HudRow[];
	recordingCount: number;
	position: HudPosition | null;
	closing: boolean;
};

export type HudStore = {
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => HudState;
	add: (metadata: CaptureMetadata) => void;
	update: (captureId: string, elapsedMs: number) => void;
	updatePart: (captureId: string, partCount: number) => void;
	notify: (captureId: string, message: string) => void;
	markStopping: (captureId: string, elapsedMs: number) => void;
	finish: (captureId: string, message: string, tone: HudTone) => void;
	remove: (captureId: string) => void;
	highlight: (captureId: string) => void;
	setPosition: (position: HudPosition | null) => void;
	setClosing: (closing: boolean) => void;
	destroy: () => void;
};

const RESULT_DISPLAY_MS = 8000;
const HIGHLIGHT_DISPLAY_MS = 1600;
const NOTICE_DISPLAY_MS = 5000;
export const HUD_MARGIN_PX = 16;
// Keep in sync with .hud-panel-exit's animation duration in style.css.
export const HUD_EXIT_ANIMATION_MS = 150;
const FALLBACK_PANEL_WIDTH_PX = 390;
const FALLBACK_PANEL_HEIGHT_PX = 160;

type RowTimers = {
	removeTimer?: number;
	highlightTimer?: number;
	noticeTimer?: number;
};

export type ElementSize = { width: number; height: number };

export function clampHudPosition(
	left: number,
	top: number,
	size: ElementSize,
	viewport: ElementSize,
	margin: number = HUD_MARGIN_PX,
): HudPosition {
	const width = size.width || FALLBACK_PANEL_WIDTH_PX;
	const height = size.height || FALLBACK_PANEL_HEIGHT_PX;
	const maxLeft = Math.max(margin, viewport.width - width - margin);
	const maxTop = Math.max(margin, viewport.height - height - margin);
	return {
		left: Math.min(Math.max(margin, left), maxLeft),
		top: Math.min(Math.max(margin, top), maxTop),
	};
}

function countRecording(rows: HudRow[]): number {
	return rows.reduce((count, row) => count + (row.recording ? 1 : 0), 0);
}

export function createHudStore(): HudStore {
	let state: HudState = {
		rows: [],
		recordingCount: 0,
		position: null,
		closing: false,
	};
	const listeners = new Set<() => void>();
	const timers = new Map<string, RowTimers>();

	function emit(): void {
		for (const listener of listeners) {
			listener();
		}
	}

	function setRows(rows: HudRow[]): void {
		state = { ...state, rows, recordingCount: countRecording(rows) };
		emit();
	}

	function updateRow(
		captureId: string,
		updater: (row: HudRow) => HudRow,
	): void {
		const index = state.rows.findIndex((row) => row.id === captureId);
		if (index === -1) {
			return;
		}
		const rows = state.rows.slice();
		rows[index] = updater(rows[index]);
		setRows(rows);
	}

	function getRowTimers(captureId: string): RowTimers {
		const existing = timers.get(captureId);
		if (existing) {
			return existing;
		}
		const created: RowTimers = {};
		timers.set(captureId, created);
		return created;
	}

	function clearRowTimers(captureId: string): void {
		const rowTimers = timers.get(captureId);
		if (!rowTimers) {
			return;
		}
		if (rowTimers.removeTimer) {
			window.clearTimeout(rowTimers.removeTimer);
		}
		if (rowTimers.highlightTimer) {
			window.clearTimeout(rowTimers.highlightTimer);
		}
		if (rowTimers.noticeTimer) {
			window.clearTimeout(rowTimers.noticeTimer);
		}
		timers.delete(captureId);
	}

	function remove(captureId: string): void {
		if (!state.rows.some((row) => row.id === captureId)) {
			return;
		}
		clearRowTimers(captureId);
		setRows(state.rows.filter((row) => row.id !== captureId));
	}

	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSnapshot() {
			return state;
		},
		add(metadata) {
			remove(metadata.id);
			const row: HudRow = {
				id: metadata.id,
				title: metadata.title,
				width: metadata.width,
				height: metadata.height,
				thumbnailDataUrl: metadata.thumbnailDataUrl,
				elapsedMs: 0,
				partCount: 1,
				recording: true,
				stopping: false,
				highlighted: false,
				highlightNonce: 0,
				detail: { kind: "recording" },
			};
			setRows([row, ...state.rows]);
		},
		update(captureId, elapsedMs) {
			updateRow(captureId, (row) => ({ ...row, elapsedMs }));
		},
		updatePart(captureId, partCount) {
			const rowTimers = timers.get(captureId);
			if (rowTimers?.noticeTimer) {
				window.clearTimeout(rowTimers.noticeTimer);
				rowTimers.noticeTimer = undefined;
			}
			updateRow(captureId, (row) => ({
				...row,
				partCount,
				detail: { kind: "part" },
			}));
		},
		notify(captureId, message) {
			const rowTimers = getRowTimers(captureId);
			if (rowTimers.noticeTimer) {
				window.clearTimeout(rowTimers.noticeTimer);
			}
			updateRow(captureId, (row) => ({
				...row,
				detail: { kind: "notice", message },
			}));
			rowTimers.noticeTimer = window.setTimeout(() => {
				rowTimers.noticeTimer = undefined;
				updateRow(captureId, (row) => ({ ...row, detail: { kind: "part" } }));
			}, NOTICE_DISPLAY_MS);
		},
		markStopping(captureId, elapsedMs) {
			updateRow(captureId, (row) => ({
				...row,
				elapsedMs,
				stopping: true,
				detail: { kind: "finalizing" },
			}));
		},
		finish(captureId, message, tone) {
			updateRow(captureId, (row) => ({
				...row,
				recording: false,
				detail: { kind: "result", message, tone },
			}));
			const rowTimers = getRowTimers(captureId);
			rowTimers.removeTimer = window.setTimeout(() => {
				remove(captureId);
			}, RESULT_DISPLAY_MS);
		},
		remove,
		highlight(captureId) {
			const rowTimers = getRowTimers(captureId);
			if (rowTimers.highlightTimer) {
				window.clearTimeout(rowTimers.highlightTimer);
			}
			updateRow(captureId, (row) => ({
				...row,
				highlighted: true,
				highlightNonce: row.highlightNonce + 1,
			}));
			rowTimers.highlightTimer = window.setTimeout(() => {
				rowTimers.highlightTimer = undefined;
				updateRow(captureId, (row) => ({ ...row, highlighted: false }));
			}, HIGHLIGHT_DISPLAY_MS);
		},
		setPosition(position) {
			state = { ...state, position };
			emit();
		},
		setClosing(closing) {
			if (state.closing === closing) {
				return;
			}
			state = { ...state, closing };
			emit();
		},
		destroy() {
			for (const captureId of Array.from(timers.keys())) {
				clearRowTimers(captureId);
			}
			state = {
				rows: [],
				recordingCount: 0,
				position: null,
				closing: false,
			};
			listeners.clear();
		},
	};
}
