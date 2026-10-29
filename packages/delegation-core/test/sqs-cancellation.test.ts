import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as flush } from "node:timers/promises";
import { ChangeMessageVisibilityCommand, DeleteMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { SqsTaskEvents } from "../src/sqs-task-events.js";
import { config, event, deferred, SqsBoundary } from "./sqs-fixture.js";

for (const request of ["renewal", "delete"] as const) {
  for (const cancellation of ["deadline", "unsubscribe", "close"] as const) {
    test(`blocked ${request} is cancelled by ${cancellation} without acknowledging uncertain work`, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
      const aws = new SqsBoundary();
      const handoff = deferred();
      const pending = deferred();
      const completedDeletes: string[] = [];
      let started = false;
      let aborted = false;
      const client = {
        destroy: aws.destroy,
        async send(command: SqsBoundary["calls"][number], options?: { abortSignal?: AbortSignal }) {
          let result = {};
          const isTarget = "ReceiptHandle" in command.input && command.input.ReceiptHandle === "blocked" && (request === "delete"
            ? command instanceof DeleteMessageCommand
            : command instanceof ChangeMessageVisibilityCommand && command.input.VisibilityTimeout !== 0);
          if (isTarget && !started) {
            started = true;
            aws.calls.push(command);
            // Like an in-flight SDK request, stay pending until explicitly aborted.
            // The cleanup gate only prevents a failing regression from hanging the suite.
            await new Promise<void>((resolve, reject) => {
              const signal = options?.abortSignal;
              const abort = () => { aborted = true; reject(new Error("SDK request aborted")); };
              signal?.addEventListener("abort", abort, { once: true });
              if (signal?.aborted) abort();
              void pending.promise.then(resolve).finally(() => signal?.removeEventListener("abort", abort));
            });
          } else {
            result = await aws.send(command, options);
          }
          if (command instanceof DeleteMessageCommand) completedDeletes.push(command.input.ReceiptHandle!);
          return result;
        },
      };
      // Keep the real production adapter; fake only the AWS SDK send boundary.
      const transport = new SqsTaskEvents({
        ...config, batchSize: 1, visibilityTimeoutSeconds: 3, handlerTimeoutMs: 2000,
        onError: (error) => { aws.errors.push(error); },
      }, client as unknown as SQSClient);
      const queue = config.workerQueueUrls.forge;
      aws.enqueue(queue, { ...event, task_id: "blocked" }, "blocked");
      aws.enqueue(queue, event, "next-batch");
      let shutdown: Promise<void> | undefined;
      try {
        const stop = await transport.subscribeForWorker("forge", (value) =>
          value.task_id === "blocked" && request === "renewal" ? handoff.promise : undefined);
        await flush();
        if (request === "renewal") {
          t.mock.timers.tick(1000);
          await flush();
          // Resolve the handler while the visibility request remains in flight.
          handoff.resolve();
          await flush();
        }
        assert.equal(started, true, "the target SDK request must actually be in flight");
        assert.deepEqual(completedDeletes, []);

        if (cancellation === "deadline") {
          t.mock.timers.tick(request === "renewal" ? 1000 : 2000);
          await flush();
          assert.deepEqual(completedDeletes, ["next-batch"], "deadline must unblock the next receive batch");
          assert.equal(aborted, true, "the pending SDK request must observe cancellation");
          assert.ok(aws.errors.some((error) => /deadline exceeded/.test(String(error))));
          assert.equal(aws.calls.some((command) => command instanceof ChangeMessageVisibilityCommand
            && command.input.VisibilityTimeout === 0), false, "deadline leaves SQS retry visibility intact");
          // Model SQS redelivery with a fresh receipt; only the new attempt may ACK.
          aws.enqueue(queue, { ...event, task_id: "blocked" }, "redelivery");
          await flush();
          assert.deepEqual(completedDeletes, ["next-batch", "redelivery"]);
        } else {
          let stopped = false;
          shutdown = (cancellation === "unsubscribe" ? stop() : transport.close()).then(() => { stopped = true; });
          await flush();
          assert.equal(stopped, true, "shutdown must not wait for an uncancelled SDK request");
          assert.equal(aborted, true, "the pending SDK request must observe shutdown");
          assert.deepEqual(completedDeletes, [], "shutdown must not ACK or start another batch");
          assert.ok(aws.calls.some((command) => command instanceof ChangeMessageVisibilityCommand
            && command.input.ReceiptHandle === "blocked" && command.input.VisibilityTimeout === 0),
          "shutdown must still release the receipt for redelivery");
          if (cancellation === "unsubscribe") {
            aws.enqueue(queue, { ...event, task_id: "blocked" }, "redelivery");
            await transport.subscribeForWorker("forge", () => {});
            await flush();
            assert.deepEqual(completedDeletes, ["next-batch", "redelivery"]);
          } else {
            assert.equal(aws.destroyed, true);
          }
        }
        pending.resolve();
        await flush();
        assert.equal(completedDeletes.some((receipt) => receipt === "blocked"), false, "cancelled request must never ACK late");
        if (request === "renewal") {
          assert.equal(aws.deleted.includes("blocked"), false, "cancelled renewal must never start a delete");
        }
      } finally {
        pending.resolve();
        handoff.resolve();
        await shutdown;
        await transport.close();
      }
    });
  }
}
