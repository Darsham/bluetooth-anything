import type { Advertisement, GattTree } from './types.js';

export interface Connection {
  readonly address: string;
  enumerate(): Promise<GattTree>;
  read(uuid: string): Promise<Buffer>;
  write(uuid: string, data: Buffer, withoutResponse?: boolean): Promise<void>;
  subscribe(uuid: string, cb: (data: Buffer) => void): Promise<void>;
  disconnect(): Promise<void>;
}

export interface Adapter {
  scan(timeoutMs?: number): Promise<Advertisement[]>;
  connect(address: string): Promise<Connection>;
}

/**
 * The only place a concrete BLE library is chosen. Everything above talks to `Adapter`.
 * Swap implementations here without touching recognition, probing, or the CLI.
 */
export async function createAdapter(): Promise<Adapter> {
  try {
    const { NobleAdapter } = await import('./noble-adapter.js');
    return new NobleAdapter();
  } catch (err) {
    throw new Error(
      'No BLE adapter available.\n' +
        'Install the native dependency with `npm install`, then retry.\n' +
        'On Windows this may require build tools (see README).\n' +
        `Underlying error: ${(err as Error).message}`
    );
  }
}
