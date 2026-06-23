import { t } from "../utils/i18n";
import { INJECTED_UI_THEME_CSS } from "./injected-ui-theme";
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
			${INJECTED_UI_THEME_CSS}
			.panel {
				width: min(390px, calc(100vw - 32px));
				overflow: hidden;
				border: 1px solid var(--base-300);
				border-radius: 8px;
				background: var(--base-100);
				color: var(--base-content);
				font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				box-shadow: 0 18px 48px color-mix(in oklch, black 42%, transparent);
				pointer-events: auto;
			}
			.header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 12px;
				padding: 10px 12px;
				border-bottom: 1px solid var(--base-300);
				background: var(--base-200);
			}
			.heading { font-weight: 750; }
			.dot { color: var(--error); }
			.summary {
				color: color-mix(in oklch, var(--base-content) 62%, transparent);
				font-size: 12px;
			}
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
				border-bottom: 1px solid var(--base-300);
				transition: background-color 160ms ease, box-shadow 160ms ease;
			}
			.item:last-child { border-bottom: 0; }
			.item.highlight {
				background: color-mix(in oklch, var(--warning) 12%, transparent);
				box-shadow: inset 3px 0 var(--warning);
			}
			.item.success { box-shadow: inset 3px 0 var(--success); }
			.item.warning { box-shadow: inset 3px 0 var(--warning); }
			.item.error { box-shadow: inset 3px 0 var(--error); }
			.thumb {
				width: 64px;
				height: 40px;
				overflow: hidden;
				border: 1px solid var(--base-300);
				border-radius: 4px;
				background: var(--base-200);
			}
			.thumb img { width: 100%; height: 100%; object-fit: cover; }
			.placeholder {
				display: flex;
				width: 100%;
				height: 100%;
				align-items: center;
				justify-content: center;
				color: color-mix(in oklch, var(--base-content) 45%, transparent);
				font-size: 10px;
			}
			.content { min-width: 0; }
			.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
			.title { overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
			.time { flex: none; color: var(--primary); font-variant-numeric: tabular-nums; }
			.meta {
				margin: 2px 0 0;
				color: color-mix(in oklch, var(--base-content) 58%, transparent);
				font-size: 11px;
			}
			.detail {
				margin: 4px 0 0;
				color: color-mix(in oklch, var(--base-content) 75%, transparent);
				font-size: 12px;
			}
			.actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 8px; }
			button {
				min-height: 30px;
				border: 1px solid transparent;
				border-radius: 8px;
				padding: 5px 10px;
				font: inherit;
				font-size: 12px;
				font-weight: 700;
				cursor: pointer;
			}
			button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
			button:disabled { cursor: wait; opacity: 0.65; }
			.open { background: var(--primary); color: var(--primary-content); }
			.open:hover { background: color-mix(in oklch, var(--primary) 88%, white); }
			.stop { background: var(--warning); color: var(--warning-content); }
			.stop:hover:not(:disabled) {
				background: color-mix(in oklch, var(--warning) 88%, white);
			}
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
