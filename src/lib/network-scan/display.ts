import { DiscoveredDevice } from './types';

export const NOT_AVAILABLE = 'Not available';

export type DisplayField = { label: string; value: string };

const SOURCE_LABELS = { mdns: 'mDNS', ssdp: 'SSDP' } as const;

export function foundViaLabel(device: Pick<DiscoveredDevice, 'sources'>): string {
  if (device.sources.length > 1) return 'Both';
  return device.sources[0] ? SOURCE_LABELS[device.sources[0]] : NOT_AVAILABLE;
}

export function displayName(device: Pick<DiscoveredDevice, 'name' | 'hostname' | 'ip'>): string {
  return device.name ?? device.hostname ?? device.ip ?? 'Unnamed device';
}

/** The network-reported fields shown on each card. Missing values show as "Not available". */
export function displayFields(device: DiscoveredDevice): DisplayField[] {
  const or = (value: string | undefined) => (value ? value : NOT_AVAILABLE);
  return [
    { label: 'IP', value: or(device.ip) },
    { label: 'Host', value: or(device.hostname) },
    { label: 'MAC', value: or(device.mac?.toUpperCase()) },
    { label: 'Manufacturer', value: or(device.manufacturer) },
    { label: 'Model', value: or(device.model) },
    { label: 'Port', value: device.ports.length ? device.ports.join(', ') : NOT_AVAILABLE },
    { label: 'Services', value: device.services.length ? device.services.join(', ') : NOT_AVAILABLE },
    { label: 'Found via', value: foundViaLabel(device) },
  ];
}
