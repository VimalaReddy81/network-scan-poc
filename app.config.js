// Extends app.json with the network-discovery settings.
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    bundleIdentifier: 'com.example.networkscanpoc',
    infoPlist: {
      ...config.ios?.infoPlist,
      // Text shown in the iOS "Local Network" permission prompt (iOS 14+).
      NSLocalNetworkUsageDescription:
        'Network Scan POC looks for devices and services on your Wi-Fi network.',
      // iOS only lets the app browse the Bonjour types listed here.
      // Keep in sync with MDNS_SERVICE_TYPES in src/lib/network-scan/config.ts.
      NSBonjourServices: [
        '_googlecast._tcp',
        '_airplay._tcp',
        '_raop._tcp',
        '_http._tcp',
        '_https._tcp',
        '_sonos._tcp',
        '_ipp._tcp',
        '_printer._tcp',
        '_hap._tcp',
        '_spotify-connect._tcp',
        '_smb._tcp',
        // DNS-SD meta-query (lists every service type). iOS also needs the multicast entitlement for it.
        '_services._dns-sd._udp',
      ],
      // Allow plain-HTTP requests to LAN devices (UPnP description XML).
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
    // SSDP sends multicast, which iOS 14+ only allows with this Apple-approved entitlement.
    // Request it at https://developer.apple.com/contact/request/networking-multicast, then uncomment:
    // entitlements: { 'com.apple.developer.networking.multicast': true },
    // and set SSDP_ENABLED_ON_IOS = true in src/lib/network-scan/config.ts.
  },
  android: {
    ...config.android,
    package: 'com.example.networkscanpoc',
    permissions: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.ACCESS_WIFI_STATE',
      // Lets the libraries hold a MulticastLock so mDNS/SSDP packets are received on Wi-Fi.
      'android.permission.CHANGE_WIFI_MULTICAST_STATE',
    ],
  },
  plugins: [
    ...(config.plugins ?? []),
    // Allow plain-HTTP requests to LAN devices (UPnP description XML).
    ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
    // iOS 27 SDK refuses to launch apps without the UIScene life cycle.
    './plugins/with-scene-lifecycle',
  ],
});
