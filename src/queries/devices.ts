import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  deviceRepository,
  SaveDeviceInput,
  ScanSubmission,
} from '@/lib/network-scan/device-repository';

export const deviceKeys = {
  known: (homeId: string) => ['homes', homeId, 'devices'] as const,
};

export function useKnownDevices(homeId: string, enabled = true) {
  return useQuery({
    queryKey: deviceKeys.known(homeId),
    queryFn: () => deviceRepository.listKnownDevices(homeId),
    enabled,
  });
}

export function useSaveHomeDevice(homeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveDeviceInput) => deviceRepository.saveDevice(homeId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: deviceKeys.known(homeId) }),
  });
}

export function useSubmitDeviceScan(homeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scan: ScanSubmission) => deviceRepository.submitScan(homeId, scan),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: deviceKeys.known(homeId) }),
  });
}
