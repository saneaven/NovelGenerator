import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { refetchThreadSnapshot } from '../../data/threads';
import { useThreadStreamStore } from '../../store/threadStreamStore';
import { confirm as showConfirm } from '../../store/dialogStore';

/**
 * Manual thread reload for every thread-chat surface. `reloadKey` is meant to key
 * the message-list body so a reload fully remounts it (clears stuck scroll/render
 * state); `reloadThread` re-pulls the snapshot from the server. When the thread is
 * live-streaming, refetching can clobber the stream, so we warn first — but never
 * block it: escaping a mid-stream race is the whole point of the button.
 */
export function useThreadReload(threadId: string | null | undefined) {
  const { t } = useTranslation();
  const [reloadKey, setReloadKey] = useState(0);

  const reloadThread = useCallback(async () => {
    if (!threadId) return;
    const state = useThreadStreamStore.getState();
    const status = state.threadsById[threadId]?.status;
    const isLive = status === 'running' || status === 'processing' || state.isThreadStreamActive(threadId);
    if (isLive) {
      const ok = await showConfirm({
        title: t('agent.reloadThread'),
        message: t('agent.reloadThreadStreamingWarning'),
        variant: 'warning',
        confirmLabel: t('agent.reloadThread'),
      });
      if (!ok) return;
    }
    void refetchThreadSnapshot(threadId);
    setReloadKey((key) => key + 1);
  }, [threadId, t]);

  return { reloadKey, reloadThread };
}
