import { identityKeys, macFromSonosId } from './fingerprint';
import { DiscoveredDevice } from './types';

export type SsdpHeaders = Record<string, string>;

export type UpnpDescription = {
  friendlyName?: string;
  manufacturer?: string;
  modelName?: string;
  modelNumber?: string;
  deviceType?: string;
  udn?: string;
};

/** "LOCATION: http://..." -> { location: "http://..." }. Header names are lowercased. */
export function parseSsdpHeaders(message: string): SsdpHeaders {
  const headers: SsdpHeaders = {};
  for (const line of message.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

/** "uuid:abc::urn:schemas-upnp-org:device:X:1" -> "uuid:abc". */
export function udnFromUsn(usn: string | undefined): string | undefined {
  const udn = usn?.split('::')[0]?.trim();
  return udn?.toLowerCase().startsWith('uuid:') ? udn : undefined;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** The root <device> element, without its embedded <deviceList> (whose tags describe sub-devices). */
function rootDeviceXml(xml: string): string {
  const start = xml.search(/<(\w+:)?device[\s>]/i);
  if (start < 0) return '';
  const body = xml.slice(start);
  const end = body.search(/<(\w+:)?deviceList[\s>]/i);
  return end < 0 ? body : body.slice(0, end);
}

function tag(xml: string, name: string): string | undefined {
  // Tolerates a namespace prefix and attributes: <ns:friendlyName attr="x">.
  const match = xml.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i'));
  const value = match ? decodeXml(match[1]).trim() : '';
  return value || undefined;
}

/** Reads the root device of a UPnP description file. No XML library needed for these few tags. */
export function parseUpnpDescription(xml: string): UpnpDescription {
  const device = rootDeviceXml(xml);
  return {
    friendlyName: tag(device, 'friendlyName'),
    manufacturer: tag(device, 'manufacturer'),
    modelName: tag(device, 'modelName'),
    modelNumber: tag(device, 'modelNumber'),
    deviceType: tag(device, 'deviceType'),
    udn: tag(device, 'UDN'),
  };
}

export function portFromUrl(url: string | undefined): number | undefined {
  const match = url?.match(/^\w+:\/\/(?:\[[^\]]+\]|[^/:]+):(\d+)/);
  return match ? Number(match[1]) : undefined;
}

export function hostFromUrl(url: string | undefined): string | undefined {
  return url?.match(/^\w+:\/\/(\[[^\]]+\]|[^/:]+)/)?.[1];
}

export function normalizeSsdp(
  reply: { ip: string; headers: SsdpHeaders },
  description: UpnpDescription = {},
  seenAt = Date.now()
): DiscoveredDevice {
  const udn = description.udn ?? udnFromUsn(reply.headers.usn);
  const partial = {
    name: description.friendlyName,
    ip: reply.ip,
    // Sonos UDNs embed the MAC ("uuid:RINCON_B8E937AABBCC01400").
    mac: macFromSonosId(udn),
    manufacturer: description.manufacturer,
    model: description.modelName ?? description.modelNumber,
    udn,
  };
  const keys = identityKeys(partial);
  const service = description.deviceType ?? reply.headers.nt ?? reply.headers.st;
  const port = portFromUrl(reply.headers.location);

  return {
    ...partial,
    id: keys[0],
    identityKeys: keys,
    services: service ? [service] : ['upnp'],
    ports: port ? [port] : [],
    sources: ['ssdp'],
    lastSeenAt: seenAt,
  };
}
