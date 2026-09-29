import { identityKeys, sortKeys } from './fingerprint';
import { DiscoveredDevice } from './types';

const union = <T>(a: T[], b: T[]) => [...new Set([...a, ...b])];

/** Combines two results for the same device. The first known value of a field wins. */
function combine(a: DiscoveredDevice, b: DiscoveredDevice): DiscoveredDevice {
  const merged: DiscoveredDevice = {
    ...a,
    name: a.name ?? b.name,
    ip: a.ip ?? b.ip,
    hostname: a.hostname ?? b.hostname,
    mac: a.mac ?? b.mac,
    manufacturer: a.manufacturer ?? b.manufacturer,
    model: a.model ?? b.model,
    udn: a.udn ?? b.udn,
    castId: a.castId ?? b.castId,
    services: union(a.services, b.services),
    ports: union(a.ports, b.ports).sort((x, y) => x - y),
    sources: union(a.sources, b.sources).sort(),
    lastSeenAt: Math.max(a.lastSeenAt, b.lastSeenAt),
  };
  // Keep every key either side had (e.g. two UDNs), plus any derived from the merged fields.
  merged.identityKeys = sortKeys([...a.identityKeys, ...b.identityKeys, ...identityKeys(merged)]);
  merged.id = merged.identityKeys[0];
  return merged;
}

/**
 * Collapses results that share any identity key into one device, including chains:
 * if A shares a key with B and B with C, all three become one device. Order is kept
 * (a merged device sits where its first result was).
 */
export function mergeDevices(devices: DiscoveredDevice[]): DiscoveredDevice[] {
  // Union-find over device indexes, linked through shared keys.
  const parent = devices.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const ownerOfKey = new Map<string, number>();

  devices.forEach((device, i) => {
    for (const key of device.identityKeys) {
      const owner = ownerOfKey.get(key);
      if (owner === undefined) {
        ownerOfKey.set(key, i);
      } else {
        const [rootA, rootB] = [find(owner), find(i)];
        if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
      }
    }
  });

  const groups = new Map<number, DiscoveredDevice>();
  devices.forEach((device, i) => {
    const root = find(i);
    const existing = groups.get(root);
    groups.set(root, existing ? combine(existing, device) : device);
  });
  return [...groups.values()];
}
