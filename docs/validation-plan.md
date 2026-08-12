# Delegation migration validation plan

The FleetMind delegation migration is validated in layers so a failure can be
isolated before a full sandbox run.

## 1. Adapter unit tests

Test DynamoDB routing/lifecycle authorization, NATS decoding and subscription
lifecycle, and Slack receipt posting, thread parsing, account selection, and
session-key construction independently.

## 2. Plugin integration tests

Use fake NATS, DynamoDB, Slack, and OpenClaw wake dependencies. Verify the
observable effects of delegation delivery and terminal `ship`/`block` flows:

- a Slack delivery creates or uses the expected worker thread and wakes that
  worker's matching session;
- terminal events post the PM receipt and wake the matching PM thread session;
- Slack failure does not prevent the relevant wake;
- non-Slack delivery never invokes Slack.

## 3. FleetMind provisioning contract test

Render the FleetMind consumer configuration and verify that it pins the exact
plugin beta and supplies only the required runtime configuration and
permissions. This test does not use live Slack, AWS, or agent turns.

## 4. Focused sandbox smoke tests

Run separate sandbox checks for plugin loading/tool registration, one worker
Slack receipt-and-thread flow, one PM terminal receipt-and-thread flow, and
sign-off/merge authorization.

## 5. End-to-end acceptance

After the earlier layers pass, run one create → worker receipt/thread →
ship/block → PM receipt/thread → human sign-off/merge flow. This validates the
interfaces between components, rather than substituting for their unit or
integration coverage.

Retire FleetMind CLI delegation paths only after these checks demonstrate
behavioral parity and a tested rollback path.
