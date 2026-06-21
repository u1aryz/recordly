import { t } from "../utils/i18n";
import type { CaptureMetadata } from "./types";
import { formatDuration } from "./video";

type HudTone = "success" | "warning" | "error";

type RecordingHudManagerOptions = {
	onOpen: (captureId: string) => void;
	onStop: (captureId: string) => void;
};

type RecordingHudRow = {
	element: HTMLElement;
	time: HTMLElement;
	detail: HTMLElement;
	actions: HTMLElement;
	stopButton: HTMLButtonElement;
	removeTimer?: number;
	highlightTimer?: number;
	recording: boolean;
};

export type RecordingHudManager = {
	add: (metadata: CaptureMetadata) => void;
	update: (captureId: string, elapsedMs: number) => void;
	markStopping: (captureId: string, elapsedMs: number) => void;
	finish: (captureId: string, message: string, tone: HudTone) => void;
	remove: (captureId: string) => void;
	highlight: (captureId: string) => void;
	destroy: () => void;
};

const RESULT_DISPLAY_MS = 8000;
const HIGHLIGHT_DISPLAY_MS = 1600;

export function createRecordingHudManager(
	options: RecordingHudManagerOptions,
): RecordingHudManager {
	const host = document.createElement("div");
	host.dataset.recordlyRecordingHud = "";
	host.style.position = "fixed";
	host.style.right = "16px";
	host.style.bottom = "16px";
	host.style.zIndex = "2147483647";
	const shadow = host.attachShadow({ mode: "open" });
	shadow.innerHTML = `
		<style>
			:host { all: initial; }
			.panel {
				box-sizing: border-box;
				width: min(390px, calc(100vw - 32px));
				overflow: hidden;
				border: 1px solid rgba(255, 255, 255, 0.14);
				border-radius: 12px;
				background: #172033;
				color: #f8fbff;
				font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
				pointer-events: auto;
			}
			.header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 12px;
				padding: 10px 12px;
				border-bottom: 1px solid rgba(255, 255, 255, 0.1);
			}
			.heading { font-weight: 750; }
			.dot { color: #ff6262; }
			.summary { color: #9fb0c7; font-size: 12px; }
			.list {
				max-height: 50vh;
				overflow-y: auto;
				overscroll-behavior: contain;
			}
			.item {
				display: grid;
				grid-template-columns: 64px minmax(0, 1fr);
				gap: 10px;
				padding: 12px;
				border-bottom: 1px solid rgba(255, 255, 255, 0.09);
				transition: background-color 160ms ease, box-shadow 160ms ease;
			}
			.item:last-child { border-bottom: 0; }
			.item.highlight {
				background: rgba(255, 204, 128, 0.13);
				box-shadow: inset 3px 0 #ffcc80;
			}
			.item.success { box-shadow: inset 3px 0 #55c98f; }
			.item.warning { box-shadow: inset 3px 0 #ffcc80; }
			.item.error { box-shadow: inset 3px 0 #ff7575; }
			.thumb {
				width: 64px;
				height: 40px;
				overflow: hidden;
				border-radius: 5px;
				background: #0d1422;
			}
			.thumb img { width: 100%; height: 100%; object-fit: cover; }
			.placeholder {
				display: flex;
				width: 100%;
				height: 100%;
				align-items: center;
				justify-content: center;
				color: #72839b;
				font-size: 10px;
			}
			.content { min-width: 0; }
			.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
			.title { overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
			.time { flex: none; color: #dbe7f5; font-variant-numeric: tabular-nums; }
			.meta { margin: 2px 0 0; color: #9fb0c7; font-size: 11px; }
			.detail { margin: 4px 0 0; color: #cbd7e7; font-size: 12px; }
			.actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 8px; }
			button {
				border: 0;
				border-radius: 5px;
				padding: 5px 8px;
				font: inherit;
				font-size: 12px;
				font-weight: 700;
				cursor: pointer;
			}
			button:focus-visible { outline: 2px solid #9fd0ff; outline-offset: 2px; }
			button:disabled { cursor: wait; opacity: 0.65; }
			.open { background: #d9e8fb; color: #172033; }
			.stop { background: #ffcc80; color: #2b1b00; }
			@media (prefers-reduced-motion: reduce) {
				.item { transition: none; }
			}
		</style>
		<section class="panel" aria-label="${t("recordingStatus")}">
			<header class="header">
				<span class="heading"><span class="dot">●</span> ${t("recordingStatus")}</span>
				<span class="summary"></span>
			</header>
			<div class="list"></div>
		</section>
	`;
	const list = shadow.querySelector<HTMLElement>(".list");
	const summary = shadow.querySelector<HTMLElement>(".summary");
	const rows = new Map<string, RecordingHudRow>();

	function mount(): void {
		if (!host.isConnected) {
			document.documentElement.append(host);
		}
	}

	function updateSummary(): void {
		let recordingCount = 0;
		for (const row of rows.values()) {
			if (row.recording) {
				recordingCount += 1;
			}
		}
		if (summary) {
			summary.textContent = t("recordingCount", String(recordingCount));
		}
	}

	function clearRowTimers(row: RecordingHudRow): void {
		if (row.removeTimer) {
			window.clearTimeout(row.removeTimer);
		}
		if (row.highlightTimer) {
			window.clearTimeout(row.highlightTimer);
		}
	}

	function remove(captureId: string): void {
		const row = rows.get(captureId);
		if (!row) {
			return;
		}
		clearRowTimers(row);
		row.element.remove();
		rows.delete(captureId);
		updateSummary();
		if (rows.size === 0) {
			host.remove();
		}
	}

	function createRow(metadata: CaptureMetadata): RecordingHudRow | undefined {
		const element = document.createElement("article");
		element.className = "item";
		element.dataset.captureId = metadata.id;
		element.innerHTML = `
			<div class="thumb"></div>
			<div class="content">
				<div class="row">
					<span class="title"></span>
					<span class="time">0:00</span>
				</div>
				<p class="meta"></p>
				<p class="detail">${t("recordingToDestination")}</p>
				<div class="actions">
					<button class="open" type="button">${t("openStatus")}</button>
					<button class="stop" type="button">${t("stopAndSave")}</button>
				</div>
			</div>
		`;
		const thumb = element.querySelector<HTMLElement>(".thumb");
		const title = element.querySelector<HTMLElement>(".title");
		const meta = element.querySelector<HTMLElement>(".meta");
		const detail = element.querySelector<HTMLElement>(".detail");
		const time = element.querySelector<HTMLElement>(".time");
		const actions = element.querySelector<HTMLElement>(".actions");
		const openButton = element.querySelector<HTMLButtonElement>(".open");
		const stopButton = element.querySelector<HTMLButtonElement>(".stop");
		if (
			!thumb ||
			!title ||
			!meta ||
			!detail ||
			!time ||
			!actions ||
			!openButton ||
			!stopButton
		) {
			return undefined;
		}
		title.textContent = metadata.title;
		meta.textContent = `${metadata.width} × ${metadata.height}`;
		if (metadata.thumbnailDataUrl) {
			const image = document.createElement("img");
			image.alt = "";
			image.src = metadata.thumbnailDataUrl;
			thumb.append(image);
		} else {
			const placeholder = document.createElement("span");
			placeholder.className = "placeholder";
			placeholder.textContent = "video";
			thumb.append(placeholder);
		}
		openButton.addEventListener("click", () => options.onOpen(metadata.id));
		stopButton.addEventListener("click", () => options.onStop(metadata.id));
		return {
			element,
			time,
			detail,
			actions,
			stopButton,
			recording: true,
		};
	}

	return {
		add(metadata) {
			remove(metadata.id);
			const row = createRow(metadata);
			if (!row || !list) {
				return;
			}
			rows.set(metadata.id, row);
			list.prepend(row.element);
			mount();
			updateSummary();
		},
		update(captureId, elapsedMs) {
			const row = rows.get(captureId);
			if (row) {
				row.time.textContent = formatDuration(elapsedMs);
			}
		},
		markStopping(captureId, elapsedMs) {
			const row = rows.get(captureId);
			if (!row) {
				return;
			}
			row.time.textContent = formatDuration(elapsedMs);
			row.detail.textContent = t("finalizingMp4");
			row.stopButton.disabled = true;
		},
		finish(captureId, message, tone) {
			const row = rows.get(captureId);
			if (!row) {
				return;
			}
			row.recording = false;
			row.element.classList.add(tone);
			row.detail.textContent = message;
			row.time.textContent = "";
			row.actions.remove();
			updateSummary();
			row.removeTimer = window.setTimeout(
				() => remove(captureId),
				RESULT_DISPLAY_MS,
			);
		},
		remove,
		highlight(captureId) {
			const row = rows.get(captureId);
			if (!row) {
				return;
			}
			if (row.highlightTimer) {
				window.clearTimeout(row.highlightTimer);
			}
			row.element.classList.add("highlight");
			row.element.scrollIntoView?.({ block: "nearest" });
			row.highlightTimer = window.setTimeout(() => {
				row.element.classList.remove("highlight");
				row.highlightTimer = undefined;
			}, HIGHLIGHT_DISPLAY_MS);
		},
		destroy() {
			for (const captureId of Array.from(rows.keys())) {
				remove(captureId);
			}
			host.remove();
		},
	};
}
