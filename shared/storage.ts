import type { CaptureMetadata } from "./types";

const DB_NAME = "video-capture-picker";
const DB_VERSION = 1;
const CAPTURES_STORE = "captures";
const CHUNKS_STORE = "chunks";

type StoredChunk = {
	id: string;
	captureId: string;
	index: number;
	chunk: ArrayBuffer;
	size: number;
};

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}

export function openCaptureDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(CAPTURES_STORE)) {
				db.createObjectStore(CAPTURES_STORE, { keyPath: "id" });
			}
			if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
				const chunks = db.createObjectStore(CHUNKS_STORE, { keyPath: "id" });
				chunks.createIndex("captureId", "captureId", { unique: false });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export async function putCapture(metadata: CaptureMetadata): Promise<void> {
	const db = await openCaptureDb();
	const tx = db.transaction(CAPTURES_STORE, "readwrite");
	tx.objectStore(CAPTURES_STORE).put(metadata);
	await transactionDone(tx);
	db.close();
}

export async function listCaptures(): Promise<CaptureMetadata[]> {
	const db = await openCaptureDb();
	const tx = db.transaction(CAPTURES_STORE, "readonly");
	const captures = await requestToPromise<CaptureMetadata[]>(
		tx.objectStore(CAPTURES_STORE).getAll(),
	);
	db.close();
	return captures.sort((a, b) => b.startedAt - a.startedAt);
}

export async function getCapture(
	id: string,
): Promise<CaptureMetadata | undefined> {
	const db = await openCaptureDb();
	const tx = db.transaction(CAPTURES_STORE, "readonly");
	const capture = await requestToPromise<CaptureMetadata | undefined>(
		tx.objectStore(CAPTURES_STORE).get(id),
	);
	db.close();
	return capture;
}

export async function appendCaptureChunk(input: {
	captureId: string;
	index: number;
	chunk: ArrayBuffer;
	size: number;
}): Promise<void> {
	const db = await openCaptureDb();
	const tx = db.transaction(CHUNKS_STORE, "readwrite");
	const chunk: StoredChunk = {
		id: `${input.captureId}:${input.index.toString().padStart(8, "0")}`,
		...input,
	};
	tx.objectStore(CHUNKS_STORE).put(chunk);
	await transactionDone(tx);
	db.close();
}

export async function deleteCapture(captureId: string): Promise<void> {
	const db = await openCaptureDb();
	const tx = db.transaction([CAPTURES_STORE, CHUNKS_STORE], "readwrite");
	tx.objectStore(CAPTURES_STORE).delete(captureId);
	const chunks = tx.objectStore(CHUNKS_STORE);
	const index = chunks.index("captureId");
	const request = index.openCursor(IDBKeyRange.only(captureId));
	request.onsuccess = () => {
		const cursor = request.result;
		if (!cursor) {
			return;
		}
		cursor.delete();
		cursor.continue();
	};
	await transactionDone(tx);
	db.close();
}

export async function getCaptureBlob(metadata: CaptureMetadata): Promise<Blob> {
	const db = await openCaptureDb();
	const tx = db.transaction(CHUNKS_STORE, "readonly");
	const index = tx.objectStore(CHUNKS_STORE).index("captureId");
	const chunks = await requestToPromise<StoredChunk[]>(
		index.getAll(IDBKeyRange.only(metadata.id)),
	);
	db.close();
	return new Blob(
		chunks.sort((a, b) => a.index - b.index).map((chunk) => chunk.chunk),
		{ type: metadata.mimeType },
	);
}
