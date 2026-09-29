export type DiscoverySource = 'mdns' | 'ssdp';

// Ranked strongest first. See fingerprint.ts.
export type IdentityKind = 'udn' | 'mac' | 'castid' | 'host' | 'ip';

/** "kind:value", e.g. "udn:uuid:rincon_b8e937000001400" or "ip:192.168.1.20". Values are lowercase. */
export type IdentityKey = `${IdentityKind}:${string}`;

/**
 * One device on the network, as the network reports it. Every field is only set when a device
 * reported it (or it was derived from what the device reported). Nothing is guessed here.
 */
export type DiscoveredDevice = {
  /** The strongest identity key; stable across scans when the device advertises a udn/mac/castid. */
  id: IdentityKey;
  /** All identity keys, strongest first. */
  identityKeys: IdentityKey[];
  name?: string;
  ip?: string;
  /** mDNS host name, e.g. "living-room.local". */
  hostname?: string;
  /** Only when the device advertises it itself (Sonos RINCON id, AirPlay deviceid, RAOP name). */
  mac?: string;
  manufacturer?: string;
  model?: string;
  /** UPnP UDN, e.g. "uuid:RINCON_B8E937000001400". */
  udn?: string;
  /** Google Cast id (TXT "id"), lowercase hex without dashes. */
  castId?: string;
  /** mDNS service types ("_googlecast._tcp") and UPnP device types. */
  services: string[];
  ports: number[];
  sources: DiscoverySource[];
  /** Epoch ms of the scan result this device came from. */
  lastSeenAt: number;
};

/** A device the home already has (saved via "Add to Home"). */
export type KnownDevice = {
  id: string;
  homeId: string;
  name: string;
  identityKeys: IdentityKey[];
  manufacturer?: string;
  model?: string;
  deviceType?: DeviceType;
  roomName?: string;
  /** True once the user has confirmed (or assigned) the room. A confirmed room is never replaced by a suggestion. */
  roomConfirmed: boolean;
  lastIp?: string;
  addedAt: number;
  lastSeenAt?: number;
};

export type DeviceType =
  | 'Speaker'
  | 'Media Streamer'
  | 'TV'
  | 'Control System'
  | 'Lighting'
  | 'Printer'
  | 'Router'
  | 'Network Storage'
  | 'Camera'
  | 'Thermostat'
  | 'Unknown';

export type Identification = {
  manufacturer: string;
  deviceType: DeviceType;
  /** Why the rule matched, e.g. "Advertises _sonos._tcp". */
  reasons: string[];
};

export type RoomSuggestion = { roomName: string; source: 'name' | 'hostname' | 'known' };

export type ConfidenceTier = 'hi' | 'md' | 'lo';

export type Confidence = { score: number; tier: ConfidenceTier; reasons: string[] };

/**
 * A device as the home sees it: a scan result, a known device, or both.
 * A known device that didn't answer is "not-seen", never "offline": a scan is a best guess, not a live status.
 */
export type HomeDevice = {
  key: string;
  status: 'seen' | 'not-seen';
  discovered?: DiscoveredDevice;
  known?: KnownDevice;
  identification: Identification;
  room?: RoomSuggestion;
  confidence: Confidence;
};
