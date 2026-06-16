/**
 * Settings persistence. The old store's `saveToServer` is the only write path
 * (SettingsModal's Save button); the SettingsModal owns the editable draft as
 * local React state, so there is no optimistic round-trip here — just persist
 * the draft and replace the cache with the server's canonical response.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsService } from '../../../api/settingsService';
import {
  buildDemoScopedSettingsPayload,
  buildSettingsUpdatePayload,
} from '../../../store/settingsUpdatePayload';
import { settingsKeys } from '../../keys/settingsKeys';
import type { Settings } from '../../../domain/settings';

/** Persist a full settings draft to the server, then adopt the saved result. */
export function useSaveSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Settings) => {
      const payload = settings.demoModeEnabled
        ? buildDemoScopedSettingsPayload(settings)
        : buildSettingsUpdatePayload(settings);
      return settingsService.updateSettings(payload);
    },
    onSuccess: (saved) => {
      qc.setQueryData<Settings>(settingsKeys.settings(), saved);
    },
  });
}
