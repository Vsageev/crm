const STORAGE_KEY = 'execution-plans-rail-position';

export const EXECUTION_PLANS_RAIL_WIDTH = 520;
export const EXECUTION_PLANS_RAIL_VIEWPORT_PADDING = 16;

export type ExecutionPlansRailPosition = {
  x: number;
  y: number;
};

export function defaultExecutionPlansRailPosition(
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
  panelWidth = EXECUTION_PLANS_RAIL_WIDTH,
  panelHeight = viewportHeight - EXECUTION_PLANS_RAIL_VIEWPORT_PADDING * 2,
): ExecutionPlansRailPosition {
  return clampExecutionPlansRailPosition(
    viewportWidth - panelWidth - EXECUTION_PLANS_RAIL_VIEWPORT_PADDING,
    EXECUTION_PLANS_RAIL_VIEWPORT_PADDING,
    panelWidth,
    panelHeight,
    viewportWidth,
    viewportHeight,
  );
}

export function clampExecutionPlansRailPosition(
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
): ExecutionPlansRailPosition {
  const pad = EXECUTION_PLANS_RAIL_VIEWPORT_PADDING;
  const minX = pad;
  const minY = pad;
  const maxX = Math.max(minX, viewportWidth - panelWidth - pad);
  const maxY = Math.max(minY, viewportHeight - panelHeight - pad);
  return {
    x: Math.min(maxX, Math.max(minX, Math.round(x))),
    y: Math.min(maxY, Math.max(minY, Math.round(y))),
  };
}

export function readStoredExecutionPlansRailPosition(
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
  panelWidth = EXECUTION_PLANS_RAIL_WIDTH,
  panelHeight = viewportHeight - EXECUTION_PLANS_RAIL_VIEWPORT_PADDING * 2,
): ExecutionPlansRailPosition {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultExecutionPlansRailPosition(viewportWidth, viewportHeight, panelWidth, panelHeight);
    }
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    const x = typeof parsed.x === 'number' && Number.isFinite(parsed.x) ? parsed.x : NaN;
    const y = typeof parsed.y === 'number' && Number.isFinite(parsed.y) ? parsed.y : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return defaultExecutionPlansRailPosition(viewportWidth, viewportHeight, panelWidth, panelHeight);
    }
    return clampExecutionPlansRailPosition(x, y, panelWidth, panelHeight, viewportWidth, viewportHeight);
  } catch {
    return defaultExecutionPlansRailPosition(viewportWidth, viewportHeight, panelWidth, panelHeight);
  }
}

export function writeStoredExecutionPlansRailPosition(
  position: ExecutionPlansRailPosition,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
  panelWidth = EXECUTION_PLANS_RAIL_WIDTH,
  panelHeight = viewportHeight - EXECUTION_PLANS_RAIL_VIEWPORT_PADDING * 2,
): void {
  try {
    const next = clampExecutionPlansRailPosition(
      position.x,
      position.y,
      panelWidth,
      panelHeight,
      viewportWidth,
      viewportHeight,
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota/private-mode failures.
  }
}
