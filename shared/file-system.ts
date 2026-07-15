export type DirectoryPickerOptions = {
	id?: string;
	mode?: "read" | "readwrite";
	startIn?: string;
};

// Chromium's MediaRecorder MP4 muxer crashes the capture tab once a single
// recorder session emits about 4 GiB (a 32-bit limit), so parts roll over to
// a fresh MediaRecorder well before that. Closed parts also survive a tab
// crash, while an unclosed part is discarded with its swap file. Do not
// remove this split; if raising the threshold, keep a safe margin below 4 GiB.
export const PART_SPLIT_BYTES = 2 * 1024 ** 3;

export function createPartFileName(
	fileName: string,
	captureId: string,
	partIndex: number,
): string {
	const baseName = fileName.replace(/\.mp4$/i, "");
	const suffix = partIndex.toString().padStart(3, "0");
	return `${baseName}-${captureId.slice(0, 8)}-part-${suffix}.mp4`;
}

export function shouldSplitPart(sizeBytes: number): boolean {
	return sizeBytes >= PART_SPLIT_BYTES;
}

export function isFilePickerAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

declare global {
	interface Window {
		showDirectoryPicker?: (
			options?: DirectoryPickerOptions,
		) => Promise<FileSystemDirectoryHandle>;
	}
}
