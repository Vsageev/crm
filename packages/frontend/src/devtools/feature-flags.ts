import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'openwork:feature-flags:v1';
const CHANGE_EVENT = 'openwork:feature-flags-change';

const DEVTOOLS_DESIGN_VARIANTS = ['floating', 'dock'] as const;

export type FeatureFlagOption = {
  value: string;
  label: string;
};

export type FeatureFlagDefinition = {
  key: 'devtools.designVariant';
  label: string;
  description: string;
  type: 'select';
  defaultValue: DevtoolsDesignVariant;
  options: FeatureFlagOption[];
};

export type DevtoolsDesignVariant = (typeof DEVTOOLS_DESIGN_VARIANTS)[number];

export type FeatureFlagValues = {
  'devtools.designVariant': DevtoolsDesignVariant;
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
];

export const defaultFeatureFlags: FeatureFlagValues = {
  'devtools.designVariant': 'floating',
};

export function isDevtoolsEnabledFromEnv(
  value = import.meta.env.VITE_DEVTOOLS_WIDGET_ENABLED,
): boolean {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function isOneOf<TValue extends string>(
  value: unknown,
  options: readonly TValue[],
): value is TValue {
  return typeof value === 'string' && options.includes(value as TValue);
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
