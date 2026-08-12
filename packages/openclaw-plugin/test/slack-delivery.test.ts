import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pmTerminalReceipt,
  sendBestEffortSlackThreadReceipt,
  sessionKeyForSlackThread,
  slackThreadTarget,
  workerDelegationReceipt,
} from "../src/slack-delivery.js";

test("structured Slack delivery is authoritative over a legacy permalink", () => {
  const target = slackThreadTarget(
    { provider: "slack", accountId: "A1", conversationId: "C123", threadId: "123.456" },
    "https://example.slack.com/archives/CBAD/p999999999999",
  );
  assert.deepEqual(target, { provider: "slack", accountId: "A1", conversationId: "C123", threadId: "123.456" });
  assert.equal(sessionKeyForSlackThread("forge", target!), "agent:forge:slack:channel:c123:thread:123.456");
  assert.equal(target?.accountId, "A1");
});

test("legacy Slack permalink is used only when no structured delivery exists", () => {
  assert.deepEqual(
    slackThreadTarget(undefined, "https://example.slack.com/archives/C123/p123456789012"),
    { provider: "slack", conversationId: "C123", threadId: "123456.789012" },
  );
  assert.equal(slackThreadTarget(undefined, "https://example.slack.com/archives/C123/p123456789012")?.accountId, undefined);
  assert.equal(slackThreadTarget({ provider: "discord", accountId: "A1", conversationId: "D1" }, "https://example.slack.com/archives/C123/p123456789012"), undefined);
});

test("Slack receipts use the expected concise worker and PM text", () => {
  assert.equal(workerDelegationReceipt("deadbeef", "conductor", "https://example/slack/thread"), "👋 Received delegation `deadbeef` from conductor — picking up. Triggered by https://example/slack/thread.");
  assert.equal(pmTerminalReceipt("ship", "deadbeef", "forge"), "✓ Received ship for `deadbeef` from forge — reviewing");
  assert.equal(pmTerminalReceipt("block", "deadbeef", "forge"), "⚠️ Received block for `deadbeef` from forge — reviewing");
});

test("Slack receipt failure is contained", async () => {
  const errors: unknown[] = [];
  await assert.doesNotReject(sendBestEffortSlackThreadReceipt(
    { sendText: async () => { throw new Error("offline"); } },
    { provider: "slack", accountId: "A1", conversationId: "C123", threadId: "123.456" },
    "received",
    (error) => errors.push(error),
  ));
  assert.equal((errors[0] as Error).message, "offline");
});
