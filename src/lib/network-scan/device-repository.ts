import { enrich } from './enrich';
import { DeviceType, DiscoveredDevice, IdentityKey, KnownDevice } from './types';

// In-memory mock backend. Saved devices are lost when the app restarts.
// Shaped for the future API:
//   GET  /homes/{homeId}/devices
//   POST /homes/{homeId}/devices
//   POST /homes/{homeId}/devices/scan

export type SaveDeviceInput = {
  /** Set to update an existing device (e.g. assign a room); omit to add one. */
  id?: string;
  name: string;
  identityKeys: IdentityKey[];
  manufacturer?: string;
  model?: string;
  deviceType?: DeviceType;
  roomName?: string;
  roomConfirmed?: boolean;
  lastIp?: string;
};

/** Body of POST /homes/{homeId}/devices/scan. */
export type ScanSubmission = {
  scannedAt: number;
  devices: Pick<
    DiscoveredDevice,
    'identityKeys' | 'name' | 'ip' | 'hostname' | 'mac' | 'manufacturer' | 'model' | 'services' | 'sources'
  >[];
};

export type ScanSubmissionResult = { received: number; matched: number; notSeen: number };

export interface DeviceRepository {
  listKnownDevices(homeId: string): Promise<KnownDevice[]>;
  saveDevice(homeId: string, input: SaveDeviceInput): Promise<KnownDevice>;
  submitScan(homeId: string, scan: ScanSubmission): Promise<ScanSubmissionResult>;
}

const LATENCY_MS = 150;
const delay = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

export function createMockDeviceRepository(seed: KnownDevice[] = []): DeviceRepository {
  const store = new Map<string, KnownDevice>(seed.map((d) => [d.id, d]));
  let nextId = 1;

  const inHome = (homeId: string) => [...store.values()].filter((d) => d.homeId === homeId);

  return {
    async listKnownDevices(homeId) {
      return delay(inHome(homeId).map((d) => ({ ...d })));
    },

    async saveDevice(homeId, input) {
      const existing = input.id ? store.get(input.id) : undefined;
      const device: KnownDevice = {
        ...existing,
        id: existing?.id ?? `dev_${Date.now().toString(36)}_${nextId++}`,
        homeId,
        name: input.name,
        identityKeys: [...new Set([...(existing?.identityKeys ?? []), ...input.identityKeys])],
        manufacturer: input.manufacturer ?? existing?.manufacturer,
        model: input.model ?? existing?.model,
        deviceType: input.deviceType ?? existing?.deviceType,
        roomName: input.roomName ?? existing?.roomName,
        roomConfirmed: input.roomConfirmed ?? existing?.roomConfirmed ?? false,
        lastIp: input.lastIp ?? existing?.lastIp,
        addedAt: existing?.addedAt ?? Date.now(),
        lastSeenAt: existing?.lastSeenAt,
      };
      store.set(device.id, device);
      return delay({ ...device });
    },

    async submitScan(homeId, scan) {
      const known = inHome(homeId);
      const discovered: DiscoveredDevice[] = scan.devices.map((d) => ({
        ...d,
        id: d.identityKeys[0],
        ports: [],
        lastSeenAt: scan.scannedAt,
      }));
      const joined = enrich(discovered, known);

      // Matched devices remember when they were last seen and their new IP; confirmed rooms are untouched.
      for (const home of joined) {
        if (home.status === 'seen' && home.known) {
          store.set(home.known.id, {
            ...home.known,
            lastSeenAt: scan.scannedAt,
            lastIp: home.discovered?.ip ?? home.known.lastIp,
            identityKeys: [
              ...new Set([
                ...home.known.identityKeys.filter((k) => !k.startsWith('ip:')),
                ...(home.discovered?.identityKeys ?? []),
              ]),
            ],
          });
        }
      }

      return delay({
        received: scan.devices.length,
        matched: joined.filter((h) => h.status === 'seen' && h.known).length,
        notSeen: joined.filter((h) => h.status === 'not-seen').length,
      });
    },
  };
}

/** The app-wide mock backend. */
export const deviceRepository = createMockDeviceRepository();

/** Until homes exist, the scan belongs to one default home. */
export const DEFAULT_HOME_ID = 'home_default';

export function toScanSubmission(devices: DiscoveredDevice[], scannedAt = Date.now()): ScanSubmission {
  return {
    scannedAt,
    devices: devices.map(({ identityKeys, name, ip, hostname, mac, manufacturer, model, services, sources }) => ({
      identityKeys,
      name,
      ip,
      hostname,
      mac,
      manufacturer,
      model,
      services,
      sources,
    })),
  };
}
