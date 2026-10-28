/** Normalized shapes passed between layers. No BLE library types leak out of src/ble. */

export interface Advertisement {
  address: string;
  name?: string;
  rssi: number;
  serviceUuids: string[];
  manufacturerData?: {
    companyId: number;
    data: string; // hex
  };
}

export interface CharacteristicInfo {
  uuid: string;
  name?: string;
  properties: CharacteristicProperty[];
}

export type CharacteristicProperty =
  | 'read'
  | 'write'
  | 'writeWithoutResponse'
  | 'notify'
  | 'indicate'
  | 'broadcast'
  | 'authenticatedSignedWrites'
  | 'extendedProperties';

export interface ServiceInfo {
  uuid: string;
  name?: string;
  characteristics: CharacteristicInfo[];
}

export interface GattTree {
  services: ServiceInfo[];
}

/** A recognized or inferred meaning for a characteristic. */
export interface Semantic {
  role: 'state' | 'control' | 'config' | 'unknown';
  kind?: 'boolean' | 'level' | 'enum';
  min?: number;
  max?: number;
  values?: Record<string, number>;
  evidence: Evidence;
}

export type Evidence = 'A' | 'B' | 'C' | 'D';
