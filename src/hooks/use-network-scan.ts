import * as Network from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { browseMdns, isMdnsAvailable, MdnsBrowseError } from '@/lib/network-scan/mdns-browser';
import { mergeDevices } from '@/lib/network-scan/merge';
import { normalizeMdns } from '@/lib/network-scan/normalize-mdns';
import { scanSsdp, ssdpAvailability } from '@/lib/network-scan/ssdp-scan';
import { DiscoveredDevice } from '@/lib/network-scan/types';

export type WifiStatus = 'checking' | 'connected' | 'not-connected';
export type ScanPhase = 'idle' | 'scanning' | 'done' | 'stopped';
export type MethodStatus = 'idle' | 'running' | 'done' | 'failed' | 'unavailable' | 'disabled-on-ios';

export type NetworkScanState = {
  wifi: WifiStatus;
  phase: ScanPhase;
  mdns: MethodStatus;
  ssdp: MethodStatus;
  devices: DiscoveredDevice[];
  errors: string[];
  finishedAt?: number;
};

const initialState: NetworkScanState = {
  wifi: 'checking',
  phase: 'idle',
  mdns: 'idle',
  ssdp: 'idle',
  devices: [],
  errors: [],
};

async function checkWifi(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === true && state.type === Network.NetworkStateType.WIFI;
  } catch {
    return false;
  }
}

/** Readable text for the iOS Bonjour errors a user can act on. */
export function describeMdnsError(error: MdnsBrowseError): string {
  if (error.code === -72008) {
    return `This build is missing the Bonjour config for ${error.type} (NSBonjourServices). Rebuild the app.`;
  }
  if (error.code === -65570) {
    return 'Local Network access is turned off for this app. Turn it on in Settings → Privacy & Security → Local Network.';
  }
  return `mDNS ${error.type}: ${error.message}`;
}

/**
 * One-time scan of the home Wi-Fi while the screen is open (never in the background).
 * mDNS and SSDP run side by side; results are merged into one device per physical device.
 */
export function useNetworkScan() {
  const [state, setState] = useState<NetworkScanState>(initialState);
  // Bumped on every start/stop/unmount; a scan whose id is no longer current stops reporting.
  const runId = useRef(0);

  const update = useCallback((id: number, patch: (s: NetworkScanState) => Partial<NetworkScanState>) => {
    if (id !== runId.current) return;
    setState((s) => ({ ...s, ...patch(s) }));
  }, []);

  useEffect(() => {
    const id = runId.current;
    checkWifi().then((onWifi) => update(id, () => ({ wifi: onWifi ? 'connected' : 'not-connected' })));
    return () => {
      runId.current += 1;
    };
  }, [update]);

  const start = useCallback(async () => {
    const id = ++runId.current;
    const isCancelled = () => id !== runId.current;
    setState((s) => ({ ...s, wifi: 'checking' }));

    const onWifi = await checkWifi();
    update(id, () => ({ wifi: onWifi ? 'connected' : 'not-connected' }));
    if (isCancelled()) return;
    if (!onWifi) {
      Alert.alert('Wi-Fi Required', 'Connect this phone to your home Wi-Fi, then scan again.');
      return;
    }

    const ssdpState = ssdpAvailability();
    const mdnsAvailable = isMdnsAvailable();
    const found: DiscoveredDevice[] = [];
    const errors = new Set<string>();
    const addDevice = (device: DiscoveredDevice) => {
      found.push(device);
      update(id, () => ({ devices: mergeDevices(found) }));
    };
    const addError = (message: string) => {
      errors.add(message);
      update(id, () => ({ errors: [...errors] }));
    };

    setState({
      wifi: 'connected',
      phase: 'scanning',
      mdns: mdnsAvailable ? 'running' : 'unavailable',
      ssdp: ssdpState === 'available' ? 'running' : ssdpState,
      devices: [],
      errors: [],
    });
    if (!mdnsAvailable && ssdpState === 'unavailable') {
      addError('Network scanning is not available in this build. Install a new development build.');
    }

    const mdns = mdnsAvailable
      ? browseMdns({
          onService: (raw) => addDevice(normalizeMdns(raw)),
          onError: (error) => addError(describeMdnsError(error)),
          isCancelled,
        }).then(
          () => update(id, () => ({ mdns: 'done' })),
          (error) => {
            addError(`mDNS scan failed: ${String(error?.message ?? error)}`);
            update(id, () => ({ mdns: 'failed' }));
          }
        )
      : Promise.resolve();

    const ssdp =
      ssdpState === 'available'
        ? scanSsdp(addDevice, isCancelled).then(
            () => update(id, () => ({ ssdp: 'done' })),
            (error) => {
              addError(`SSDP scan failed: ${String(error?.message ?? error)}`);
              update(id, () => ({ ssdp: 'failed' }));
            }
          )
        : Promise.resolve();

    await Promise.all([mdns, ssdp]);
    update(id, () => ({ phase: 'done', finishedAt: Date.now() }));
  }, [update]);

  const stop = useCallback(() => {
    runId.current += 1;
    setState((s) =>
      s.phase === 'scanning'
        ? {
            ...s,
            phase: 'stopped',
            mdns: s.mdns === 'running' ? 'idle' : s.mdns,
            ssdp: s.ssdp === 'running' ? 'idle' : s.ssdp,
          }
        : s
    );
  }, []);

  return { ...state, isScanning: state.phase === 'scanning', start, stop };
}
