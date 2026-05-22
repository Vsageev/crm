import { useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { getNotificationPreferences, toast } from '../stores/toast';

const POLL_INTERVAL_MS = 8_000;
const RECENT_RUNS_LIMIT = 50;

interface AgentRunEntry {
  id: string;
  agentId: string;
  agentName?: string | null;
  triggerType: 'chat' | 'cron_job' | 'card_assignment';
  status: 'running' | 'completed' | 'error';
  cardId?: string | null;
  finishedAt?: string | null;
}

interface CardSummary {
  id: string;
  name: string;
}

interface RunSnapshot {
  status: AgentRunEntry['status'];
}

function isRecentCompletion(run: AgentRunEntry, sinceMs: number): boolean {
  if (run.status === 'running' || !run.finishedAt) return false;
  const finishedAtMs = new Date(run.finishedAt).getTime();
  return Number.isFinite(finishedAtMs) && finishedAtMs > sinceMs;
}

async function getCardName(
  cardId: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(cardId)) {
    return cache.get(cardId) ?? null;
  }

  try {
    const card = await api<CardSummary>(`/cards/${cardId}`);
    cache.set(cardId, card.name);
    return card.name;
  } catch {
    cache.set(cardId, null);
    return null;
  }
}

async function notifyForFinishedRuns(
  runs: AgentRunEntry[],
  pathname: string,
  cardNameCache: Map<string, string | null>,
) {
  if (runs.length === 0 || pathname === '/monitor') return;

  const prefs = getNotificationPreferences();
  const completedCardRuns = runs.filter(
    (run) => run.status === 'completed' && run.triggerType === 'card_assignment' && prefs.cardWorkCompleted,
  );
  const completedOtherRuns = runs.filter(
    (run) => run.status === 'completed' && run.triggerType !== 'card_assignment' && prefs.chatRunsCompleted,
  );
  const failedRuns = runs.filter((run) => run.status === 'error' && prefs.agentRunFailures);

  if (completedCardRuns.length === 1) {
    const run = completedCardRuns[0];
    const cardName = run.cardId ? await getCardName(run.cardId, cardNameCache) : null;
    const subject = cardName ? `"${cardName}"` : 'a card';
    toast.success(`${run.agentName || 'Agent'} finished work on ${subject}`, {
      link: run.cardId ? `/cards/${run.cardId}` : '/monitor',
    });
  } else if (completedCardRuns.length > 1) {
    toast.success(`${completedCardRuns.length} cards finished processing`, { link: '/monitor' });
  }

  if (completedOtherRuns.length === 1) {
    const run = completedOtherRuns[0];
    const label = run.triggerType === 'chat' ? 'chat run' : 'scheduled run';
    toast.success(`${run.agentName || 'Agent'} completed a ${label}`, { link: '/monitor' });
  } else if (completedOtherRuns.length > 1) {
    toast.success(`${completedOtherRuns.length} agent runs completed`, { link: '/monitor' });
  }

  if (failedRuns.length === 1) {
    const run = failedRuns[0];
    const cardName = run.cardId ? await getCardName(run.cardId, cardNameCache) : null;
    const context = cardName ? ` on "${cardName}"` : run.cardId ? ' on a card' : '';
    toast.error(`${run.agentName || 'Agent'} failed${context}`);
  } else if (failedRuns.length > 1) {
    toast.error(`${failedRuns.length} agent runs failed`);
  }
}

export function useAgentRunNotifications(pathname: string) {
  const knownRunsRef = useRef<Map<string, RunSnapshot>>(new Map());
  const initializedRef = useRef(false);
  const lastPollAtRef = useRef<number | null>(null);
  const cardNameCacheRef = useRef<Map<string, string | null>>(new Map());
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const result = await api<{ entries: AgentRunEntry[] }>(
          `/agent-runs?limit=${RECENT_RUNS_LIMIT}&offset=0`,
        );
        if (cancelled) return;

        const entries = Array.isArray(result.entries) ? result.entries : [];
        const previousRuns = knownRunsRef.current;
        const currentRuns = new Map<string, RunSnapshot>();
        const runsToNotify: AgentRunEntry[] = [];
        const now = Date.now();
        const lastPollAt = lastPollAtRef.current ?? now;

        for (const run of entries) {
          currentRuns.set(run.id, { status: run.status });
          const previous = previousRuns.get(run.id);
          if (!initializedRef.current) continue;

          if (previous?.status === 'running' && run.status !== 'running') {
            runsToNotify.push(run);
            continue;
          }

          if (!previous && isRecentCompletion(run, lastPollAt)) {
            runsToNotify.push(run);
          }
        }

        knownRunsRef.current = currentRuns;
        lastPollAtRef.current = now;

        if (!initializedRef.current) {
          initializedRef.current = true;
          return;
        }

        await notifyForFinishedRuns(runsToNotify, pathnameRef.current, cardNameCacheRef.current);
      } catch {
        // Ignore polling failures. Notifications are best-effort.
      }
    }

    void poll();
    const intervalId = window.setInterval(() => {
      if (!document.hidden) {
        void poll();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);
}
