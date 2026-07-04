export type DirectoryPickerOptions = {
	id?: string;
	mode?: "read" | "readwrite";
	startIn?: string;
};

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
