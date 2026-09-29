import { kindOf } from './fingerprint';
import { Confidence, ConfidenceTier, DiscoveredDevice, Identification, KnownDevice, RoomSuggestion } from './types';

export const TIER_THRESHOLDS = { hi: 70, md: 40 } as const;

export function tierFor(score: number): ConfidenceTier {
  if (score >= TIER_THRESHOLDS.hi) return 'hi';
  if (score >= TIER_THRESHOLDS.md) return 'md';
  return 'lo';
}

/** Spec wording: "Probably" when confident, "Still learning" otherwise. */
export const TIER_LABELS: Record<ConfidenceTier, string> = {
  hi: 'Probably',
  md: 'Still learning',
  lo: 'Still learning',
};

type Input = {
  discovered?: DiscoveredDevice;
  known?: KnownDevice;
  identification: Identification;
  room?: RoomSuggestion;
};

/** 0-100 score for how sure we are what (and where) this device is, with the reasons. */
export function scoreConfidence({ discovered, known, identification, room }: Input): Confidence {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  const kinds = new Set((discovered?.identityKeys ?? known?.identityKeys ?? []).map(kindOf));
  if (kinds.has('udn') || kinds.has('mac')) add(30, 'Has a stable hardware id');
  else if (kinds.has('castid')) add(25, 'Has a stable Cast id');
  else if (kinds.has('host')) add(10, 'Has a host name');
  else if (kinds.has('ip')) add(5, 'Only identified by IP address');

  if (identification.manufacturer !== 'Unknown') add(20, `Made by ${identification.manufacturer}`);
  if (identification.deviceType !== 'Unknown') add(15, `Looks like a ${identification.deviceType.toLowerCase()}`);
  if (discovered?.model ?? known?.model) add(10, 'Reports its model');
  if (discovered && discovered.sources.length > 1) add(10, 'Found by both mDNS and SSDP');

  if (known?.roomConfirmed) add(15, `Room confirmed as ${known.roomName}`);
  else if (room) add(5, `Name suggests ${room.roomName}`);

  if (known && discovered) add(10, 'Matches a device already in this home');

  const clamped = Math.max(0, Math.min(100, score));
  return { score: clamped, tier: tierFor(clamped), reasons };
}
