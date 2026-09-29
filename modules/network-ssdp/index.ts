import { NativeModule, requireOptionalNativeModule } from 'expo';

export type NativeSsdpReply = { ip: string; port: number; message: string };

declare class NetworkSsdpModule extends NativeModule {
  /** Sends one M-SEARCH and resolves with every reply received within timeoutMs. */
  search(timeoutMs: number, searchTarget: string, mx: number): Promise<NativeSsdpReply[]>;
}

// null in builds made before this module was added (and on web).
export default requireOptionalNativeModule<NetworkSsdpModule>('NetworkSsdp');
