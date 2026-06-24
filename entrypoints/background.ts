import { isExtensionMessage } from "@/shared/message";
import {
	deleteCapture,
	getCapture,
	listCaptures,
	putCapture,
} from "@/shared/storage";
import type {
	CaptureFinishedMessage,
	CaptureMetadata,
	CaptureProgressMessage,
	CaptureStreamPortMessage,
	ExtensionMessage,
	PortMessage,
	StopReason,
} from "@/shared/types";

const capturePorts = new Set<Browser.runtime.Port>();
const activeCaptures = new Map<string, CaptureMetadata>();
const captureStreamQueues = new Map<Browser.runtime.Port, Promise<void>>();
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

	browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
		if (changeInfo.status !== "loading") {
			return;
		}
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
	port.onMessage.addListener((message) => {
		if (!isCaptureStreamPortMessage(message)) {
			return;
		}
		if (message.type === "CAPTURE_STARTED") {
			captureStreamIds.set(port, message.metadata.id);
		}
		const previous = captureStreamQueues.get(port) ?? Promise.resolve();
		const next = previous
			.then(() => handleCaptureStreamMessage(message, port.sender))
			.catch(() => undefined);
		captureStreamQueues.set(port, next);
	});
	port.onDisconnect.addListener(() => {
		const captureId = captureStreamIds.get(port);
		const previous = captureStreamQueues.get(port) ?? Promise.resolve();
		captureStreamIds.delete(port);
		captureStreamQueues.delete(port);
		if (!captureId) {
			return;
		}
		void previous.then(() => finishDisconnectedCapture(captureId));
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
	const next: CaptureMetadata = {
		...metadata,
		tabId: sender?.tab?.id ?? metadata.tabId,
		pageUrl: sender?.tab?.url ?? metadata.pageUrl,
		status: "recording",
		fileStatus: "writing",
		storageMode: metadata.storageMode ?? "direct-file",
		scope: "element",
	};
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
	const next: CaptureMetadata = {
		...current,
		sizeBytes: message.sizeBytes,
		elapsedMs: message.elapsedMs,
		chunkCount: message.chunkCount,
		...getPartProgress(current, message),
	};
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
	const next: CaptureMetadata = {
		...current,
		status: message.status,
		fileStatus: message.fileStatus,
		stopReason: message.stopReason,
		errorMessage: message.errorMessage,
		elapsedMs: message.elapsedMs,
		sizeBytes: message.sizeBytes ?? current.sizeBytes,
		chunkCount: message.chunkCount ?? current.chunkCount,
		...getPartProgress(current, message),
		endedAt: Date.now(),
	};
	activeCaptures.delete(next.id);
	await putCapture(next);
	await updateCaptureBadge();
	broadcast({ type: "CAPTURE_UPDATED", metadata: next });
}

function getPartProgress(
	current: CaptureMetadata,
	message: {
		partCount?: number;
		savedPartCount?: number;
		currentPartSizeBytes?: number;
	},
): Pick<
	CaptureMetadata,
	"partCount" | "savedPartCount" | "currentPartSizeBytes"
> {
	return {
		partCount: message.partCount ?? current.partCount,
		savedPartCount: message.savedPartCount ?? current.savedPartCount,
		currentPartSizeBytes:
			message.currentPartSizeBytes ?? current.currentPartSizeBytes,
	};
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
		if (capture.status !== "recording") {
			continue;
		}
		const next: CaptureMetadata = {
			...capture,
			status: "stopped",
			fileStatus: (capture.savedPartCount ?? 0) > 0 ? "saved" : "unknown",
			stopReason: "source_closed",
			errorMessage:
				"拡張機能の再起動により、MP4の保存完了を確認できませんでした。",
			endedAt: Date.now(),
		};
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
		progress: {
			id: capture.id,
			status: capture.status,
			sizeBytes: capture.sizeBytes,
			elapsedMs: capture.elapsedMs,
			chunkCount: capture.chunkCount,
			partCount: capture.partCount,
			savedPartCount: capture.savedPartCount,
			currentPartSizeBytes: capture.currentPartSizeBytes,
			thumbnailDataUrl: capture.thumbnailDataUrl,
		},
	});
}

function isCaptureStreamPortMessage(
	value: unknown,
): value is CaptureStreamPortMessage {
	if (!value || typeof value !== "object") {
		return false;
	}
	const type = (value as { type?: unknown }).type;
	return (
		type === "CAPTURE_STARTED" ||
		type === "CAPTURE_PROGRESS" ||
		type === "CAPTURE_FINISHED"
	);
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
