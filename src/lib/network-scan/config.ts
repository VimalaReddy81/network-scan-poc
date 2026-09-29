// Feature switches and timings for the network scan.

/**
 * Identification, room suggestions, confidence and known-device matching.
 * Off: the scan shows only what the network reports.
 */
export const HOME_INTELLIGENCE_ENABLED = false;

/**
 * iOS only lets an app send multicast with Apple's com.apple.developer.networking.multicast
 * entitlement. Until Apple grants it (and it's added in app.config.js), iOS scans are mDNS-only.
 */
export const SSDP_ENABLED_ON_IOS = false;

/** Keep in sync with NSBonjourServices in app.config.js (iOS only browses listed types). */
export const MDNS_SERVICE_TYPES = [
  'googlecast',
  'airplay',
  'raop',
  'http',
  'https',
  'sonos',
  'ipp',
  'printer',
  'hap',
  'spotify-connect',
  'smb',
] as const;

/** All service types are browsed at the same time for this long. */
export const MDNS_BROWSE_MS = 10_000;

export const SSDP_SEARCH_MS = 4_000;
export const SSDP_SEARCH_TARGETS = [
  'ssdp:all',
  'upnp:rootdevice',
  // LG webOS TVs don't always answer the generic searches above; these are the targets
  // LG's Connect SDK and Home Assistant search for.
  'urn:lge-com:service:webos-second-screen:1',
  'urn:dial-multiscreen-org:service:dial:1',
  'urn:schemas-upnp-org:device:MediaRenderer:1',
];
export const SSDP_MX_SECONDS = 2;
export const SSDP_DESCRIPTION_TIMEOUT_MS = 2_000;
