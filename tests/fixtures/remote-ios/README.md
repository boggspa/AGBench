# Remote/iOS Golden Fixtures

Shared JSON fixtures for the Remote Task Console contract. These files are
intended to be loaded by TypeScript, Swift daemon, and iOS Swift tests so both
sides assert against the same payloads instead of duplicating sample shapes.

## Files

- `bridge-action-ack-v1.accepted-composer-prompt.json` — policy accepted and
  executor ran a remote `composerPrompt`.
- `bridge-action-ack-v1.denied-readonly-cancel-run.json` — policy denied a
  mutating action against a read-only workspace.
- `remote-projection-envelope.thread-latest.json` — Mac-authored bounded
  `RemoteThreadSnapshot` envelope for an iPhone/iPad thread view.

## Contract Notes

`BridgeActionAckV1.reason` is the canonical user-readable reason. Current
desktop and daemon code still carry a legacy `message` field in places; tests
that consume these fixtures should treat `message` as an adapter concern and
assert the V1 fields here.

`RemoteProjectionEnvelope.payload` wraps the existing `RemoteThreadSnapshot`
shape. The envelope adds routing metadata (`pairID`, `workspaceId`, `threadId`)
and a `payloadKind` discriminator so future projection types can share the same
bridge channel.
