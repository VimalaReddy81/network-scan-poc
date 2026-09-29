import { DiscoveredDevice, RoomSuggestion } from './types';

// Longer names first so "Master Bedroom" wins over "Bedroom" and "Family Room" over "Room".
const ROOMS = [
  'Master Bedroom',
  'Primary Bedroom',
  'Guest Bedroom',
  'Guest Room',
  'Living Room',
  'Family Room',
  'Dining Room',
  'Media Room',
  'Game Room',
  'Great Room',
  'Home Theater',
  'Laundry Room',
  'Sun Room',
  'Bedroom',
  'Kitchen',
  'Office',
  'Study',
  'Den',
  'Basement',
  'Garage',
  'Bathroom',
  'Patio',
  'Nursery',
  'Theater',
  'Loft',
  'Lounge',
  'Hallway',
  'Porch',
  'Pool',
  'Gym',
].sort((a, b) => b.length - a.length);

/** "Living-Room_TV", "livingroomTV.local", "KitchenSpeaker" -> "living room tv ..." words. */
function words(value: string): string {
  return value
    .replace(/\.local\.?$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .toLowerCase();
}

function findRoom(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const spaced = ` ${words(value)} `;
  const squashed = spaced.replace(/\s+/g, '');
  return ROOMS.find((room) => {
    const lower = room.toLowerCase();
    // Whole words ("den" must not match "garden"), or the squashed form for multi-word
    // rooms written as one word ("livingroom").
    return spaced.includes(` ${lower} `) || (lower.includes(' ') && squashed.includes(lower.replace(/ /g, '')));
  });
}

/** A room suggested by the device's own name, then its host name. undefined when neither names a room. */
export function suggestRoom(device: Pick<DiscoveredDevice, 'name' | 'hostname'>): RoomSuggestion | undefined {
  const fromName = findRoom(device.name);
  if (fromName) return { roomName: fromName, source: 'name' };
  const fromHost = findRoom(device.hostname);
  if (fromHost) return { roomName: fromHost, source: 'hostname' };
  return undefined;
}
