import { describe, expect, it } from "vitest";
import { createCaptureMetadata } from "@/shared/capture-state";
import {
	appendCaptureChunk,
	appendCaptureChunkWithMetadata,
	createCaptureReadableStream,
	deleteCapture,
	getCaptureBlob,
	listCaptures,
	putCapture,
} from "@/shared/storage";

describe("capture storage", () => {
	it("persists metadata and chunked blobs", async () => {
		const metadata = createCaptureMetadata({
			videoId: "video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Stored",
			mimeType: "video/mp4",
			width: 320,
			height: 180,
		});
		await putCapture(metadata);
		await appendCaptureChunk({
			captureId: metadata.id,
			index: 0,
			chunk: new Uint8Array([1, 2]).buffer,
			size: 2,
		});
		await appendCaptureChunk({
			captureId: metadata.id,
			index: 1,
			chunk: new Uint8Array([3]).buffer,
			size: 1,
		});
		const captures = await listCaptures();
		expect(captures.some((capture) => capture.id === metadata.id)).toBe(true);
		const blob = await getCaptureBlob(metadata);
		expect(blob.size).toBe(3);
		expect(blob.type).toBe("video/mp4");

		const streamed = await readStreamBytes(
			createCaptureReadableStream({ ...metadata, chunkCount: 2 }),
		);
		expect(streamed).toEqual([1, 2, 3]);
	});

	it("deletes metadata and chunks together", async () => {
		const metadata = createCaptureMetadata({
			videoId: "delete-video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Delete me",
			mimeType: "video/mp4",
			width: 320,
			height: 180,
		});
		await putCapture(metadata);
		await appendCaptureChunk({
			captureId: metadata.id,
			index: 0,
			chunk: new Uint8Array([9, 8, 7]).buffer,
			size: 3,
		});
		await deleteCapture(metadata.id);
		const captures = await listCaptures();
		expect(captures.some((capture) => capture.id === metadata.id)).toBe(false);
		const blob = await getCaptureBlob(metadata);
		expect(blob.size).toBe(0);
	});

	it("persists metadata and chunk in one transaction", async () => {
		const metadata = createCaptureMetadata({
			videoId: "batched-video-id",
			tabId: 1,
			pageUrl: "https://example.test",
			title: "Batched",
			mimeType: "video/mp4",
			width: 320,
			height: 180,
		});
		const next = {
			...metadata,
			sizeBytes: 2,
			elapsedMs: 3000,
			chunkCount: 1,
		};
		await appendCaptureChunkWithMetadata({
			metadata: next,
			index: 0,
			chunk: new Uint8Array([4, 5]).buffer,
			size: 2,
		});

		const captures = await listCaptures();
		expect(captures.find((capture) => capture.id === next.id)).toMatchObject({
			sizeBytes: 2,
			elapsedMs: 3000,
			chunkCount: 1,
		});
		const streamed = await readStreamBytes(createCaptureReadableStream(next));
		expect(streamed).toEqual([4, 5]);
	});
});

async function readStreamBytes(stream: ReadableStream<Uint8Array>) {
	const reader = stream.getReader();
	const bytes: number[] = [];

	while (true) {
		const result = await reader.read();
		if (result.done) {
			break;
		}
		bytes.push(...result.value);
	}

	return bytes;
}
