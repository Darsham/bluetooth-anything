# bluetooth-anything

> Connect and control any Bluetooth LE device — without the vendor's app.

[![npm](https://img.shields.io/npm/v/anyble.svg)](https://www.npmjs.com/package/anyble)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Every BLE gadget ships its own app. Three devices, three apps, three accounts, three
clouds. `bluetooth-anything` is an attempt to invert that: **one client that figures
out how a device works instead of requiring the vendor to tell it.**

---

## Why

A BLE peripheral exposes a GATT tree. Standard profiles (battery, heart rate, HID)
are documented. Everything else — lights, locks, toys, sensors, cheap fitness bands —
hides behind 128-bit vendor UUIDs with no published meaning. Existing tools either
dump raw hex (`nRF Connect`) or make you hand-configure every write (`BleD Config`).

Nothing *infers* what a characteristic does. That's the gap this project targets.

## What it does

- **Scan** — discover nearby BLE peripherals with advertisement + service data
- **Map** — dump the full GATT tree, services, characteristics, descriptors, properties
- **Recognize** — match against standard profiles and a fingerprint database
- **Probe** — for unknown devices: write small values, observe notifications, infer semantics
- **Generate** — turn the inference into usable controls (toggle / slider / selector)
- **Share** — save a confirmed protocol description so the next user gets instant support

## Status

**Early prototype.** v0.1 aims at the first three steps (scan / map / recognize) working
reliably on real hardware. Probing and community fingerprints come after.

Nothing here is stable yet. Expect breaking changes.

## Install

```bash
npm install -g anyble
```

Requires Node.js 22+.

## Usage

```bash
anyble scan                       # list nearby BLE devices
anyble connect <address>          # connect and keep a session
anyble gatt <address>             # print the full GATT tree
anyble read  <address> <char>     # read a characteristic
anyble write <address> <char> 01  # write raw bytes
anyble probe <address>            # infer semantics of unknown characteristics
```

```bash
# machine-readable output for scripting
anyble scan --json
anyble gatt <address> --json
```

## Architecture

Four layers, each usable on its own:

```
┌─────────────────────────────────────────────┐
│ 4. Fingerprint store   confirmed protocol   │  community reuse
├─────────────────────────────────────────────┤
│ 3. Probe engine        write → observe →    │  the novel part
│                        infer semantics      │
├─────────────────────────────────────────────┤
│ 2. Recognition         standard profiles +  │  instant UI when known
│                        fingerprint match    │
├─────────────────────────────────────────────┤
│ 1. Transport           scan / connect /     │  boring but must be solid
│                        GATT enumerate       │
└─────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the detailed design and
[docs/PROTOCOL.md](docs/PROTOCOL.md) for the fingerprint file format.

## How probing works

The core idea: **a characteristic's meaning is observable, not documented.**

1. Enumerate writable characteristics.
2. Write a small value (0x00, 0x01, 0x02…) to one at a time.
3. Watch readable/notifying characteristics for correlated change.
4. Feed the `(write → response)` sequence to a model and ask what it implies:
   switch? level? color? mode? What's the range, what's the encoding?
5. Propose a control, let the human confirm with one tap.
6. Store the confirmed description.

Probing is **guarded**: allowlisted characteristic classes first, small values only,
rate limited, reversible, and a hard denylist for firmware-update, factory-reset, and
pairing characteristics.

## Roadmap

- [ ] v0.1 — scan, connect, GATT tree, raw read/write, JSON output
- [ ] v0.2 — standard profile recognition (battery, HID, heart rate, environmental)
- [ ] v0.3 — probe engine with guarded writes + correlation heuristic
- [ ] v0.4 — LLM-assisted inference and control generation
- [ ] v0.5 — fingerprint file format + local store
- [ ] v1.0 — community fingerprint index

## Safety and legal

This project is for **devices you own**, and for **interoperability**.

- ✅ Connect to your own devices, read their GATT, decode their protocol
- ✅ Build your own client for hardware you bought
- ❌ Bypass authentication or licensing
- ❌ Extract other users' data or touch vendor servers
- ❌ Attack, jam, or spoof other people's devices

Probing writes to hardware. It can brick things. Use the guardrails, and don't point
it at equipment you can't afford to lose.

## Contributing

Issues and PRs welcome. If you reverse a device, please contribute the fingerprint
(see `docs/PROTOCOL.md`) — the whole value of this project is coverage.

## License

MIT — see [LICENSE](LICENSE).
