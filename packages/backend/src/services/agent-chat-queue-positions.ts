import type { StoreRecord } from '../db/store.js';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function compareCreated(a: StoreRecord, b: StoreRecord): number {
  const aTime = Date.parse(asString(a.createdAt) ?? '');
  const bTime = Date.parse(asString(b.createdAt) ?? '');
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return aTime - bTime;
  }
  return String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

function isTurnAncestorOf(
  ancestorTurnId: string,
  descendantTurnId: string,
  turnsById: Map<string, StoreRecord>,
): boolean {
  const visited = new Set<string>();
  let currentId: string | null = descendantTurnId;

  while (currentId && !visited.has(currentId)) {
    if (currentId === ancestorTurnId) return true;
    visited.add(currentId);
    const current = turnsById.get(currentId);
    currentId = asString(current?.parentTurnId);
  }

  return false;
}

function isSameTurnLineage(
  first: StoreRecord,
  second: StoreRecord,
  turnsById: Map<string, StoreRecord>,
): boolean {
  const firstTurnId = asString(first.turnId);
  const secondTurnId = asString(second.turnId);
  if (!firstTurnId || !secondTurnId) return false;

  return (
    isTurnAncestorOf(firstTurnId, secondTurnId, turnsById) ||
    isTurnAncestorOf(secondTurnId, firstTurnId, turnsById)
  );
}

function dependsOnQueueItem(
  candidate: StoreRecord,
  dependencyId: string,
  queueItemsById: Map<string, StoreRecord>,
): boolean {
  const visited = new Set<string>();
  let currentDependencyId = asString(candidate.dependsOnQueueItemId);

  while (currentDependencyId && !visited.has(currentDependencyId)) {
    if (currentDependencyId === dependencyId) return true;
    visited.add(currentDependencyId);
    currentDependencyId = asString(queueItemsById.get(currentDependencyId)?.dependsOnQueueItemId);
  }

  return false;
}

function isSameQueueDisplayBranch(
  first: StoreRecord,
  second: StoreRecord,
  turnsById: Map<string, StoreRecord>,
  queueItemsById: Map<string, StoreRecord>,
): boolean {
  if (isSameTurnLineage(first, second, turnsById)) return true;

  const firstId = asString(first.id);
  const secondId = asString(second.id);
  if (firstId && dependsOnQueueItem(second, firstId, queueItemsById)) return true;
  if (secondId && dependsOnQueueItem(first, secondId, queueItemsById)) return true;

  const firstMode = asString(first.mode) ?? 'append_prompt';
  const secondMode = asString(second.mode) ?? 'append_prompt';
  if (firstMode === 'respond_to_message' && secondMode === 'respond_to_message') {
    const firstTarget = asString(first.targetMessageId);
    return firstTarget !== null && firstTarget === asString(second.targetMessageId);
  }

  return false;
}

export function buildQueuedDisplayPositionById(
  queueItems: StoreRecord[],
  turns: StoreRecord[],
): Map<string, number> {
  const positions = new Map<string, number>();
  const turnsById = new Map(
    turns.flatMap((turn) => {
      const id = asString(turn.id);
      return id ? [[id, turn] as const] : [];
    }),
  );
  const queueItemsById = new Map(
    queueItems.flatMap((item) => {
      const id = asString(item.id);
      return id ? [[id, item] as const] : [];
    }),
  );
  const queuedItems = queueItems
    .filter((item) => item.status === 'queued' && asString(item.id))
    .sort(compareCreated);

  for (const item of queuedItems) {
    const id = asString(item.id);
    if (!id) continue;

    let position = 1;
    for (const prior of queuedItems) {
      if (prior === item) break;
      if (isSameQueueDisplayBranch(prior, item, turnsById, queueItemsById)) {
        position += 1;
      }
    }
    positions.set(id, position);
  }

  return positions;
}
