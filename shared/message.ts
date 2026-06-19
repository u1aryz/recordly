import type { ExtensionMessage } from "./types";

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
	if (!value || typeof value !== "object") {
		return false;
	}
	const type = (value as { type?: unknown }).type;
	return (
		type === "START_PICKER" ||
		type === "LIST_VIDEOS" ||
		type === "STOP_CAPTURE" ||
		type === "CAPTURE_STARTED" ||
		type === "CAPTURE_PROGRESS" ||
		type === "CAPTURE_FINISHED" ||
		type === "OPEN_CAPTURES" ||
		type === "DELETE_CAPTURE"
	);
}
