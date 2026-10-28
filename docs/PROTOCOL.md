# Fingerprint format

A **fingerprint** is a JSON file describing one BLE device: how to recognize it, and
what its characteristics mean.

One file per device. Files live in `~/.anyble/fingerprints/` locally, and (later) in a
shared index.

## Schema

```jsonc
{
  "schemaVersion": 1,

  "id": "sha256:9f2c…",           // hash of `match`, computed — do not hand-write

  "device": {
    "name": "XYZ-100",            // observed advertised name
    "vendor": "Example Corp",
    "category": "light"           // free-form, used for grouping only
  },

  "match": {                      // how to recognize this device again
    "namePattern": "^XYZ-(100|200)$",
    "serviceUuids": [
      "0000fff0-0000-1000-8000-00805f9b34fb"
    ],
    "manufacturerId": 76,                              // optional
    "manufacturerDataPrefix": "0102",                  // optional, hex
    "characteristicCount": 4                           // optional, weak signal
  },

  "gatt": [                       // observed tree, used to render without reconnecting
    {
      "uuid": "0000fff0-0000-1000-8000-00805f9b34fb",
      "name": "vendor",
      "characteristics": [
        { "uuid": "0000fff1-…", "properties": ["read", "notify"], "role": "state" },
        { "uuid": "0000fff2-…", "properties": ["write"],          "role": "control" }
      ]
    }
  ],

  "commands": [                   // what we know how to do
    {
      "name": "power_on",
      "label": "Power on",
      "target": "0000fff2-…",
      "frame": "03 12 01",        // hex, as written
      "padTo": 20,                // optional: right-pad with 0x00 to this length
      "params": [],               // optional, see below
      "evidence": "A"
    },
    {
      "name": "brightness",
      "label": "Brightness",
      "target": "0000fff2-…",
      "frame": "03 13 {level}",
      "params": [
        { "name": "level", "type": "uint8", "min": 0, "max": 100 }
      ],
      "evidence": "A"
    }
  ],

  "provenance": {
    "app": "com.example.xyz",
    "appVersion": "1.2.3",
    "firmware": "1.0.4",
    "method": "hci-snoop",       // hci-snoop | nrf-sniffer | static-analysis | probe
    "captures": ["cap_on.log", "cap_brightness.log"],
    "confirmedBy": "A",
    "date": "2026-10-28"
  }
}
```

## Evidence levels

Every command carries one. **Never upgrade a level without new evidence.**

| Level | Meaning | Produced by |
|---|---|---|
| **A** | Confirmed on real hardware — wrote it, device did the thing | manual verification |
| **B** | Two independent sources agree (e.g. decompiled constant + capture) | static + dynamic |
| **C** | Single-source inference | one capture, or probe correlation only |
| **D** | Guessed | nothing yet |

Consumers must treat C and D differently from A: a C-level command should be shown as
"unverified" in a UI, and D should not be offered at all.

## Parameter templates

`frame` supports `{param}` placeholders:

```json
{
  "frame": "03 13 {level}",
  "params": [{ "name": "level", "type": "uint8", "min": 0, "max": 100 }]
}
```

Supported types: `uint8`, `uint16le`, `uint16be`, `bool`, `enum`.

```json
{ "name": "mode", "type": "enum", "values": { "steady": 0, "pulse": 1, "wave": 2 } }
```

## Validation rules

A fingerprint is rejected if:

- `schemaVersion` is missing or unknown
- `match` is empty (must have at least one of `namePattern` / `serviceUuids`)
- any `commands[].target` is not present in `gatt`
- any command has `evidence` outside A/B/C/D
- `frame` contains a `{param}` not declared in `params`
- a declared param's `min` > `max`

Run `anyble fingerprint validate <file>` to check.

## Contributing a fingerprint

1. Reverse the device (see the `ble-protocol-reverse` skill workflow).
2. Confirm commands on real hardware — aim for at least power, and one continuous
   control if the device has one.
3. Fill `provenance` honestly. **Leave `evidence` at what you actually achieved.**
4. Open a PR adding the file under `fingerprints/<vendor>/<device>.json`.

Please do not submit fingerprints derived from someone else's capture without saying so
in `provenance.method`.
