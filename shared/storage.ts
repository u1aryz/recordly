import type { CaptureMetadata } from "./types";

const DB_NAME = "video-capture-picker";
const DB_VERSION = 1;
const CAPTURES_STORE = "captures";

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

export async function deleteCapture(captureId: string): Promise<void> {
	const db = await openCaptureDb();
	const tx = db.transaction(CAPTURES_STORE, "readwrite");
	tx.objectStore(CAPTURES_STORE).delete(captureId);
	await transactionDone(tx);
	db.close();
}
