/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { BatchLayerPlanner, type BatchLayer, type BatchPlanCard } from './BatchLayerPlanner';

function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    dropEffect: 'move',
    effectAllowed: 'move',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: vi.fn((format?: string) => {
      if (format) store.delete(format);
      else store.clear();
    }),
    getData: vi.fn((format: string) => store.get(format) ?? ''),
    setData: vi.fn((format: string, data: string) => {
      store.set(format, data);
    }),
    setDragImage: vi.fn(),
  };
}

function renderPlanner(initialLayers: BatchLayer[]) {
  let latestLayers = initialLayers;
  const loadOptions = async (): Promise<BatchPlanCard[]> => [];

  function Harness() {
    const [layers, setLayers] = useState(initialLayers);
    return (
      <BatchLayerPlanner
        layers={layers}
        onChange={(next) => {
          latestLayers = next;
          setLayers(next);
        }}
        loadOptions={loadOptions}
      />
    );
  }

  render(<Harness />);
  return {
    getLatestLayers: () => latestLayers,
  };
}

describe('BatchLayerPlanner layer list mode', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('moves a card across layers', () => {
    const { getLatestLayers } = renderPlanner([
      {
        cards: [
          { id: 'build-api', name: 'Build API' },
          { id: 'build-ui', name: 'Build UI' },
        ],
      },
      { cards: [{ id: 'test-api', name: 'Test API' }] },
    ]);

    const dataTransfer = createDataTransfer();
    const draggedCard = screen.getByText('Build API').closest('[draggable="true"]');
    const targetLayer = screen.getByText('Layer 2').closest('[class*="layer"]');

    expect(draggedCard).not.toBeNull();
    expect(targetLayer).not.toBeNull();

    fireEvent.dragStart(draggedCard as Element, { dataTransfer });
    fireEvent.dragOver(targetLayer as Element, { dataTransfer });
    fireEvent.drop(targetLayer as Element, { dataTransfer });

    expect(getLatestLayers().map((layer) => layer.cards.map((card) => card.id))).toEqual([
      ['build-ui'],
      ['test-api', 'build-api'],
    ]);
  });
});
