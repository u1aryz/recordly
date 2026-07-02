import { describe, expect, it, vi } from "vitest";
import { createSerialTaskQueue } from "@/shared/task-queue";

describe("createSerialTaskQueue", () => {
	it("runs enqueued tasks in order, one at a time", async () => {
		const queue = createSerialTaskQueue();
		const order: number[] = [];
		let resolveFirst!: () => void;

		queue.enqueue(
			() =>
				new Promise<void>((resolve) => {
					resolveFirst = () => {
						order.push(1);
						resolve();
					};
				}),
		);
		queue.enqueue(async () => {
			order.push(2);
		});

		// enqueue は最初のタスクの実行自体もマイクロタスクとしてスケジュールする
		// ため、resolveFirst が設定されるまで1tick待つ。
		await Promise.resolve();
		expect(order).toEqual([]);
		resolveFirst();
		await queue.settled();

		expect(order).toEqual([1, 2]);
	});

	it("does not let a rejected task stop later tasks from running", async () => {
		const queue = createSerialTaskQueue();
		const ran: string[] = [];

		queue.enqueue(async () => {
			ran.push("first");
			throw new Error("boom");
		});
		queue.enqueue(async () => {
			ran.push("second");
		});

		await queue.settled();

		expect(ran).toEqual(["first", "second"]);
	});

	it("resolves settled() only once every queued task has finished", async () => {
		const queue = createSerialTaskQueue();
		const task = vi.fn(async () => undefined);

		queue.enqueue(task);
		queue.enqueue(task);
		queue.enqueue(task);
		await queue.settled();

		expect(task).toHaveBeenCalledTimes(3);
	});
});
