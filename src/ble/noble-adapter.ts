import type { Adapter, Connection } from './adapter.js';
import type { Advertisement, CharacteristicProperty, GattTree } from './types.js';

/* noble ships no usable types; keep the untyped surface inside this file only. */
type AnyNoble = any;

const PROPERTY_MAP: Record<string, CharacteristicProperty> = {
  read: 'read',
  write: 'write',
  writeWithoutResponse: 'writeWithoutResponse',
  notify: 'notify',
  indicate: 'indicate',
  broadcast: 'broadcast',
  authenticatedSignedWrites: 'authenticatedSignedWrites',
  extendedProperties: 'extendedProperties',
};

export class NobleAdapter implements Adapter {
  private noble: AnyNoble | null = null;

  private async load(): Promise<AnyNoble> {
    if (this.noble) return this.noble;
    const mod: AnyNoble = await import('@stoprocent/noble');
    this.noble = mod.default ?? mod;
    return this.noble;
  }

  private async waitForPowerOn(noble: AnyNoble, timeoutMs = 10_000): Promise<void> {
    if (noble.state === 'poweredOn') return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Bluetooth adapter did not power on (state: ${noble.state})`)),
        timeoutMs
      );
      noble.once('stateChange', (state: string) => {
        if (state === 'poweredOn') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  async scan(timeoutMs = 8000): Promise<Advertisement[]> {
    const noble = await this.load();
    await this.waitForPowerOn(noble);

    const found = new Map<string, Advertisement>();

    const onDiscover = (peripheral: AnyNoble): void => {
      const adv = peripheral.advertisement ?? {};
      const manufacturerData = adv.manufacturerData
        ? {
            companyId: adv.manufacturerData.length >= 2 ? adv.manufacturerData.readUInt16LE(0) : -1,
            data: adv.manufacturerData.length > 2 ? adv.manufacturerData.subarray(2).toString('hex') : '',
          }
        : undefined;

      found.set(peripheral.address, {
        address: peripheral.address,
        name: adv.localName ?? peripheral.advertisement?.localName ?? undefined,
        rssi: peripheral.rssi ?? 0,
        serviceUuids: (adv.serviceUuids ?? []).map((u: string) => u.toLowerCase()),
        manufacturerData,
      });
    };

    noble.on('discover', onDiscover);
    try {
      await noble.startScanningAsync([], true);
      await new Promise((r) => setTimeout(r, timeoutMs));
    } finally {
      try {
        await noble.stopScanningAsync();
      } catch {
        /* adapter may already be stopped */
      }
      noble.removeListener('discover', onDiscover);
    }

    return [...found.values()].sort((a, b) => b.rssi - a.rssi);
  }

  async connect(address: string): Promise<Connection> {
    const noble = await this.load();
    await this.waitForPowerOn(noble);

    const peripheral = await this.findPeripheral(noble, address);
    await peripheral.connectAsync();
    const { characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync();

    const tree: GattTree = {
      services: (peripheral.services ?? []).map((service: AnyNoble) => ({
        uuid: String(service.uuid).toLowerCase(),
        name: service.name ?? undefined,
        characteristics: (service.characteristics ?? []).map((c: AnyNoble) => ({
          uuid: String(c.uuid).toLowerCase(),
          name: c.name ?? undefined,
          properties: (c.properties ?? [])
            .map((p: string) => PROPERTY_MAP[p])
            .filter((p: CharacteristicProperty | undefined): p is CharacteristicProperty => Boolean(p)),
        })),
      })),
    };

    const byUuid = new Map<string, AnyNoble>();
    for (const c of characteristics ?? []) {
      byUuid.set(String(c.uuid).toLowerCase(), c);
    }

    const self = this;
    return {
      address,
      async enumerate() {
        return tree;
      },
      async read(uuid: string) {
        const c = self.requireCharacteristic(byUuid, uuid);
        const data: Buffer = await c.readAsync();
        return data;
      },
      async write(uuid: string, data: Buffer, withoutResponse = false) {
        const c = self.requireCharacteristic(byUuid, uuid);
        await c.writeAsync(data, withoutResponse);
      },
      async subscribe(uuid: string, cb: (data: Buffer) => void) {
        const c = self.requireCharacteristic(byUuid, uuid);
        c.on('data', (data: Buffer) => cb(data));
        await c.subscribeAsync();
      },
      async disconnect() {
        await peripheral.disconnectAsync();
      },
    };
  }

  private requireCharacteristic(byUuid: Map<string, AnyNoble>, uuid: string): AnyNoble {
    const c = byUuid.get(uuid.toLowerCase());
    if (!c) throw new Error(`Characteristic not found on this device: ${uuid}`);
    return c;
  }

  private async findPeripheral(noble: AnyNoble, address: string): Promise<AnyNoble> {
    const normalized = address.toLowerCase();

    // noble's internal cache is not a stable API — catch the peripheral from the
    // discover event instead, which is what startScanning actually emits.
    return await new Promise<AnyNoble>((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        noble.removeListener('discover', onDiscover);
        noble.stopScanningAsync().catch(() => undefined);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Device not found: ${address} (scanned 15s)`));
      }, 15_000);

      const onDiscover = (peripheral: AnyNoble): void => {
        if (settled) return;
        if (String(peripheral.address).toLowerCase() !== normalized) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(peripheral);
      };

      noble.on('discover', onDiscover);
      noble.startScanningAsync([], true).catch((err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(err);
      });
    });
  }
}
