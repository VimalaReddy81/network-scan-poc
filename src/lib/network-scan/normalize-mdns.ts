import { identityKeys, macFromSonosId, normalizeMac } from './fingerprint';
import { DiscoveredDevice } from './types';

/** One resolved Bonjour service, the same shape on both platforms (see mdns-browser.ts). */
export type RawMdnsService = {
  platform: 'ios' | 'android';
  /** The browsed type, e.g. "_googlecast._tcp". */
  type: string;
  /** Service instance name, e.g. "Living Room TV". */
  name?: string;
  /** iOS: "<name>.<type>.local.". Android (DNSSD): the same as name. */
  fullName?: string;
  /** iOS: the real host name ("Living-Room.local."). Android (DNSSD): the service name, not a host. */
  host?: string;
  port?: number;
  addresses?: string[];
  txt?: Record<string, string>;
};

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** "_googlecast._tcp." / "googlecast" -> "_googlecast._tcp". */
export function normalizeServiceType(type: string): string {
  const trimmed = type.trim().replace(/\.$/, '').replace(/\.local$/, '');
  return trimmed.startsWith('_') ? trimmed : `_${trimmed}._tcp`;
}

/** Prefer a routable IPv4 address, then any IPv4 (link-local), then whatever is there. */
export function pickIp(addresses: string[] = []): string | undefined {
  const ipv4 = addresses.filter((a) => IPV4.test(a));
  return ipv4.find((a) => !a.startsWith('169.254.')) ?? ipv4[0] ?? addresses[0];
}

/** A real mDNS host name, or undefined (Android's host field is the service name, not a host). */
function hostnameOf(raw: RawMdnsService): string | undefined {
  const host = raw.host?.trim().replace(/\.$/, '');
  if (!host || host === raw.name || !/\.local$/i.test(host) || /\s/.test(host)) return undefined;
  return host.toLowerCase();
}

/** Instance name without the type suffix iOS adds to fullName, and without RAOP's "MAC@" prefix. */
function instanceName(raw: RawMdnsService, type: string): string | undefined {
  let name = raw.name?.trim();
  if (!name && raw.fullName) {
    const suffix = `.${type}.local`;
    const full = raw.fullName.replace(/\.$/, '');
    name = full.endsWith(suffix) ? full.slice(0, -suffix.length) : full;
  }
  if (type === '_raop._tcp' && name?.includes('@')) name = name.slice(name.indexOf('@') + 1);
  return name || undefined;
}

/** MAC only when the device advertises it itself. */
function advertisedMac(raw: RawMdnsService, type: string, txt: Record<string, string>): string | undefined {
  if (type === '_airplay._tcp') return normalizeMac(txt.deviceid);
  if (type === '_raop._tcp') {
    const prefix = raw.name?.split('@')[0];
    return raw.name?.includes('@') ? normalizeMac(prefix) : undefined;
  }
  // Sonos puts its RINCON id (which embeds the MAC) in the name or TXT ("info" path, "hhid" etc.).
  return macFromSonosId([raw.name, raw.fullName, ...Object.values(txt)].join(' '));
}

export function normalizeMdns(raw: RawMdnsService, seenAt = Date.now()): DiscoveredDevice {
  const type = normalizeServiceType(raw.type);
  const txt = Object.fromEntries(
    Object.entries(raw.txt ?? {}).map(([k, v]) => [k.toLowerCase(), String(v ?? '').trim()])
  );

  const partial = {
    // googlecast: fn = friendly name, md = model. airplay: model. raop: am = model.
    name: txt.fn || instanceName(raw, type),
    ip: pickIp(raw.addresses),
    hostname: hostnameOf(raw),
    mac: advertisedMac(raw, type, txt),
    manufacturer: txt.manufacturer || undefined,
    model: txt.md || txt.model || txt.am || undefined,
    castId: type === '_googlecast._tcp' && /^[0-9a-f-]{32,36}$/i.test(txt.id ?? '') ? txt.id.toLowerCase().replace(/-/g, '') : undefined,
  };
  const keys = identityKeys(partial);

  return {
    ...partial,
    id: keys[0] ?? `host:${type}/${partial.name ?? 'unknown'}`,
    identityKeys: keys,
    services: [type],
    ports: typeof raw.port === 'number' && raw.port > 0 ? [raw.port] : [],
    sources: ['mdns'],
    lastSeenAt: seenAt,
  };
}
