import React, { useEffect, useCallback, useState, useMemo } from 'react';
import { useLLMTaskStore, type LLMTaskSessionState } from '../../store/llmTaskStore';
import ToastItem from './ToastItem';
import ToastDetailModal from './ToastDetailModal';
import ToastErrorModal from './ToastErrorModal';
import './ToastContainer.css';

const MAX_VISIBLE_TOASTS = 5;

const ToastContainer: React.FC = () => {
  // Select the raw sessions object to avoid infinite re-renders
  const sessionsObj = useLLMTaskStore((state) => state.sessions);
  const clearSession = useLLMTaskStore((state) => state.clearSession);

  // Derive active sessions list with useMemo to avoid creating new array on every render
  const sessions = useMemo(() => {
    return Object.values(sessionsObj)
      .filter((s): s is LLMTaskSessionState => s !== undefined && s.status !== 'idle')
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [sessionsObj]);

  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);
  const [errorSessionId, setErrorSessionId] = useState<string | null>(null);

  // Auto-dismiss sessions with autoDismissMs
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const session of sessions) {
      if (session.autoDismissMs && session.status !== 'running') {
        const elapsed = Date.now() - session.updatedAt;
        const remaining = session.autoDismissMs - elapsed;

        if (remaining <= 0) {
          clearSession(session.id);
        } else {
          const timer = setTimeout(() => {
            clearSession(session.id);
          }, remaining);
          timers.push(timer);
        }
      }
    }

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [sessions, clearSession]);

  const handleDismiss = useCallback(
    (id: string) => {
      clearSession(id);
    },
    [clearSession]
  );

  const handleOpenDetail = useCallback((id: string) => {
    setDetailSessionId(id);
  }, []);

  const handleOpenError = useCallback((id: string) => {
    setErrorSessionId(id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailSessionId(null);
  }, []);

  const handleCloseError = useCallback(() => {
    setErrorSessionId(null);
  }, []);

  const visibleSessions = sessions.slice(0, MAX_VISIBLE_TOASTS);
  const hiddenCount = Math.max(0, sessions.length - MAX_VISIBLE_TOASTS);

  const detailSession = detailSessionId ? sessions.find((s) => s.id === detailSessionId) : null;
  const errorSession = errorSessionId ? sessions.find((s) => s.id === errorSessionId) : null;

  if (sessions.length === 0) {
    return null;
  }

  return (
    <>
      <div className="toast-container">
        {hiddenCount > 0 && (
          <div className="toast-hidden-count">+{hiddenCount} more tasks</div>
        )}
        {visibleSessions.map((session) => (
          <ToastItem
            key={session.id}
            session={session}
            onDismiss={() => handleDismiss(session.id)}
            onOpenDetail={() => handleOpenDetail(session.id)}
            onOpenError={() => handleOpenError(session.id)}
          />
        ))}
      </div>

      {detailSession && (
        <ToastDetailModal session={detailSession} onClose={handleCloseDetail} />
      )}

      {errorSession && (
        <ToastErrorModal
          session={errorSession}
          onClose={handleCloseError}
          onDismissToast={() => {
            handleCloseError();
            handleDismiss(errorSession.id);
          }}
        />
      )}
    </>
  );
};

export default ToastContainer;
