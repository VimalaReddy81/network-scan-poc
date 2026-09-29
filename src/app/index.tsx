import { useEffect, useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HomeDeviceCard, ScannedDeviceCard } from '@/components/scanned-device-card';
import { MethodStatus, useNetworkScan } from '@/hooks/use-network-scan';
import { HOME_INTELLIGENCE_ENABLED } from '@/lib/network-scan/config';
import { DEFAULT_HOME_ID, toScanSubmission } from '@/lib/network-scan/device-repository';
import { enrich } from '@/lib/network-scan/enrich';
import { HomeDevice } from '@/lib/network-scan/types';
import { useKnownDevices, useSaveHomeDevice, useSubmitDeviceScan } from '@/queries/devices';

const METHOD_LABELS: Record<MethodStatus, string> = {
  idle: 'Not started',
  running: 'Scanning…',
  done: 'Done',
  failed: 'Failed',
  unavailable: 'Not available in this build',
  'disabled-on-ios': 'Off on iOS (needs Apple multicast entitlement)',
};

const WIFI_LABELS = { checking: 'Checking…', connected: 'Connected', 'not-connected': 'Not connected' } as const;

// Home Summary: hosts the one-time network scan.
export default function HomeSummaryScreen() {
  const scan = useNetworkScan();
  const homeId = DEFAULT_HOME_ID;
  const knownDevices = useKnownDevices(homeId, HOME_INTELLIGENCE_ENABLED);
  const saveDevice = useSaveHomeDevice(homeId);
  const submitScan = useSubmitDeviceScan(homeId);
  const { mutate: submit } = submitScan;

  const homeDevices = useMemo(
    () => (HOME_INTELLIGENCE_ENABLED ? enrich(scan.devices, knownDevices.data ?? []) : []),
    [scan.devices, knownDevices.data]
  );
  const seen = homeDevices.filter((h) => h.status === 'seen');
  const notSeen = homeDevices.filter((h) => h.status === 'not-seen');

  // Report each finished scan to the (mock) backend so known devices update their last-seen time and IP.
  const { phase, finishedAt, devices } = scan;
  useEffect(() => {
    if (HOME_INTELLIGENCE_ENABLED && phase === 'done' && finishedAt) {
      submit(toScanSubmission(devices, finishedAt));
    }
    // Only once per finished scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, finishedAt]);

  const addToHome = (home: HomeDevice, roomName?: string) => {
    const d = home.discovered;
    saveDevice.mutate({
      id: home.known?.id,
      name: home.known?.name ?? d?.name ?? d?.hostname ?? d?.ip ?? 'Device',
      identityKeys: d?.identityKeys ?? home.known?.identityKeys ?? [],
      manufacturer: home.identification.manufacturer === 'Unknown' ? undefined : home.identification.manufacturer,
      model: d?.model,
      deviceType: home.identification.deviceType,
      roomName: roomName ?? home.room?.roomName,
      roomConfirmed: roomName ? true : undefined,
      lastIp: d?.ip,
    });
  };

  const statusText =
    scan.phase === 'scanning'
      ? 'Scanning…'
      : scan.phase === 'done'
        ? 'Scan completed'
        : scan.phase === 'stopped'
          ? 'Scan stopped'
          : 'Ready to scan';

  const header = (
    <View>
      <Text style={styles.title}>My Home</Text>
      <Text style={styles.info}>Wi-Fi: {WIFI_LABELS[scan.wifi]}</Text>
      <Text style={styles.info}>Status: {statusText}</Text>
      <Text style={styles.info}>mDNS: {METHOD_LABELS[scan.mdns]}</Text>
      <Text style={styles.info}>SSDP: {METHOD_LABELS[scan.ssdp]}</Text>
      <Text style={styles.info}>Devices found: {scan.devices.length}</Text>

      {scan.errors.map((error) => (
        <Text key={error} style={styles.error}>
          {error}
        </Text>
      ))}

      <Pressable
        style={[styles.button, scan.isScanning && styles.buttonStop]}
        onPress={scan.isScanning ? scan.stop : scan.start}>
        {scan.isScanning ? (
          <View style={styles.row}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.buttonText}>  Stop Scan</Text>
          </View>
        ) : (
          <Text style={styles.buttonText}>Scan Network</Text>
        )}
      </Pressable>

      <Text style={styles.caveat}>
        What&apos;s shown is what the network reports: a best guess, not a live status.
      </Text>
    </View>
  );

  const empty =
    scan.isScanning || scan.phase === 'idle' ? null : (
      <Text style={styles.empty}>
        No devices found. Make sure this phone is on the same Wi-Fi as your devices and that Local Network access is
        allowed.
      </Text>
    );

  if (!HOME_INTELLIGENCE_ENABLED) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <FlatList
          data={scan.devices}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          renderItem={({ item }) => <ScannedDeviceCard device={item} />}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={seen}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        renderItem={({ item }) => (
          <HomeDeviceCard
            home={item}
            busy={saveDevice.isPending}
            onAddToHome={(home) => addToHome(home)}
            onAssignRoom={(home, roomName) => addToHome(home, roomName)}
          />
        )}
        ListFooterComponent={
          notSeen.length > 0 && scan.phase === 'done' ? (
            <View style={styles.notSeen}>
              <Text style={styles.sectionTitle}>Not seen in latest scan</Text>
              {notSeen.map((home) => (
                <Text key={home.key} style={styles.notSeenRow}>
                  {home.known?.name}
                  {home.known?.roomName ? ` · ${home.known.roomName}` : ''}
                  {home.known?.lastIp ? ` · last at ${home.known.lastIp}` : ''}
                </Text>
              ))}
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  title: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginVertical: 16, color: '#000' },
  info: { color: '#333', marginBottom: 2 },
  error: { color: '#c5221f', marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  button: { backgroundColor: '#1a73e8', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 16 },
  buttonStop: { backgroundColor: '#c5221f' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  caveat: { color: '#666', fontSize: 12, textAlign: 'center', marginVertical: 12 },
  empty: { textAlign: 'center', color: '#666', marginTop: 16 },
  notSeen: { marginTop: 16 },
  sectionTitle: { fontWeight: 'bold', fontSize: 16, marginBottom: 6, color: '#000' },
  notSeenRow: { color: '#666', paddingVertical: 4 },
});
