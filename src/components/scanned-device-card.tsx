import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TIER_LABELS } from '@/lib/network-scan/confidence';
import { displayFields, displayName } from '@/lib/network-scan/display';
import { DiscoveredDevice, HomeDevice } from '@/lib/network-scan/types';

const ASSIGNABLE_ROOMS = ['Living Room', 'Kitchen', 'Bedroom', 'Office', 'Dining Room', 'Family Room', 'Garage'];

/** Network data only: what the device reported, nothing inferred. */
export function ScannedDeviceCard({ device }: { device: DiscoveredDevice }) {
  return (
    <View style={styles.card}>
      <Text style={styles.name}>{displayName(device)}</Text>
      {displayFields(device).map((field) => (
        <Text key={field.label} style={styles.field}>
          <Text style={styles.label}>{field.label}: </Text>
          {field.value}
        </Text>
      ))}
    </View>
  );
}

type HomeDeviceCardProps = {
  home: HomeDevice;
  onAddToHome?: (home: HomeDevice) => void;
  onAssignRoom?: (home: HomeDevice, roomName: string) => void;
  busy?: boolean;
};

/** Network data plus identification, room, confidence and the reasons behind it. */
export function HomeDeviceCard({ home, onAddToHome, onAssignRoom, busy }: HomeDeviceCardProps) {
  const [pickingRoom, setPickingRoom] = useState(false);
  const { discovered, known, identification, room, confidence } = home;
  const rooms = room && !ASSIGNABLE_ROOMS.includes(room.roomName) ? [room.roomName, ...ASSIGNABLE_ROOMS] : ASSIGNABLE_ROOMS;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={[styles.name, styles.flex]}>{known?.name ?? (discovered ? displayName(discovered) : 'Device')}</Text>
        <View style={[styles.badge, styles[`badge_${confidence.tier}`]]}>
          <Text style={styles.badgeText}>{TIER_LABELS[confidence.tier]}</Text>
        </View>
      </View>

      <Text style={styles.field}>
        {identification.manufacturer} · {identification.deviceType}
        {room ? ` · ${room.roomName}${room.source === 'known' && known?.roomConfirmed ? '' : ' (suggested)'}` : ''}
      </Text>

      {discovered
        ? displayFields(discovered).map((field) => (
            <Text key={field.label} style={styles.field}>
              <Text style={styles.label}>{field.label}: </Text>
              {field.value}
            </Text>
          ))
        : null}

      {confidence.reasons.length > 0 ? (
        <View style={styles.reasons}>
          <Text style={styles.label}>Why</Text>
          {confidence.reasons.map((reason) => (
            <Text key={reason} style={styles.reason}>
              • {reason}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        {!known && onAddToHome ? (
          <Pressable style={styles.action} disabled={busy} onPress={() => onAddToHome(home)}>
            <Text style={styles.actionText}>Add to Home</Text>
          </Pressable>
        ) : null}
        {onAssignRoom ? (
          <Pressable style={styles.actionSecondary} disabled={busy} onPress={() => setPickingRoom((v) => !v)}>
            <Text style={styles.actionSecondaryText}>{pickingRoom ? 'Cancel' : 'Assign Room'}</Text>
          </Pressable>
        ) : null}
      </View>

      {pickingRoom && onAssignRoom ? (
        <View style={styles.rooms}>
          {rooms.map((roomName) => (
            <Pressable
              key={roomName}
              style={styles.roomChip}
              disabled={busy}
              onPress={() => {
                setPickingRoom(false);
                onAssignRoom(home, roomName);
              }}>
              <Text style={styles.roomChipText}>{roomName}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderColor: '#ddd', borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 8, backgroundColor: '#fff' },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  flex: { flex: 1 },
  name: { fontWeight: 'bold', fontSize: 16, marginBottom: 4, color: '#000' },
  field: { color: '#222', marginBottom: 1 },
  label: { fontWeight: '600', color: '#444' },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8 },
  badge_hi: { backgroundColor: '#1e8e3e' },
  badge_md: { backgroundColor: '#f29900' },
  badge_lo: { backgroundColor: '#80868b' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  reasons: { marginTop: 6 },
  reason: { color: '#555', fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  action: { backgroundColor: '#1a73e8', borderRadius: 6, paddingVertical: 8, paddingHorizontal: 12 },
  actionText: { color: '#fff', fontWeight: '600' },
  actionSecondary: { borderColor: '#1a73e8', borderWidth: 1, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 12 },
  actionSecondaryText: { color: '#1a73e8', fontWeight: '600' },
  rooms: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  roomChip: { backgroundColor: '#e8f0fe', borderRadius: 14, paddingVertical: 6, paddingHorizontal: 10 },
  roomChipText: { color: '#1a73e8' },
});
