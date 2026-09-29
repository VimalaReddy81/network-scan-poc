import { Platform } from 'react-native';

import NetworkSsdp from '../../../modules/network-ssdp';
import { SSDP_DESCRIPTION_TIMEOUT_MS, SSDP_ENABLED_ON_IOS, SSDP_MX_SECONDS, SSDP_SEARCH_MS } from './config';
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
 * Sends one M-SEARCH (ssdp:all) to 239.255.255.250:1900, then reads each device's
 * description for its friendly name, manufacturer and model. Calls onDevice per device.
 */
export async function scanSsdp(
  onDevice: (device: DiscoveredDevice) => void,
  isCancelled: () => boolean = () => false
): Promise<void> {
  if (!NetworkSsdp) throw new Error('SSDP is not available in this build');

  const raw = await NetworkSsdp.search(SSDP_SEARCH_MS, 'ssdp:all', SSDP_MX_SECONDS);
  if (isCancelled()) return;

  const replies = dedupeReplies(raw.map((r) => ({ ip: r.ip, headers: parseSsdpHeaders(r.message) })));
  const seenAt = Date.now();

  await Promise.all(
    replies.map(async (reply) => {
      const description = canFetchDescription(reply) ? await fetchDescription(reply.headers.location) : {};
      if (!isCancelled()) onDevice(normalizeSsdp(reply, description, seenAt));
    })
  );
}
