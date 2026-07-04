export type SerialTaskQueue = {
	/** Enqueue a task to run serially. Later tasks still run even if an earlier one fails. */
	enqueue: (task: () => Promise<void>) => void;
	/** Wait until all tasks enqueued so far have completed. */
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
