import { Platform } from 'react-native';

import NetworkSsdp from '../../../modules/network-ssdp';
import {
  SSDP_DESCRIPTION_TIMEOUT_MS,
  SSDP_ENABLED_ON_IOS,
  SSDP_MX_SECONDS,
  SSDP_SEARCH_MS,
  SSDP_SEARCH_TARGETS,
} from './config';
import {
  hostFromUrl,
  normalizeSsdp,
  parseSsdpHeaders,
  parseUpnpDescription,
  SsdpHeaders,
  udnFromUsn,
  UpnpDescription,
} from './normalize-ssdp';
import { DiscoveredDevice } from './types';

export type SsdpReply = { ip: string; headers: SsdpHeaders };

/** What a search did, for the on-screen diagnostics. */
export type SsdpScanStats = { sent: number; replies: number; devices: number; interfaceName?: string };

export type SsdpAvailability = 'available' | 'disabled-on-ios' | 'unavailable';

/** Whether this build/platform can run an SSDP search. */
export function ssdpAvailability(): SsdpAvailability {
  if (Platform.OS === 'ios' && !SSDP_ENABLED_ON_IOS) return 'disabled-on-ios';
  if (Platform.OS === 'web' || !NetworkSsdp) return 'unavailable';
  return 'available';
}

/**
 * A device answers once per service it offers. Keep one reply per device: by UDN (from USN),
 * else by LOCATION, else by IP. The first reply with a LOCATION wins.
 */
export function dedupeReplies(replies: SsdpReply[]): SsdpReply[] {
  const byDevice = new Map<string, SsdpReply>();
  for (const reply of replies) {
    const key =
      udnFromUsn(reply.headers.usn)?.toLowerCase() ?? reply.headers.location ?? `ip:${reply.ip}`;
    const existing = byDevice.get(key);
    if (!existing || (!existing.headers.location && reply.headers.location)) byDevice.set(key, reply);
  }
  return [...byDevice.values()];
}

/**
 * Only fetch a description from the IP that replied: a LOCATION pointing anywhere else
 * (another host, the internet) is ignored.
 */
export function canFetchDescription(reply: SsdpReply): boolean {
  const location = reply.headers.location;
  return !!location && /^http:\/\//i.test(location) && hostFromUrl(location) === reply.ip;
}

export async function fetchDescription(
  location: string,
  timeoutMs = SSDP_DESCRIPTION_TIMEOUT_MS
): Promise<UpnpDescription> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(location, { signal: controller.signal });
    if (!response.ok) return {};
    return parseUpnpDescription(await response.text());
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends M-SEARCH (ssdp:all and upnp:rootdevice, each repeated) to 239.255.255.250:1900, then reads
 * each device's description for its friendly name, manufacturer and model. Calls onDevice per device.
 */
export async function scanSsdp(
  onDevice: (device: DiscoveredDevice) => void,
  isCancelled: () => boolean = () => false
): Promise<SsdpScanStats> {
  if (!NetworkSsdp) throw new Error('SSDP is not available in this build');

  console.log(
    `[NetworkScan][SSDP] searching ${SSDP_SEARCH_TARGETS.join(', ')} -> 239.255.255.250:1900 (${SSDP_SEARCH_MS} ms, MX ${SSDP_MX_SECONDS})`
  );
  const result = await NetworkSsdp.search(SSDP_SEARCH_MS, SSDP_SEARCH_TARGETS, SSDP_MX_SECONDS);
  console.log(
    `[NetworkScan][SSDP] sent ${result.sent} requests on ${result.interfaceName ?? 'default network'}, ` +
      `received ${result.replies.length} UDP responses`
  );
  for (const r of result.replies) {
    const h = parseSsdpHeaders(r.message);
    console.log(
      `[NetworkScan][SSDP] response from ${r.ip}:${r.port} ST=${h.st ?? '-'} USN=${h.usn ?? '-'} ` +
        `SERVER=${h.server ?? '-'} LOCATION=${h.location ?? '-'}`
    );
  }
  const replies = dedupeReplies(
    result.replies.map((r) => ({ ip: r.ip, headers: parseSsdpHeaders(r.message) }))
  );
  const stats: SsdpScanStats = {
    sent: result.sent,
    replies: result.replies.length,
    devices: replies.length,
    interfaceName: result.interfaceName ?? undefined,
  };
  if (isCancelled()) return stats;
  const seenAt = Date.now();

  await Promise.all(
    replies.map(async (reply) => {
      const fetchable = canFetchDescription(reply);
      const description = fetchable ? await fetchDescription(reply.headers.location) : {};
      console.log(
        `[NetworkScan][SSDP] description ${reply.ip}: ` +
          (fetchable ? JSON.stringify(description) : `not fetched (LOCATION=${reply.headers.location ?? '-'})`)
      );
      if (!isCancelled()) onDevice(normalizeSsdp(reply, description, seenAt));
    })
  );
  return stats;
}
