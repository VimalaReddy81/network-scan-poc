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

export type NativeMdnsError = { browseId: number; type: string; code: number; message: string };

type Events = {
  onResolved(service: NativeMdnsService): void;
  onError(error: NativeMdnsError): void;
};

declare class NetworkMdnsModule extends NativeModule<Events> {
  /** Starts browsing one Bonjour type (e.g. "_googlecast._tcp."), stopping any previous browse. Returns the browse id. */
  startBrowse(type: string): number;
  stopBrowse(): void;
}

// iOS only. null in builds made before this module was added (and on Android/web).
export default requireOptionalNativeModule<NetworkMdnsModule>('NetworkMdns');
