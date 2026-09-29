import { NativeModule, requireOptionalNativeModule } from 'expo';

export type NativeSsdpReply = { ip: string; port: number; message: string };

export type NativeSsdpResult = {
  replies: NativeSsdpReply[];
  /** How many M-SEARCH packets went out. */
  sent: number;
  /** Android: the Wi-Fi interface the search was sent on (e.g. "wlan0"). */
  interfaceName?: string | null;
};

declare class NetworkSsdpModule extends NativeModule {
  /** Sends M-SEARCH for each target (repeated, since UDP drops packets) and collects replies for timeoutMs. */
  search(timeoutMs: number, searchTargets: string[], mx: number): Promise<NativeSsdpResult>;
}

// null in builds made before this module was added (and on web).
export default requireOptionalNativeModule<NetworkSsdpModule>('NetworkSsdp');
