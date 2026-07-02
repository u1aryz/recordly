export type SerialTaskQueue = {
	/** タスクを直列に積む。前のタスクが失敗しても後続のタスクは実行される。 */
	enqueue: (task: () => Promise<void>) => void;
	/** これまでに積まれたタスクがすべて完了することを待つ。 */
	settled: () => Promise<void>;
};

export function createSerialTaskQueue(): SerialTaskQueue {
	let tail: Promise<void> = Promise.resolve();
	return {
		enqueue(task) {
			tail = tail.then(task).catch(() => undefined);
		},
		settled() {
			return tail;
		},
	};
}
