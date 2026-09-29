import { DeviceType, DiscoveredDevice, Identification } from './types';

type Rule = {
  manufacturer: string;
  deviceType: DeviceType;
  /** Matched against the reported manufacturer. */
  manufacturerPattern?: RegExp;
  /** Matched against the reported model. */
  modelPattern?: RegExp;
  /** Matched against the name and host name. */
  namePattern?: RegExp;
  /** Any advertised service type that marks this kind of device. */
  services?: string[];
};

// Ordered: the first matching rule wins. Specific brands come before generic protocols.
const RULES: Rule[] = [
  { manufacturer: 'Sonos', deviceType: 'Speaker', manufacturerPattern: /sonos/i, services: ['_sonos._tcp'], namePattern: /\bsonos\b/i },
  { manufacturer: 'Crestron', deviceType: 'Control System', manufacturerPattern: /crestron/i, namePattern: /crestron/i },
  { manufacturer: 'Control4', deviceType: 'Control System', manufacturerPattern: /control4/i, namePattern: /control4/i },
  { manufacturer: 'Savant', deviceType: 'Control System', manufacturerPattern: /savant/i },
  { manufacturer: 'Lutron', deviceType: 'Lighting', manufacturerPattern: /lutron/i, namePattern: /lutron/i },
  { manufacturer: 'Philips Hue', deviceType: 'Lighting', manufacturerPattern: /signify|philips/i, modelPattern: /hue/i, namePattern: /philips hue|hue bridge/i },
  { manufacturer: 'Roku', deviceType: 'Media Streamer', manufacturerPattern: /roku/i, namePattern: /\broku\b/i },
  { manufacturer: 'Samsung', deviceType: 'TV', manufacturerPattern: /samsung/i, modelPattern: /tv|^[uq]n\d/i },
  { manufacturer: 'LG', deviceType: 'TV', manufacturerPattern: /^lg/i, modelPattern: /tv|webos|oled/i },
  { manufacturer: 'Sony', deviceType: 'TV', manufacturerPattern: /sony/i, modelPattern: /bravia|kd-|xr-/i },
  { manufacturer: 'Denon', deviceType: 'Speaker', manufacturerPattern: /denon|marantz|d&m/i },
  { manufacturer: 'Ecobee', deviceType: 'Thermostat', manufacturerPattern: /ecobee/i },
  { manufacturer: 'Synology', deviceType: 'Network Storage', manufacturerPattern: /synology/i, namePattern: /synology|diskstation/i },
  { manufacturer: 'Apple', deviceType: 'Media Streamer', modelPattern: /^appletv/i, namePattern: /apple tv/i },
  { manufacturer: 'Apple', deviceType: 'Speaker', modelPattern: /^audioaccessory|^homepod/i, namePattern: /homepod/i },
  { manufacturer: 'Google', deviceType: 'Speaker', manufacturerPattern: /google/i, modelPattern: /home|nest (audio|mini|hub)/i },
  { manufacturer: 'Google', deviceType: 'Media Streamer', manufacturerPattern: /google/i, modelPattern: /chromecast|google tv/i },
  { manufacturer: 'HP', deviceType: 'Printer', manufacturerPattern: /^hp$|hewlett/i },
  { manufacturer: 'Epson', deviceType: 'Printer', manufacturerPattern: /epson/i },
  { manufacturer: 'Brother', deviceType: 'Printer', manufacturerPattern: /brother/i },
  { manufacturer: 'Netgear', deviceType: 'Router', manufacturerPattern: /netgear/i },
  { manufacturer: 'Ubiquiti', deviceType: 'Router', manufacturerPattern: /ubiquiti|ubnt/i },
];

// Protocol-only fallbacks: they say what a device does, not who made it.
const SERVICE_FALLBACKS: { service: string; deviceType: DeviceType; reason: string }[] = [
  { service: '_googlecast._tcp', deviceType: 'Media Streamer', reason: 'Supports Google Cast' },
  { service: '_airplay._tcp', deviceType: 'Media Streamer', reason: 'Supports AirPlay' },
  { service: '_raop._tcp', deviceType: 'Speaker', reason: 'Supports AirPlay audio' },
  { service: 'urn:schemas-upnp-org:device:MediaRenderer:1', deviceType: 'Media Streamer', reason: 'UPnP media renderer' },
  { service: 'urn:schemas-upnp-org:device:InternetGatewayDevice:1', deviceType: 'Router', reason: 'UPnP internet gateway' },
];

export const UNKNOWN = 'Unknown';

/** Manufacturer and device type from what the device reported. Falls back to "Unknown". */
export function identify(device: DiscoveredDevice): Identification {
  const names = [device.name, device.hostname].filter(Boolean).join(' ');

  for (const rule of RULES) {
    const manufacturerMatches =
      !!rule.manufacturerPattern && !!device.manufacturer && rule.manufacturerPattern.test(device.manufacturer);
    const modelMatches = !!rule.modelPattern && !!device.model && rule.modelPattern.test(device.model);
    const service = rule.services?.find((s) => device.services.includes(s));
    const nameMatches = !!rule.namePattern && !!names && rule.namePattern.test(names);

    // When a rule has a model pattern, the manufacturer alone isn't enough
    // (a Samsung phone isn't a TV; a Google device could be a speaker or a streamer).
    const byManufacturer = manufacturerMatches && (!rule.modelPattern || modelMatches);
    // A model pattern only counts alone for rules without a manufacturer pattern ("AppleTV14,1" must not
    // match Samsung's /tv/).
    const byModel = modelMatches && !rule.manufacturerPattern;
    if (!byManufacturer && !byModel && !service && !nameMatches) continue;

    const reasons: string[] = [];
    if (manufacturerMatches) reasons.push(`Reports manufacturer "${device.manufacturer}"`);
    if (modelMatches) reasons.push(`Reports model "${device.model}"`);
    if (service) reasons.push(`Advertises ${service}`);
    if (nameMatches) reasons.push(`Named "${names}"`);
    return { manufacturer: rule.manufacturer, deviceType: rule.deviceType, reasons };
  }

  const fallback = SERVICE_FALLBACKS.find((f) => device.services.includes(f.service));
  return {
    manufacturer: device.manufacturer ?? UNKNOWN,
    deviceType: fallback?.deviceType ?? 'Unknown',
    reasons: [
      ...(device.manufacturer ? [`Reports manufacturer "${device.manufacturer}"`] : []),
      ...(fallback ? [fallback.reason] : []),
    ],
  };
}
