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
export const MDNS_SERVICE_TYPES = ['googlecast', 'airplay', 'raop', 'http', 'https', 'sonos'] as const;

/** Shared by all mDNS service types, which are browsed one after another (~2.5 s each). */
export const MDNS_TOTAL_BUDGET_MS = 15_000;

export const SSDP_SEARCH_MS = 3_000;
export const SSDP_MX_SECONDS = 2;
export const SSDP_DESCRIPTION_TIMEOUT_MS = 2_000;
