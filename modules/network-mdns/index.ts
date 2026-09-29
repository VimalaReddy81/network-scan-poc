import { NativeModule, requireOptionalNativeModule } from 'expo';

export type NativeMdnsService = {
  browseId: number;
  type: string;
  name: string;
  domain: string;
  fullName: string;
  host: string;
  port: number;
  addresses: string[];
  txt: Record<string, string>;
};

/** One answer to the DNS-SD meta-query (_services._dns-sd._udp): a service type present on the network. */
export type NativeMdnsServiceType = { browseId: number; serviceType: string };

export type NativeMdnsError = { browseId: number; type: string; code: number; message: string };

type Events = {
  onResolved(service: NativeMdnsService): void;
  onServiceType(event: NativeMdnsServiceType): void;
  onError(error: NativeMdnsError): void;
};

declare class NetworkMdnsModule extends NativeModule<Events> {
  /**
   * Starts browsing one DNS-SD type (e.g. "_googlecast._tcp."). Several can run at once. Returns the browse id.
   * "_services._dns-sd._udp." is the meta-query: it reports types (onServiceType), not services.
   */
  startBrowse(type: string): number;
  stopBrowse(browseId: number): void;
  stopAll(): void;
}

// iOS: Apple's Bonjour API. Android: the system NsdManager.
// null in builds made before this module was added (and on web).
export default requireOptionalNativeModule<NetworkMdnsModule>('NetworkMdns');
