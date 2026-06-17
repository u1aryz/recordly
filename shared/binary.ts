export function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes.buffer;
}

export function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error);
		reader.onload = () => {
			if (typeof reader.result !== "string") {
				reject(new Error("Blob could not be encoded as base64."));
				return;
			}
			const marker = "base64,";
			const markerIndex = reader.result.indexOf(marker);
			if (markerIndex < 0) {
				resolve(reader.result);
				return;
			}
			resolve(reader.result.slice(markerIndex + marker.length));
		};
		reader.readAsDataURL(blob);
	});
}
