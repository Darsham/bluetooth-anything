#!/usr/bin/env node
import { Command } from 'commander';
import { createAdapter } from './ble/adapter.js';
import { fingerprintCommand } from './fingerprint.js';
import type { Advertisement, GattTree } from './ble/types.js';

const program = new Command();

program
  .name('anyble')
  .description('Connect and control any Bluetooth LE device')
  .version('0.1.0');

/* ---------------------------------------------------------------- helpers */

function printTable(rows: string[][]): void {
  if (rows.length === 0) {
    console.log('(no devices)');
    return;
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  for (const row of rows) {
    console.log(row.map((cell, i) => (cell ?? '').padEnd(widths[i])).join('  '));
  }
}

function fail(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`error: ${message}`);
  process.exit(1);
}

function formatAdv(a: Advertisement): string[] {
  return [
    a.address,
    String(a.rssi).padStart(4),
    a.name ?? '(unnamed)',
    a.serviceUuids.length ? a.serviceUuids.join(',') : '-',
  ];
}

function formatGatt(tree: GattTree): string[][] {
  const rows: string[][] = [['SERVICE', 'CHARACTERISTIC', 'PROPERTIES', 'NAME']];
  for (const service of tree.services) {
    if (service.characteristics.length === 0) {
      rows.push([service.uuid, '-', '-', service.name ?? '']);
      continue;
    }
    for (const c of service.characteristics) {
      rows.push([service.uuid, c.uuid, c.properties.join(','), c.name ?? '']);
    }
  }
  return rows;
}

function parseHex(input: string): Buffer {
  const clean = input.replace(/[\s,:-]/g, '');
  if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error(`Invalid hex byte string: "${input}"`);
  }
  return Buffer.from(clean, 'hex');
}

/* ------------------------------------------------------------------ scan */

program
  .command('scan')
  .description('list nearby BLE devices')
  .option('-t, --timeout <ms>', 'scan duration in ms', '8000')
  .option('--json', 'machine-readable output')
  .action(async (opts: { timeout: string; json?: boolean }) => {
    try {
      const adapter = await createAdapter();
      const devices = await adapter.scan(Number(opts.timeout));
      if (opts.json) {
        console.log(JSON.stringify(devices, null, 2));
        return;
      }
      printTable([['ADDRESS', 'RSSI', 'NAME', 'SERVICES'], ...devices.map(formatAdv)]);
      console.error(`\n${devices.length} device(s)`);
    } catch (err) {
      fail(err);
    }
  });

/* ------------------------------------------------------------------ gatt */

program
  .command('gatt <address>')
  .description('print the full GATT tree of a device')
  .option('--json', 'machine-readable output')
  .action(async (address: string, opts: { json?: boolean }) => {
    let conn: Awaited<ReturnType<Awaited<ReturnType<typeof createAdapter>>['connect']>> | undefined;
    try {
      const adapter = await createAdapter();
      conn = await adapter.connect(address);
      const tree = await conn.enumerate();
      if (opts.json) {
        console.log(JSON.stringify(tree, null, 2));
        return;
      }
      printTable(formatGatt(tree));
    } catch (err) {
      fail(err);
    } finally {
      await conn?.disconnect().catch(() => undefined);
    }
  });

/* ------------------------------------------------------------------ read */

program
  .command('read <address> <characteristic>')
  .description('read a characteristic and print hex + ascii')
  .action(async (address: string, characteristic: string) => {
    let conn: Awaited<ReturnType<Awaited<ReturnType<typeof createAdapter>>['connect']>> | undefined;
    try {
      const adapter = await createAdapter();
      conn = await adapter.connect(address);
      const data = await conn.read(characteristic);
      const hex = data.toString('hex').replace(/(..)/g, '$1 ').trim();
      const ascii = data.toString('latin1').replace(/[^\x20-\x7e]/g, '.');
      console.log(`hex:   ${hex}`);
      console.log(`ascii: ${ascii}`);
      console.log(`len:   ${data.length}`);
    } catch (err) {
      fail(err);
    } finally {
      await conn?.disconnect().catch(() => undefined);
    }
  });

/* ----------------------------------------------------------------- write */

program
  .command('write <address> <characteristic> <bytes>')
  .description('write raw hex bytes to a characteristic, e.g. "03 12 01"')
  .option('--no-response', 'use write-without-response')
  .action(async (address: string, characteristic: string, bytes: string, opts: { response: boolean }) => {
    let conn: Awaited<ReturnType<Awaited<ReturnType<typeof createAdapter>>['connect']>> | undefined;
    try {
      const payload = parseHex(bytes);
      const adapter = await createAdapter();
      conn = await adapter.connect(address);
      await conn.write(characteristic, payload, !opts.response);
      console.log(`wrote ${payload.length} byte(s) to ${characteristic}`);
    } catch (err) {
      fail(err);
    } finally {
      await conn?.disconnect().catch(() => undefined);
    }
  });

/* ----------------------------------------------------------------- probe */

program
  .command('probe <address>')
  .description('infer the meaning of unknown characteristics (not implemented yet)')
  .action(() => {
    console.error('probe is not implemented yet — planned for v0.3.');
    console.error('See docs/ARCHITECTURE.md, layer 3.');
    process.exit(2);
  });

/* ----------------------------------------------------------- fingerprint */

program.addCommand(fingerprintCommand());

program.parseAsync(process.argv).catch(fail);
