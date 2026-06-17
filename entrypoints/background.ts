import { base64ToArrayBuffer } from "@/shared/binary";
import { isExtensionMessage } from "@/shared/message";
import {
	appendCaptureChunkWithMetadata,
	deleteCapture,
	listCaptures,
	putCapture,
} from "@/shared/storage";
import type {
	CaptureChunkMessage,
	CaptureFinishedMessage,
	CaptureMetadata,
	CaptureStreamPortMessage,
	ExtensionMessage,
	PortMessage,
} from "@/shared/types";

const capturePorts = new Set<Browser.runtime.Port>();
const activeCaptures = new Map<string, CaptureMetadata>();

export default defineBackground(() => {
	void updateCaptureBadge();

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
		for (const capture of activeCaptures.values()) {
			if (capture.tabId === tabId && capture.status === "recording") {
				const finished: CaptureFinishedMessage = {
					type: "CAPTURE_FINISHED",
					captureId: capture.id,
					status: "stopped",
					stopReason: "source_closed",
					elapsedMs: capture.elapsedMs,
				};
				void finishCapture(finished);
			}
		}
	});
});

function connectCapturesPage(port: Browser.runtime.Port): void {
	let connected = true;
	capturePorts.add(port);
	port.onDisconnect.addListener(() => {
		connected = false;
		capturePorts.delete(port);
	});
	port.onMessage.addListener((message) => {
		if ((message as PortMessage).type === "CAPTURES_SUBSCRIBE") {
			void listCaptures()
				.then((captures) => {
					if (!connected) {
						return;
					}
					for (const capture of captures) {
						postToPort(port, {
							type: "CAPTURE_UPDATED",
							metadata: capture,
						});
					}
				})
				.catch(() => undefined);
		}
	});
}

function connectCaptureStream(port: Browser.runtime.Port): void {
	port.onMessage.addListener((message) => {
		if (!isCaptureStreamPortMessage(message)) {
			return;
		}
		void handleCaptureStreamMessage(message, port.sender);
	});
}

async function handleMessage(
	message: ExtensionMessage,
	sender: Browser.runtime.MessageSender,
) {
	switch (message.type) {
		case "OPEN_CAPTURES":
			await openCapturesPage(message.captureId);
			return { ok: true };
		case "CAPTURE_STARTED":
			await startCapture(message.metadata, sender);
			return { ok: true };
		case "CAPTURE_CHUNK":
			return { ok: false };
		case "CAPTURE_FINISHED":
			await finishCapture(message);
			return { ok: true };
		case "DELETE_CAPTURE":
			activeCaptures.delete(message.captureId);
			await deleteCapture(message.captureId);
			await updateCaptureBadge();
			broadcast({ type: "CAPTURE_DELETED", captureId: message.captureId });
			return { ok: true };
		case "START_CAPTURE":
		case "START_PICKER":
		case "LIST_VIDEOS":
		case "STOP_CAPTURE":
			if (sender.tab?.id != null) {
				return { ok: true };
			}
			return { ok: false };
	}
}

async function handleCaptureStreamMessage(
	message: CaptureStreamPortMessage,
	sender?: Browser.runtime.MessageSender,
) {
	switch (message.type) {
		case "CAPTURE_STARTED":
			await startCapture(message.metadata, sender);
			return;
		case "CAPTURE_CHUNK":
			await appendCaptureChunkMessage(message);
			return;
		case "CAPTURE_FINISHED":
			await finishCapture(message);
			return;
	}
}

async function startCapture(
	metadata: CaptureMetadata,
	sender?: Browser.runtime.MessageSender,
) {
	const next = {
		...metadata,
		tabId: sender?.tab?.id ?? metadata.tabId,
		pageUrl: sender?.tab?.url ?? metadata.pageUrl,
	};
	activeCaptures.set(next.id, next);
	await putCapture(next);
	await updateCaptureBadge();
	broadcast({ type: "CAPTURE_CREATED", metadata: next });
	await openCapturesPage(next.id);
}

async function appendCaptureChunkMessage(message: CaptureChunkMessage) {
	const current = activeCaptures.get(message.captureId);
	if (!current) {
		return;
	}
	const next: CaptureMetadata = {
		...current,
		sizeBytes: current.sizeBytes + message.size,
		elapsedMs: message.elapsedMs,
		chunkCount: current.chunkCount + 1,
	};
	activeCaptures.set(next.id, next);
	await appendCaptureChunkWithMetadata({
		metadata: next,
		index: next.chunkCount - 1,
		chunk: base64ToArrayBuffer(message.chunkBase64),
		size: message.size,
	});
	broadcast({
		type: "CAPTURE_PROGRESS",
		progress: {
			id: next.id,
			status: next.status,
			sizeBytes: next.sizeBytes,
			elapsedMs: next.elapsedMs,
			chunkCount: next.chunkCount,
			thumbnailDataUrl: next.thumbnailDataUrl,
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
		type === "CAPTURE_CHUNK" ||
		type === "CAPTURE_FINISHED"
	);
}

async function finishCapture(message: CaptureFinishedMessage) {
	const current =
		activeCaptures.get(message.captureId) ??
		(await findStored(message.captureId));
	if (!current) {
		return;
	}
	const next: CaptureMetadata = {
		...current,
		status: message.status,
		stopReason: message.stopReason,
		errorMessage: message.errorMessage,
		elapsedMs: message.elapsedMs,
		endedAt: Date.now(),
	};
	activeCaptures.delete(next.id);
	await putCapture(next);
	await updateCaptureBadge();
	broadcast({ type: "CAPTURE_UPDATED", metadata: next });
}

async function updateCaptureBadge() {
	const count = Array.from(activeCaptures.values()).filter(
		(capture) => capture.status === "recording",
	).length;
	await browser.action.setBadgeBackgroundColor({ color: "#dc2626" });
	await browser.action.setBadgeText({ text: count > 0 ? String(count) : "" });
}

async function findStored(id: string) {
	const captures = await listCaptures();
	return captures.find((capture) => capture.id === id);
}

function broadcast(message: PortMessage) {
	for (const port of capturePorts) {
		postToPort(port, message);
	}
}

function postToPort(port: Browser.runtime.Port, message: PortMessage) {
	try {
		port.postMessage(message);
	} catch {
		capturePorts.delete(port);
	}
}

async function openCapturesPage(captureId?: string) {
	const url = browser.runtime.getURL(
		`/captures.html${captureId ? `?captureId=${encodeURIComponent(captureId)}` : ""}`,
	);
	const tabs = await browser.tabs.query({
		url: browser.runtime.getURL("/captures.html*"),
	});
	const existing = tabs[0];
	if (existing?.id != null) {
		await browser.tabs.update(existing.id, { active: true, url });
		return;
	}
	await browser.tabs.create({ url, active: true });
}
