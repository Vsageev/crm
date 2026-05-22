import type { BatchPlanCard } from '../../components/BatchLayerPlanner';

export type PlanEditorAddMode = 'append' | 'newLayer';

export type PlanEditorBridge = {
  addCards: (cards: BatchPlanCard[], mode: PlanEditorAddMode) => void;
  isEditing: boolean;
  boardSelectionMode?: boolean;
};
