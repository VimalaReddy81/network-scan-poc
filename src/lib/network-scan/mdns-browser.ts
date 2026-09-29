import { Platform } from 'react-native';

import NetworkMdns from '../../../modules/network-mdns';
import { MDNS_BROWSE_MS, MDNS_SERVICE_TYPES } from './config';
import { RawMdnsService } from './normalize-mdns';

// One interface over both platforms, both served by modules/network-mdns:
// - iOS: Apple's Bonjour API (NetServiceBrowser).
// - Android: the system NsdManager.
//
// Every known service type is browsed at the same time for the whole budget. Alongside, the DNS-SD
// meta-query (_services._dns-sd._udp) asks the network which types exist; each new type it reports
// is browsed too. iOS only lets an app browse types listed in NSBonjourServices, so on iOS a type
// outside that list is reported (typesNotBrowsable) but not browsed.

/** The DNS-SD meta-query. Its answers are service types, not services. */
export const SERVICE_TYPES_QUERY = '_services._dns-sd._udp';

export type MdnsBrowseError = { type: string; code?: number; message: string };

export type MdnsBrowseStats = {
  /** Every type that was browsed (known list + ones the meta-query reported). */
  typesBrowsed: string[];
  /** Types the meta-query reported. */
  typesDiscovered: string[];
  /** iOS: types the meta-query reported that aren't in NSBonjourServices, so they couldn't be browsed. */
  typesNotBrowsable: string[];
  /** Whether the meta-query ran without an error (on iOS it needs Apple's multicast entitlement). */
  metaQuery: 'ok' | 'failed';
};

export type MdnsBrowseOptions = {
  onService: (service: RawMdnsService) => void;
  onError?: (error: MdnsBrowseError) => void;
  isCancelled?: () => boolean;
  types?: readonly string[];
  durationMs?: number;
};

export function isMdnsAvailable(): boolean {
  return (Platform.OS === 'ios' || Platform.OS === 'android') && !!NetworkMdns;
}

/** "_googlecast._tcp." / "_googlecast._tcp.local." -> "_googlecast._tcp". */
export function cleanServiceType(type: string): string {
  return type.trim().replace(/\.$/, '').replace(/\.local$/i, '');
}

/** Waits ms, returning early (checked every 100 ms) once the scan is cancelled. */
async function waitUnlessCancelled(ms: number, isCancelled: () => boolean) {
  const end = Date.now() + ms;
  while (Date.now() < end && !isCancelled()) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, end - Date.now())));
  }
}

export async function browseMdns({
  onService,
  onError = () => {},
  isCancelled = () => false,
  types = MDNS_SERVICE_TYPES,
  durationMs = MDNS_BROWSE_MS,
}: MdnsBrowseOptions): Promise<MdnsBrowseStats> {
  if (!isMdnsAvailable()) throw new Error('mDNS is not available in this build');
  const module = NetworkMdns!;
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const knownTypes = types.map((name) => `_${name}._tcp`);
  // iOS can only browse what the build declares in NSBonjourServices (kept in sync with MDNS_SERVICE_TYPES).
  const browsable = (type: string) => platform === 'android' || knownTypes.includes(type);

  // browse id -> service type. Events for ids not in here (an earlier scan) are dropped.
  const browses = new Map<number, string>();
  const browsedTypes = new Set<string>();
  const stats: MdnsBrowseStats = { typesBrowsed: [], typesDiscovered: [], typesNotBrowsable: [], metaQuery: 'ok' };
  let metaBrowseId = -1;

  const browse = (type: string) => {
    if (browsedTypes.has(type) || isCancelled()) return;
    browsedTypes.add(type);
    const browseId = module.startBrowse(`${type}.`);
    browses.set(browseId, type);
    console.log(`[NetworkScan][mDNS] browse started: ${type} (browseId ${browseId})`);
  };

  const subscriptions = [
    module.addListener('onResolved', (s) => {
      const type = browses.get(s.browseId);
      if (!type || isCancelled()) return;
      console.log(
        `[NetworkScan] mDNS service discovered: ${type} "${s.name}" host=${s.host || '-'} port=${s.port} ` +
          `addresses=${s.addresses.join(',') || '-'} txt=${JSON.stringify(s.txt)}`
      );
      onService({
        platform,
        type,
        name: s.name,
        fullName: s.fullName,
        host: s.host,
        port: s.port,
        addresses: s.addresses,
        txt: s.txt,
      });
    }),
    module.addListener('onServiceType', (e) => {
      if (e.browseId !== metaBrowseId || isCancelled()) return;
      const type = cleanServiceType(e.serviceType);
      if (!/^_[^.]+\._(tcp|udp)$/.test(type) || stats.typesDiscovered.includes(type)) return;
      stats.typesDiscovered.push(type);
      if (!browsable(type)) {
        stats.typesNotBrowsable.push(type);
        console.log(`[NetworkScan] mDNS type on network: ${type} (not browsable on iOS: not in NSBonjourServices)`);
        return;
      }
      console.log(
        `[NetworkScan] mDNS type on network: ${type}${browsedTypes.has(type) ? ' (already browsing)' : ' -> browsing'}`
      );
      browse(type);
    }),
    module.addListener('onError', (e) => {
      if (e.browseId === metaBrowseId) {
        // Expected on iOS without the multicast entitlement; the known types are still browsed.
        stats.metaQuery = 'failed';
        console.log(`[NetworkScan] mDNS meta-query (${SERVICE_TYPES_QUERY}) unavailable: ${e.message} (${e.code})`);
        return;
      }
      const type = browses.get(e.browseId);
      console.log(`[NetworkScan][mDNS] browse error: ${type ?? `browseId ${e.browseId}`} ${e.message} (${e.code})`);
      if (type) onError({ type, code: e.code, message: e.message });
    }),
  ];

  try {
    console.log(`[NetworkScan] mDNS started: browsing ${knownTypes.join(', ')} + ${SERVICE_TYPES_QUERY}`);
    knownTypes.forEach(browse);
    metaBrowseId = module.startBrowse(`${SERVICE_TYPES_QUERY}.`);
    await waitUnlessCancelled(durationMs, isCancelled);
  } finally {
    console.log(`[NetworkScan][mDNS] stopping ${browses.size} browses + meta-query`);
    if (metaBrowseId !== -1) module.stopBrowse(metaBrowseId);
    for (const browseId of browses.keys()) module.stopBrowse(browseId);
    subscriptions.forEach((s) => s.remove());
  }

  stats.typesBrowsed = [...browsedTypes];
  console.log(
    `[NetworkScan] mDNS finished: browsed ${stats.typesBrowsed.length} types, meta-query ${stats.metaQuery}, ` +
      `discovered types [${stats.typesDiscovered.join(', ')}]` +
      (stats.typesNotBrowsable.length ? `, not browsable on iOS [${stats.typesNotBrowsable.join(', ')}]` : '')
  );
  return stats;
}
