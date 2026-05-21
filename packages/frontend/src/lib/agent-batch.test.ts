import { describe, expect, it } from 'vitest';
import {
  buildCardDependenciesFromLayers,
  buildStagesFromLayers,
  type BatchLayer,
} from './agent-batch';

describe('agent batch dependency planning', () => {
  it('keeps layer grouping while compiling default previous-layer dependencies', () => {
    const layers: BatchLayer[] = [
      { cards: [{ id: 'build-api', name: 'Build API' }, { id: 'build-ui', name: 'Build UI' }] },
      { cards: [{ id: 'test-api', name: 'Test API' }, { id: 'test-ui', name: 'Test UI' }] },
    ];

    expect(buildStagesFromLayers(layers)).toEqual([
      { id: 'layer-1', cardIds: ['build-api', 'build-ui'], dependsOnStageIndexes: [] },
      { id: 'layer-2', cardIds: ['test-api', 'test-ui'], dependsOnStageIndexes: [] },
    ]);
    expect(buildCardDependenciesFromLayers(layers)).toEqual([
      {
        cardId: 'test-api',
        dependsOnCardIds: ['build-api', 'build-ui'],
        blockingMode: undefined,
      },
      {
        cardId: 'test-ui',
        dependsOnCardIds: ['build-api', 'build-ui'],
        blockingMode: undefined,
      },
    ]);
  });

  it('allows a card to depend only on specific earlier cards', () => {
    const layers: BatchLayer[] = [
      { cards: [{ id: 'build-api', name: 'Build API' }, { id: 'build-ui', name: 'Build UI' }] },
      {
        cards: [
          {
            id: 'test-api',
            name: 'Test API',
            dependencyRule: { mode: 'specific_cards', cardIds: ['build-api'] },
          },
          {
            id: 'test-ui',
            name: 'Test UI',
            dependencyRule: { mode: 'specific_cards', cardIds: ['build-ui'] },
          },
        ],
      },
      { cards: [{ id: 'deploy', name: 'Deploy' }] },
    ];

    expect(buildCardDependenciesFromLayers(layers)).toEqual([
      {
        cardId: 'test-api',
        dependsOnCardIds: ['build-api'],
        blockingMode: undefined,
      },
      {
        cardId: 'test-ui',
        dependsOnCardIds: ['build-ui'],
        blockingMode: undefined,
      },
      {
        cardId: 'deploy',
        dependsOnCardIds: ['test-api', 'test-ui'],
        blockingMode: undefined,
      },
    ]);
  });

  it('supports independent cards and all-earlier dependency barriers', () => {
    const layers: BatchLayer[] = [
      { cards: [{ id: 'a', name: 'A' }] },
      { cards: [{ id: 'b', name: 'B', dependencyRule: { mode: 'none' } }] },
      { cards: [{ id: 'release', name: 'Release', dependencyRule: { mode: 'all_previous_layers' } }] },
    ];

    expect(buildCardDependenciesFromLayers(layers)).toEqual([
      {
        cardId: 'release',
        dependsOnCardIds: ['a', 'b'],
        blockingMode: undefined,
      },
    ]);
  });
});
