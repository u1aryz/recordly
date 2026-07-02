import {
	applyProgress,
	finishCapture as finishCaptureMetadata,
	normalizeStartedCapture,
	restoreInterruptedCapture,
	toCaptureProgress,
} from "@/shared/capture-state";
import {
	isCaptureStreamPortMessage,
	isExtensionMessage,
} from "@/shared/message";
import {
	deleteCapture,
	getCapture,
	listCaptures,
	putCapture,
} from "@/shared/storage";
import { createSerialTaskQueue } from "@/shared/task-queue";
import type {
	CaptureFinishedMessage,
	CaptureMetadata,
	CaptureProgressMessage,
	CaptureStreamPortMessage,
	ExtensionMessage,
	PortMessage,
	StopReason,
} from "@/shared/types";
import { t } from "@/utils/i18n";

const capturePorts = new Set<Browser.runtime.Port>();
const activeCaptures = new Map<string, CaptureMetadata>();
const captureStreamIds = new Map<Browser.runtime.Port, string>();

export default defineBackground(() => {
	void restoreCaptureState();

	browser.runtime.onConnect.addListener((port) => {
		if (port.name === "captures") {
			connectCapturesPage(port);
			return;
		}
		if (port.name === "capture-stream") {
			connectCaptureStream(port);
		}
	});

	browser.runtime.onMessage.addListener((message: unknown, sender) => {
		if (!isExtensionMessage(message)) {
			return undefined;
		}
		return handleMessage(message, sender);
	});

	browser.tabs.onRemoved.addListener((tabId) => {
		finishCapturesForTab(tabId, "source_closed");
	});
});

function connectCapturesPage(port: Browser.runtime.Port): void {
	capturePorts.add(port);
	port.onDisconnect.addListener(() => {
		capturePorts.delete(port);
	});
	port.onMessage.addListener((message: PortMessage) => {
		if (message.type !== "CAPTURES_SUBSCRIBE") {
			return;
		}
		void sendStoredCaptures(port);
	});
}

async function sendStoredCaptures(port: Browser.runtime.Port): Promise<void> {
	try {
		const captures = await listCaptures();
		if (!capturePorts.has(port)) {
			return;
		}
		for (const capture of captures) {
			postToPort(port, {
				type: "CAPTURE_UPDATED",
				metadata: capture,
			});
		}
	} catch {
		return;
	}
}

function connectCaptureStream(port: Browser.runtime.Port): void {
	const queue = createSerialTaskQueue();
	port.onMessage.addListener((message) => {
		if (!isCaptureStreamPortMessage(message)) {
			return;
		}
		if (message.type === "CAPTURE_STARTED") {
			captureStreamIds.set(port, message.metadata.id);
		}
		queue.enqueue(() => handleCaptureStreamMessage(message, port.sender));
	});
	port.onDisconnect.addListener(() => {
		const captureId = captureStreamIds.get(port);
		captureStreamIds.delete(port);
		if (!captureId) {
			return;
		}
		void queue.settled().then(() => finishDisconnectedCapture(captureId));
	});
}

async function handleMessage(
	message: ExtensionMessage,
	sender: Browser.runtime.MessageSender,
): Promise<{ ok: boolean }> {
	switch (message.type) {
		case "OPEN_CAPTURES":
			await openCapturesPage(message.captureId, true);
			return { ok: true };
		case "CAPTURE_STARTED":
			await startCapture(message.metadata, sender);
			return { ok: true };
		case "CAPTURE_PROGRESS":
			await updateCaptureProgress(message);
			return { ok: true };
		case "CAPTURE_FINISHED":
			await finishCapture(message);
			return { ok: true };
		case "DELETE_CAPTURE":
			activeCaptures.delete(message.captureId);
			await deleteCapture(message.captureId);
			await updateCaptureBadge();
			broadcast({ type: "CAPTURE_DELETED", captureId: message.captureId });
			return { ok: true };
		case "STOP_CAPTURE":
			await stopStoredCapture(message.captureId);
			return { ok: true };
		case "START_PICKER":
		case "LIST_VIDEOS":
			return { ok: sender.tab?.id != null };
	}
}

async function handleCaptureStreamMessage(
	message: CaptureStreamPortMessage,
	sender?: Browser.runtime.MessageSender,
): Promise<void> {
	switch (message.type) {
		case "CAPTURE_STARTED":
			await startCapture(message.metadata, sender);
			return;
		case "CAPTURE_PROGRESS":
			await updateCaptureProgress(message);
			return;
		case "CAPTURE_FINISHED":
			await finishCapture(message);
			return;
	}
}

async function startCapture(
	metadata: CaptureMetadata,
	sender?: Browser.runtime.MessageSender,
): Promise<void> {
	const next = normalizeStartedCapture(metadata, {
		tabId: sender?.tab?.id,
		url: sender?.tab?.url,
	});
	activeCaptures.set(next.id, next);
	await putCapture(next);
	await updateCaptureBadge();
	broadcast({ type: "CAPTURE_CREATED", metadata: next });
	await openCapturesPage(next.id, false);
}

async function updateCaptureProgress(
	message: CaptureProgressMessage,
): Promise<void> {
	const current = await getCurrentCapture(message.captureId);
	if (current?.status !== "recording") {
		return;
	}
	const next = applyProgress(current, message);
	activeCaptures.set(next.id, next);
	await putCapture(next);
	broadcastProgress(next);
}

async function stopStoredCapture(captureId: string): Promise<void> {
	const current = await getCurrentCapture(captureId);
	if (current?.status !== "recording") {
		return;
	}
	try {
		await browser.tabs.sendMessage(current.tabId, {
			type: "STOP_CAPTURE",
			captureId,
		});
	} catch {
		await finishCapture({
			type: "CAPTURE_FINISHED",
			captureId,
			status: "stopped",
			fileStatus: "unknown",
			stopReason: "source_closed",
			elapsedMs: current.elapsedMs,
		});
	}
}

async function finishCapture(message: CaptureFinishedMessage): Promise<void> {
	const current = await getCurrentCapture(message.captureId);
	if (!current) {
		return;
	}
	const next = finishCaptureMetadata(current, message);
	activeCaptures.delete(next.id);
	await putCapture(next);
	await updateCaptureBadge();
	broadcast({ type: "CAPTURE_UPDATED", metadata: next });
}

async function finishDisconnectedCapture(captureId: string): Promise<void> {
	const current = await getCurrentCapture(captureId);
	if (current?.status !== "recording") {
		return;
	}
	const hasSavedParts = (current.savedPartCount ?? 0) > 0;
	await finishCapture({
		type: "CAPTURE_FINISHED",
		captureId,
		status: "stopped",
		fileStatus: hasSavedParts ? "saved" : "unknown",
		stopReason: "source_closed",
		elapsedMs: current.elapsedMs,
		sizeBytes: current.sizeBytes,
		chunkCount: current.chunkCount,
		partCount: current.partCount ?? 1,
		savedPartCount: current.savedPartCount ?? 0,
		currentPartSizeBytes: current.currentPartSizeBytes ?? 0,
	});
}

function finishCapturesForTab(tabId: number, stopReason: StopReason): void {
	for (const capture of activeCaptures.values()) {
		if (capture.tabId !== tabId || capture.status !== "recording") {
			continue;
		}
		void finishCapture({
			type: "CAPTURE_FINISHED",
			captureId: capture.id,
			status: "stopped",
			fileStatus: "unknown",
			stopReason,
			elapsedMs: capture.elapsedMs,
		});
	}
}

async function restoreCaptureState(): Promise<void> {
	const captures = await listCaptures();
	for (const capture of captures) {
		const next = restoreInterruptedCapture(
			capture,
			t("restoreSaveStatusUnknown"),
		);
		if (!next) {
			continue;
		}
		await putCapture(next);
	}
	await updateCaptureBadge();
}

async function updateCaptureBadge(): Promise<void> {
	const count = activeCaptures.size;
	await browser.action.setBadgeBackgroundColor({ color: "#21a47c" });
	await browser.action.setBadgeText({ text: count > 0 ? String(count) : "" });
}

async function getCurrentCapture(
	id: string,
): Promise<CaptureMetadata | undefined> {
	return activeCaptures.get(id) ?? getCapture(id);
}

function broadcastProgress(capture: CaptureMetadata): void {
	broadcast({
		type: "CAPTURE_PROGRESS",
		progress: toCaptureProgress(capture),
	});
}

function broadcast(message: PortMessage): void {
	for (const port of capturePorts) {
		postToPort(port, message);
	}
}

function postToPort(port: Browser.runtime.Port, message: PortMessage): void {
	try {
		port.postMessage(message);
	} catch {
		capturePorts.delete(port);
	}
}

async function openCapturesPage(
	captureId?: string,
	active = true,
): Promise<void> {
	const query = captureId ? `?captureId=${encodeURIComponent(captureId)}` : "";
	const url = browser.runtime.getURL(`/captures.html${query}`);
	const tabs = await browser.tabs.query({
		url: browser.runtime.getURL("/captures.html*"),
	});
	const existing = tabs[0];
	if (existing?.id != null) {
		await browser.tabs.update(existing.id, { active, url });
		return;
	}
	await browser.tabs.create({ url, active });
}
