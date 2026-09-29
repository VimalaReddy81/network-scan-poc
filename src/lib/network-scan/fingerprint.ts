import { DiscoveredDevice, IdentityKey, IdentityKind } from './types';

export const IDENTITY_RANK: Record<IdentityKind, number> = { udn: 0, mac: 1, castid: 2, host: 3, ip: 4 };

// Keys that name one physical device. Two devices with different values of one of these
// are different devices, even if they share an IP (e.g. the IP was handed to another device).
export const STRONG_KINDS: IdentityKind[] = ['udn', 'mac', 'castid'];

// All-zero, broadcast, and the 02:00:00:00:00:00 placeholder iOS/Android return for the phone's own MAC.
const PLACEHOLDER_MACS = new Set(['00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff', '02:00:00:00:00:00']);

/** "B8E937AABBCC" / "b8-e9-37-aa-bb-cc" -> "b8:e9:37:aa:bb:cc". undefined for anything else or a placeholder. */
export function normalizeMac(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const hex = value.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12 || /[^0-9a-f:\-.\s]/i.test(value)) return undefined;
  const mac = hex.match(/.{2}/g)!.join(':');
  return PLACEHOLDER_MACS.has(mac) ? undefined : mac;
}

/** Sonos ids embed the MAC: "RINCON_B8E937AABBCC01400" -> "b8:e9:37:aa:bb:cc". */
export function macFromSonosId(value: string | undefined): string | undefined {
  const match = value?.match(/RINCON_([0-9A-F]{12})/i);
  return match ? normalizeMac(match[1]) : undefined;
}

export function kindOf(key: IdentityKey): IdentityKind {
  return key.slice(0, key.indexOf(':')) as IdentityKind;
}

export function valueOf(key: IdentityKey): string {
  return key.slice(key.indexOf(':') + 1);
}

export function sortKeys(keys: Iterable<IdentityKey>): IdentityKey[] {
  return [...new Set(keys)].sort(
    (a, b) => IDENTITY_RANK[kindOf(a)] - IDENTITY_RANK[kindOf(b)] || a.localeCompare(b)
  );
}

type Identifiable = Pick<DiscoveredDevice, 'udn' | 'mac' | 'castId' | 'hostname' | 'ip'>;

/** Identity keys for a device, strongest first. */
export function identityKeys(device: Identifiable): IdentityKey[] {
  const keys: IdentityKey[] = [];
  if (device.udn) keys.push(`udn:${device.udn.toLowerCase()}`);
  const mac = normalizeMac(device.mac);
  if (mac) keys.push(`mac:${mac}`);
  if (device.castId) keys.push(`castid:${device.castId.toLowerCase().replace(/-/g, '')}`);
  if (device.hostname) keys.push(`host:${device.hostname.toLowerCase().replace(/\.$/, '')}`);
  if (device.ip) keys.push(`ip:${device.ip}`);
  return sortKeys(keys);
}

/**
 * True when two key lists name different devices: both have a strong key of the same kind
 * with different values (e.g. two different UDNs at one IP).
 */
export function keysConflict(a: IdentityKey[], b: IdentityKey[]): boolean {
  return STRONG_KINDS.some((kind) => {
    const aValues = a.filter((k) => kindOf(k) === kind);
    const bValues = b.filter((k) => kindOf(k) === kind);
    return aValues.length > 0 && bValues.length > 0 && !aValues.some((k) => bValues.includes(k));
  });
}
