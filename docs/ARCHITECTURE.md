# Architecture

## Design principles

1. **Every layer is usable alone.** `anyble scan` must work without the probe engine.
2. **Evidence over assumption.** Every inferred field carries a confidence level and the
   observation that produced it.
3. **Never silently guess.** Unknown means unknown — surface it, don't invent a control.
4. **Writes are guarded.** Probing is the only place we write to hardware we don't
   understand, and it runs behind a denylist, a rate limit, and a rollback.

---

## Layer 1 — Transport

Responsibility: everything that talks to the radio.

```ts
interface Adapter {
  scan(opts?: ScanOptions): AsyncIterable<Advertisement>;
  connect(address: string): Promise<Connection>;
}

interface Connection {
  enumerate(): Promise<GattTree>;
  read(handle: CharRef): Promise<Buffer>;
  write(handle: CharRef, data: Buffer, withoutResponse?: boolean): Promise<void>;
  subscribe(handle: CharRef, cb: (data: Buffer) => void): Promise<void>;
  disconnect(): Promise<void>;
}
```

Keep the library choice behind this interface — `@stoprocent/noble` today, something else
tomorrow. No layer above this one should import a BLE library directly.

Normalize addresses and UUIDs on the way in. UUIDs are always lowercase, full 128-bit
form internally; only format to short form on output.

---

## Layer 2 — Recognition

Responsibility: turn a GATT tree into "this is probably an X".

Two matchers, run in order:

**Standard profiles.** 16-bit UUIDs map to published specifications.

| UUID | Profile |
|---|---|
| `0x180f` | Battery Service |
| `0x180d` | Heart Rate |
| `0x1812` | HID over GATT |
| `0x181a` | Environmental Sensing |
| `0x1815` | Automation IO |

If the device exposes a standard profile, we can build controls from the spec with no
probing at all.

**Fingerprints.** A fingerprint is a set of observable facts about a device plus, if
known, what its characteristics mean.

```json
{
  "match": {
    "namePattern": "^XYZ-",
    "serviceUuids": ["0000fff0-0000-1000-8000-00805f9b34fb"],
    "manufacturerId": 76
  },
  "confidence": "B"
}
```

Matching is scored, not boolean: name pattern, service set overlap, manufacturer data,
and characteristic count all contribute. Return the best candidate with its score.

---

## Layer 3 — Probe

Responsibility: infer semantics for the characteristics recognition couldn't explain.

This is the part nobody else ships.

### Guardrails (non-negotiable)

- **Denylist first.** Never write to characteristics in a firmware-update service
  (`0x1530`/`0x1531` Nordic DFU, vendor OTA services), factory-reset characteristics, or
  anything involved in pairing/bonding.
- **Allowlist ordering.** Prefer characteristics whose properties include `write` over
  `write-no-response`; prefer ones near a notifying sibling.
- **Small values only.** `0x00`, `0x01`, `0x02`, then a short ladder. Never random bytes.
- **Rate limit.** One write per N ms, hard cap on total writes per session.
- **Reversible.** Record the pre-probe value of every characteristic touched and restore
  on exit, including on crash.
- **Abort on anomaly.** Unusual disconnect, unexpected reboot signature, or no response
  across three consecutive writes → stop, mark the device as `probe-unsafe`.

### Strategy

1. Enumerate writable characteristics; skip denylisted.
2. Baseline: read/subscribe everything readable for 2 seconds, record.
3. For each candidate: write a probe value, wait, record deltas in readable/notifying
   characteristics and in RSSI/latency.
4. Classify the observed effect:
   - **Boolean** — exactly two stable states observed
   - **Level** — monotonic response as value increases
   - **Enumerated** — distinct response clusters
   - **No effect** — drop the candidate
5. Where the shape is ambiguous, hand the raw `(write, response)` series to a model for a
   second opinion. The model proposes; the human confirms.

### Why human confirmation is mandatory

A probe can produce a plausible-looking correlation that is actually noise. The cost of a
wrong button is a device that misbehaves in the user's hand. One tap to confirm is cheap.

---

## Layer 4 — Fingerprint store

Responsibility: make sure the second user of a device doesn't have to probe it.

- Local store: a directory of JSON files, one per fingerprint (`docs/PROTOCOL.md`).
- Keyed by a hash of the match facts, so the same device from different people dedupes.
- A confirmed fingerprint records **who confirmed it and at what confidence**, so bad
  entries can be identified and demoted later.

Community distribution is out of scope for v0.x. Get the format right first.

---

## Data flow

```
scan
  └─ advisory data ─→ [2] recognition
                        ├─ standard profile hit ─→ generate controls ─→ done
                        ├─ fingerprint hit ──────→ generate controls ─→ done
                        └─ no hit ─→ [3] probe
                                       └─ infer ─→ human confirms ─→ [4] store
```

---

## Known failure modes

| Failure | Symptom | Handling |
|---|---|---|
| Encrypted link | Notifications are ciphertext; writes ignored | Detect, report "encrypted — needs app-level reversing", don't pretend to probe |
| Write accepted, no response | `write` resolves, nothing changes | Treat as no-effect after 3 tries, don't invent semantics |
| Device wedged by a write | Stops advertising or disconnects permanently | Documented risk; guardrails reduce it, they don't eliminate it |
| MTU too small | Long frames truncated | Negotiate MTU before probing; chunk if needed |
| Connection interval too long | Dropped notifications | Request short interval during probe |
