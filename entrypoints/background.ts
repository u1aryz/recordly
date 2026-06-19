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
} from "@/shared/types";

const capturePorts = new Set<Browser.runtime.Port>();
const activeCaptures = new Map<string, CaptureMetadata>();

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
		for (const capture of activeCaptures.values()) {
			if (capture.tabId !== tabId || capture.status !== "recording") {
				continue;
			}
			void finishCapture({
				type: "CAPTURE_FINISHED",
				captureId: capture.id,
				status: "stopped",
				fileStatus: "unknown",
				stopReason: "source_closed",
				elapsedMs: capture.elapsedMs,
			});
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
		if ((message as PortMessage).type !== "CAPTURES_SUBSCRIBE") {
			return;
		}
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
) {
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
) {
	const next: CaptureMetadata = {
		...metadata,
		tabId: sender?.tab?.id ?? metadata.tabId,
		pageUrl: sender?.tab?.url ?? metadata.pageUrl,
		status: "recording",
		fileStatus: "writing",
		storageMode: "direct-file",
		scope: "element",
	};
	activeCaptures.set(next.id, next);
	await putCapture(next);
	await updateCaptureBadge();
	broadcast({ type: "CAPTURE_CREATED", metadata: next });
	await openCapturesPage(next.id, false);
}

async function updateCaptureProgress(message: CaptureProgressMessage) {
	const current =
		activeCaptures.get(message.captureId) ??
		(await findStored(message.captureId));
	if (current?.status !== "recording") {
		return;
	}
	const next: CaptureMetadata = {
		...current,
		sizeBytes: message.sizeBytes,
		elapsedMs: message.elapsedMs,
		chunkCount: message.chunkCount,
	};
	activeCaptures.set(next.id, next);
	await putCapture(next);
	broadcastProgress(next);
}

async function stopStoredCapture(captureId: string) {
	const current =
		activeCaptures.get(captureId) ?? (await findStored(captureId));
	if (current?.status !== "recording") {
		return;
	}
	await browser.tabs
		.sendMessage(current.tabId, {
			type: "STOP_CAPTURE",
			captureId,
		})
		.catch(async () => {
			await finishCapture({
				type: "CAPTURE_FINISHED",
				captureId,
				status: "stopped",
				fileStatus: "unknown",
				stopReason: "source_closed",
				elapsedMs: current.elapsedMs,
			});
		});
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
		fileStatus: message.fileStatus,
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

async function restoreCaptureState() {
	const captures = await listCaptures();
	for (const capture of captures) {
		if (capture.status !== "recording") {
			continue;
		}
		const next: CaptureMetadata = {
			...capture,
			status: "stopped",
			fileStatus: "unknown",
			stopReason: "source_closed",
			errorMessage:
				"拡張機能の再起動により、MP4の保存完了を確認できませんでした。",
			endedAt: Date.now(),
		};
		await putCapture(next);
	}
	await updateCaptureBadge();
}

async function updateCaptureBadge() {
	const count = Array.from(activeCaptures.values()).filter(
		(capture) => capture.status === "recording",
	).length;
	await browser.action.setBadgeBackgroundColor({ color: "#dc2626" });
	await browser.action.setBadgeText({ text: count > 0 ? String(count) : "" });
}

async function findStored(id: string) {
	return getCapture(id);
}

function broadcastProgress(capture: CaptureMetadata) {
	broadcast({
		type: "CAPTURE_PROGRESS",
		progress: {
			id: capture.id,
			status: capture.status,
			sizeBytes: capture.sizeBytes,
			elapsedMs: capture.elapsedMs,
			chunkCount: capture.chunkCount,
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

async function openCapturesPage(captureId?: string, active = true) {
	const url = browser.runtime.getURL(
		`/captures.html${captureId ? `?captureId=${encodeURIComponent(captureId)}` : ""}`,
	);
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
