import { scoreConfidence } from './confidence';
import { IDENTITY_RANK, keysConflict, kindOf } from './fingerprint';
import { identify, UNKNOWN } from './identify';
import { suggestRoom } from './room';
import { DiscoveredDevice, HomeDevice, Identification, KnownDevice } from './types';

/**
 * The known device this scan result is, or undefined. Matches on the strongest shared identity key;
 * a known device whose strong keys (udn/mac/castid) contradict the result is never matched,
 * even at the same IP (the IP was handed to another device).
 */
export function matchKnown(device: DiscoveredDevice, known: KnownDevice[]): KnownDevice | undefined {
  let best: { known: KnownDevice; rank: number } | undefined;
  for (const candidate of known) {
    if (keysConflict(device.identityKeys, candidate.identityKeys)) continue;
    const shared = device.identityKeys.filter((k) => candidate.identityKeys.includes(k));
    if (shared.length === 0) continue;
    const rank = Math.min(...shared.map((k) => IDENTITY_RANK[kindOf(k)]));
    if (!best || rank < best.rank) best = { known: candidate, rank };
  }
  return best?.known;
}

function identificationOf(discovered: DiscoveredDevice | undefined, known: KnownDevice | undefined): Identification {
  if (discovered) return identify(discovered);
  return {
    manufacturer: known?.manufacturer ?? UNKNOWN,
    deviceType: known?.deviceType ?? 'Unknown',
    reasons: ['Saved in this home'],
  };
}

function build(discovered: DiscoveredDevice | undefined, known: KnownDevice | undefined): HomeDevice {
  const identification = identificationOf(discovered, known);
  // A confirmed room always wins over a suggestion from the name.
  const room =
    known?.roomName && known.roomConfirmed
      ? { roomName: known.roomName, source: 'known' as const }
      : (discovered && suggestRoom(discovered)) ??
        (known?.roomName ? { roomName: known.roomName, source: 'known' as const } : undefined);

  return {
    key: known?.id ?? discovered!.id,
    status: discovered ? 'seen' : 'not-seen',
    discovered,
    known,
    identification,
    room,
    confidence: scoreConfidence({ discovered, known, identification, room }),
  };
}

/**
 * Scan results joined with the home's known devices. Known devices that didn't answer come last,
 * marked "not-seen" (never "offline": a missing reply is not proof a device is off).
 */
export function enrich(discovered: DiscoveredDevice[], known: KnownDevice[]): HomeDevice[] {
  const matchedIds = new Set<string>();
  const seen = discovered.map((device) => {
    const match = matchKnown(device, known.filter((k) => !matchedIds.has(k.id)));
    if (match) matchedIds.add(match.id);
    return build(device, match);
  });
  const notSeen = known.filter((k) => !matchedIds.has(k.id)).map((k) => build(undefined, k));
  return [...seen, ...notSeen];
}
