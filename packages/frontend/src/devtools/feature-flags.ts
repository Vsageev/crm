import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'openwork:feature-flags:v1';
const CHANGE_EVENT = 'openwork:feature-flags-change';

const DEVTOOLS_DESIGN_VARIANTS = ['floating', 'dock'] as const;
const MESSAGE_SEARCH_SENDER_STYLES = [
  'inline-text',
  'inbox-prefix',
  'badge',
  'accent-bar',
  'role-dot',
] as const;

export type FeatureFlagOption = {
  value: string;
  label: string;
};

export type FeatureFlagDefinition =
  | {
      key: 'devtools.designVariant';
      label: string;
      description: string;
      type: 'select';
      defaultValue: DevtoolsDesignVariant;
      options: FeatureFlagOption[];
    }
  | {
      key: 'agentChat.messageSearchSenderStyle';
      label: string;
      description: string;
      type: 'select';
      defaultValue: MessageSearchSenderStyle;
      options: FeatureFlagOption[];
    }
  | {
      key:
        | 'executionPlans.boardDragIn'
        | 'executionPlans.selectionToolbar'
        | 'executionPlans.columnToLayer'
        | 'executionPlans.liveBadges'
        | 'executionPlans.plannerPolish'
        | 'executionPlans.planTemplates'
        | 'executionPlans.dependencyShortcuts'
        | 'executionPlans.embedBatchPlanner';
      label: string;
      description: string;
      type: 'boolean';
      defaultValue: boolean;
    };

export type DevtoolsDesignVariant = (typeof DEVTOOLS_DESIGN_VARIANTS)[number];
export type MessageSearchSenderStyle = (typeof MESSAGE_SEARCH_SENDER_STYLES)[number];

export type FeatureFlagValues = {
  'devtools.designVariant': DevtoolsDesignVariant;
  'agentChat.messageSearchSenderStyle': MessageSearchSenderStyle;
  'executionPlans.boardDragIn': boolean;
  'executionPlans.selectionToolbar': boolean;
  'executionPlans.columnToLayer': boolean;
  'executionPlans.liveBadges': boolean;
  'executionPlans.plannerPolish': boolean;
  'executionPlans.planTemplates': boolean;
  'executionPlans.dependencyShortcuts': boolean;
  'executionPlans.embedBatchPlanner': boolean;
};

export const defaultFeatureFlags: FeatureFlagValues = {
  'devtools.designVariant': 'floating',
  'agentChat.messageSearchSenderStyle': 'inline-text',
  'executionPlans.boardDragIn': false,
  'executionPlans.selectionToolbar': false,
  'executionPlans.columnToLayer': false,
  'executionPlans.liveBadges': false,
  'executionPlans.plannerPolish': false,
  'executionPlans.planTemplates': false,
  'executionPlans.dependencyShortcuts': false,
  'executionPlans.embedBatchPlanner': false,
};

export const featureFlagDefinitions: FeatureFlagDefinition[] = [
  {
    key: 'devtools.designVariant',
    label: 'Devtools design variant',
    description: 'Switches the devtools widget shell between floating and docked UI.',
    type: 'select',
    defaultValue: 'floating',
    options: [
      { value: 'floating', label: 'Floating' },
      { value: 'dock', label: 'Docked' },
    ],
  },
  {
    key: 'agentChat.messageSearchSenderStyle',
    label: 'Message search sender style',
    description: 'How agent chat sidebar search results indicate user vs agent messages.',
    type: 'select',
    defaultValue: 'inline-text',
    options: [
      { value: 'inline-text', label: 'Inline text' },
      { value: 'inbox-prefix', label: 'Inbox prefix' },
      { value: 'badge', label: 'Badge pill' },
      { value: 'accent-bar', label: 'Accent bar' },
      { value: 'role-dot', label: 'Role dot' },
    ],
  },
  {
    key: 'executionPlans.boardDragIn',
    label: 'Board → plan drag',
    description: 'Drag board cards into the layer planner while editing a plan.',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'executionPlans.selectionToolbar',
    label: 'Selection → plan toolbar',
    description: 'Shift-click cards on the board, then add selection to the active plan.',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'executionPlans.columnToLayer',
    label: 'Column → layer',
    description: 'Drag a column header into the planner to import all its cards as one layer.',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'executionPlans.liveBadges',
    label: 'Live plan badges on board',
    description: 'Show layer numbers on in-plan cards and dim cards not in the plan.',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'executionPlans.plannerPolish',
    label: 'Planner polish',
    description: 'Keyboard reorder, always-visible empty layer slots, column color strips.',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'executionPlans.planTemplates',
    label: 'Plan templates',
    description: 'Quick-start presets when creating a new execution plan.',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'executionPlans.dependencyShortcuts',
    label: 'Dependency shortcuts',
    description: 'Default-rule chips and “same as card above” in the dependency editor.',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'executionPlans.embedBatchPlanner',
    label: 'Edit plan in batch run',
    description: 'Show the layer planner inline in the batch run panel when a plan is loaded.',
    type: 'boolean',
    defaultValue: false,
  },
];

export function isDevtoolsEnabledFromEnv(
  value?: string,
): boolean {
  const rawValue = arguments.length === 0 ? import.meta.env.VITE_DEVTOOLS_WIDGET_ENABLED : value;
  if (typeof rawValue !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(rawValue.trim().toLowerCase());
}

function isOneOf<TValue extends string>(
  value: unknown,
  options: readonly TValue[],
): value is TValue {
  return typeof value === 'string' && options.includes(value as TValue);
}

function readBooleanFlag(parsed: Record<string, unknown>, key: keyof FeatureFlagValues): boolean | undefined {
  const value = parsed[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function readStoredFlags(): Partial<FeatureFlagValues> {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const flags: Partial<FeatureFlagValues> = {};
    const designVariant = parsed['devtools.designVariant'];
    if (isOneOf(designVariant, DEVTOOLS_DESIGN_VARIANTS)) {
      flags['devtools.designVariant'] = designVariant;
    }

    const messageSearchSenderStyle = parsed['agentChat.messageSearchSenderStyle'];
    if (isOneOf(messageSearchSenderStyle, MESSAGE_SEARCH_SENDER_STYLES)) {
      flags['agentChat.messageSearchSenderStyle'] = messageSearchSenderStyle;
    }

    const booleanKeys = [
      'executionPlans.boardDragIn',
      'executionPlans.selectionToolbar',
      'executionPlans.columnToLayer',
      'executionPlans.liveBadges',
      'executionPlans.plannerPolish',
      'executionPlans.planTemplates',
      'executionPlans.dependencyShortcuts',
      'executionPlans.embedBatchPlanner',
    ] as const;

    for (const key of booleanKeys) {
      const value = readBooleanFlag(parsed, key);
      if (value !== undefined) flags[key] = value;
    }

    return flags;
  } catch {
    return {};
  }
}

function readFeatureFlags(): FeatureFlagValues {
  return {
    ...defaultFeatureFlags,
    ...readStoredFlags(),
  };
}

function writeFeatureFlags(flags: FeatureFlagValues) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: flags }));
}

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlagValues>(readFeatureFlags);

  useEffect(() => {
    const handleChange = () => setFlags(readFeatureFlags());
    window.addEventListener(CHANGE_EVENT, handleChange);
    window.addEventListener('storage', handleChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handleChange);
      window.removeEventListener('storage', handleChange);
    };
  }, []);

  const setFeatureFlag = useCallback(
    <Key extends keyof FeatureFlagValues>(key: Key, value: FeatureFlagValues[Key]) => {
      const next = { ...readFeatureFlags(), [key]: value };
      setFlags(next);
      writeFeatureFlags(next);
    },
    [],
  );

  const resetFeatureFlags = useCallback(() => {
    setFlags(defaultFeatureFlags);
    writeFeatureFlags(defaultFeatureFlags);
  }, []);

  return useMemo(
    () => ({
      flags,
      setFeatureFlag,
      resetFeatureFlags,
    }),
    [flags, resetFeatureFlags, setFeatureFlag],
  );
}
