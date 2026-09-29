import { NativeModules, Platform } from 'react-native';

import NetworkMdns from '../../../modules/network-mdns';
import { MDNS_SERVICE_TYPES, MDNS_TOTAL_BUDGET_MS } from './config';
import { RawMdnsService } from './normalize-mdns';

// One interface over both platforms:
// - iOS: modules/network-mdns (Apple's Bonjour API). react-native-zeroconf doesn't deliver
//   events on iOS under the New Architecture and can crash, so it isn't linked on iOS.
// - Android: react-native-zeroconf with its DNSSD implementation.

export type MdnsBrowseError = { type: string; code?: number; message: string };

export type MdnsBrowseOptions = {
  onService: (service: RawMdnsService) => void;
  onError?: (error: MdnsBrowseError) => void;
  isCancelled?: () => boolean;
  types?: readonly string[];
  totalBudgetMs?: number;
};

type Browser = {
  browse(type: string, onService: (s: RawMdnsService) => void, onError: (e: MdnsBrowseError) => void): void;
  stop(): void;
  dispose(): void;
};

export function isMdnsAvailable(): boolean {
  if (Platform.OS === 'ios') return !!NetworkMdns;
  if (Platform.OS === 'android') return !!NativeModules.RNZeroconf;
  return false;
}

function iosBrowser(): Browser {
  const module = NetworkMdns!;
  let browseId = -1;
  let subscriptions: { remove(): void }[] = [];
  const removeListeners = () => {
    subscriptions.forEach((s) => s.remove());
    subscriptions = [];
  };

  return {
    browse(type, onService, onError) {
      removeListeners();
      subscriptions = [
        module.addListener('onResolved', (s) => {
          if (s.browseId !== browseId) return;
          onService({
            platform: 'ios',
            type,
            name: s.name,
            fullName: s.fullName,
            host: s.host,
            port: s.port,
            addresses: s.addresses,
            txt: s.txt,
          });
        }),
        module.addListener('onError', (e) => {
          if (e.browseId === browseId) onError({ type, code: e.code, message: e.message });
        }),
      ];
      browseId = module.startBrowse(`${type}.`);
    },
    stop() {
      module.stopBrowse();
      browseId = -1;
    },
    dispose() {
      module.stopBrowse();
      removeListeners();
    },
  };
}

function androidBrowser(): Browser {
  // Required lazily so iOS (where the native side isn't linked) never loads it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Zeroconf = require('react-native-zeroconf').default;
  const zeroconf = new Zeroconf();
  let current: { type: string; onService: (s: RawMdnsService) => void; onError: (e: MdnsBrowseError) => void } | null =
    null;

  zeroconf.on('resolved', (s: any) => {
    if (!current) return;
    current.onService({
      platform: 'android',
      type: current.type,
      name: s.name,
      fullName: s.fullName,
      host: s.host,
      port: typeof s.port === 'number' ? s.port : undefined,
      addresses: s.addresses ?? [],
      txt: s.txt ?? {},
    });
  });
  zeroconf.on('error', (error: unknown) => {
    current?.onError({ type: current.type, message: String((error as Error)?.message ?? error) });
  });

  return {
    browse(type, onService, onError) {
      current = { type, onService, onError };
      const [, name, protocol] = type.match(/^_([^.]+)\._(tcp|udp)$/) ?? [];
      zeroconf.scan(name, protocol, 'local.', 'DNSSD');
    },
    stop() {
      current = null;
      zeroconf.stop('DNSSD');
    },
    dispose() {
      current = null;
      zeroconf.stop('DNSSD');
      zeroconf.removeDeviceListeners();
      zeroconf.removeAllListeners();
    },
  };
}

/** Waits ms, returning early (checked every 100 ms) once the scan is cancelled. */
async function waitUnlessCancelled(ms: number, isCancelled: () => boolean) {
  const end = Date.now() + ms;
  while (Date.now() < end && !isCancelled()) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, end - Date.now())));
  }
}

/**
 * Browses each service type one after another (both platforms run one browse at a time).
 * The types share one budget: 15 s over 6 types is ~2.5 s each.
 */
export async function browseMdns({
  onService,
  onError = () => {},
  isCancelled = () => false,
  types = MDNS_SERVICE_TYPES,
  totalBudgetMs = MDNS_TOTAL_BUDGET_MS,
}: MdnsBrowseOptions): Promise<void> {
  if (!isMdnsAvailable()) throw new Error('mDNS is not available in this build');

  const browser = Platform.OS === 'ios' ? iosBrowser() : androidBrowser();
  const perTypeMs = Math.floor(totalBudgetMs / types.length);
  try {
    for (const name of types) {
      if (isCancelled()) break;
      browser.browse(`_${name}._tcp`, onService, onError);
      await waitUnlessCancelled(perTypeMs, isCancelled);
      browser.stop();
    }
  } finally {
    browser.dispose();
  }
}
