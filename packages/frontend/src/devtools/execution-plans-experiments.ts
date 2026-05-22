import { useFeatureFlags } from './feature-flags';

export type ExecutionPlansExperiments = {
  boardDragIn: boolean;
  selectionToolbar: boolean;
  columnToLayer: boolean;
  liveBadges: boolean;
  plannerPolish: boolean;
  planTemplates: boolean;
  dependencyShortcuts: boolean;
  embedBatchPlanner: boolean;
};

export function useExecutionPlansExperiments(): ExecutionPlansExperiments {
  const { flags } = useFeatureFlags();
  return {
    boardDragIn: flags['executionPlans.boardDragIn'],
    selectionToolbar: flags['executionPlans.selectionToolbar'],
    columnToLayer: flags['executionPlans.columnToLayer'],
    liveBadges: flags['executionPlans.liveBadges'],
    plannerPolish: flags['executionPlans.plannerPolish'],
    planTemplates: flags['executionPlans.planTemplates'],
    dependencyShortcuts: flags['executionPlans.dependencyShortcuts'],
    embedBatchPlanner: flags['executionPlans.embedBatchPlanner'],
  };
}

export function isExecutionPlanEditorActive(
  showPanel: boolean,
  mode: 'list' | 'editor',
): boolean {
  return showPanel && mode === 'editor';
}
