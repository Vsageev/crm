/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest';
import {
  clampExecutionPlansRailPosition,
  defaultExecutionPlansRailPosition,
  EXECUTION_PLANS_RAIL_VIEWPORT_PADDING,
  EXECUTION_PLANS_RAIL_WIDTH,
  readStoredExecutionPlansRailPosition,
  writeStoredExecutionPlansRailPosition,
} from './execution-plans-rail-preferences';

describe('execution-plans-rail-preferences', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to the top-right with viewport padding', () => {
    const position = defaultExecutionPlansRailPosition(1280, 800, EXECUTION_PLANS_RAIL_WIDTH, 768);
    expect(position).toEqual({
      x: 1280 - EXECUTION_PLANS_RAIL_WIDTH - EXECUTION_PLANS_RAIL_VIEWPORT_PADDING,
      y: EXECUTION_PLANS_RAIL_VIEWPORT_PADDING,
    });
  });

  it('clamps position inside the viewport', () => {
    expect(clampExecutionPlansRailPosition(-40, -20, 520, 768, 1280, 800)).toEqual({
      x: EXECUTION_PLANS_RAIL_VIEWPORT_PADDING,
      y: EXECUTION_PLANS_RAIL_VIEWPORT_PADDING,
    });
    expect(clampExecutionPlansRailPosition(2000, 2000, 520, 768, 1280, 800)).toEqual({
      x: 1280 - 520 - EXECUTION_PLANS_RAIL_VIEWPORT_PADDING,
      y: 800 - 768 - EXECUTION_PLANS_RAIL_VIEWPORT_PADDING,
    });
  });

  it('reads and persists the stored rail position', () => {
    const initial = readStoredExecutionPlansRailPosition(1280, 1200, 520, 400);
    expect(initial.x).toBeGreaterThan(0);
    writeStoredExecutionPlansRailPosition({ x: 120, y: 80 }, 1280, 1200, 520, 400);
    expect(readStoredExecutionPlansRailPosition(1280, 1200, 520, 400)).toEqual({ x: 120, y: 80 });
  });
});
