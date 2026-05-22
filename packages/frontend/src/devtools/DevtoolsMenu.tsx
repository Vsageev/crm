import { Bug, RotateCcw, Settings2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Tooltip } from '../ui';
import {
  featureFlagDefinitions,
  isDevtoolsEnabledFromEnv,
  useFeatureFlags,
  type DevtoolsDesignVariant,
  type FeatureFlagValues,
} from './feature-flags';
import styles from './DevtoolsMenu.module.css';

type DevtoolsMenuProps = {
  enabled?: boolean;
};

function variantClass(variant: DevtoolsDesignVariant) {
  return variant === 'dock' ? styles.dock : styles.floating;
}

export function DevtoolsMenu({ enabled = isDevtoolsEnabledFromEnv() }: DevtoolsMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const { flags, setFeatureFlag, resetFeatureFlags } = useFeatureFlags();
  const designVariant = flags['devtools.designVariant'];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!enabled) return null;

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${variantClass(designVariant)}`}
      data-devtools-design-variant={designVariant}
    >
      {open && (
        <section id={panelId} className={styles.panel} aria-label="Devtools menu">
          <div className={styles.header}>
            <div className={styles.titleGroup}>
              <span className={styles.kicker}>Devtools</span>
              <h2 className={styles.title}>Feature flags</h2>
            </div>
            <Tooltip label="Close devtools" position="left">
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setOpen(false)}
                aria-label="Close devtools"
              >
                <X size={16} />
              </button>
            </Tooltip>
          </div>

          <div className={styles.flagList}>
            {featureFlagDefinitions.map((definition) => {
              if (definition.type === 'select') {
                const selectId = `${panelId}-${definition.key}`;

                return (
                  <div key={definition.key} className={styles.flagRow}>
                    <span className={styles.flagCopy}>
                      <label htmlFor={selectId} className={styles.flagLabel}>
                        {definition.label}
                      </label>
                      <span className={styles.flagDescription}>{definition.description}</span>
                    </span>
                    <select
                      id={selectId}
                      className={styles.select}
                      value={flags[definition.key]}
                      onChange={(event) =>
                        setFeatureFlag(
                          definition.key,
                          event.target.value as FeatureFlagValues[typeof definition.key],
                        )
                      }
                    >
                      {definition.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }

              if (definition.type === 'boolean') {
                const toggleId = `${panelId}-${definition.key}`;

                return (
                  <div key={definition.key} className={styles.flagRow}>
                    <span className={styles.flagCopy}>
                      <label htmlFor={toggleId} className={styles.flagLabel}>
                        {definition.label}
                      </label>
                      <span className={styles.flagDescription}>{definition.description}</span>
                    </span>
                    <input
                      id={toggleId}
                      type="checkbox"
                      className={styles.toggle}
                      checked={flags[definition.key]}
                      onChange={(event) =>
                        setFeatureFlag(definition.key, event.target.checked)
                      }
                    />
                  </div>
                );
              }

              return null;
            })}
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.resetButton} onClick={resetFeatureFlags}>
              <RotateCcw size={14} />
              Reset flags
            </button>
          </div>
        </section>
      )}

      <Tooltip label="Open devtools" position={designVariant === 'dock' ? 'top' : 'left'}>
        <button
          type="button"
          className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
          onClick={() => setOpen((current) => !current)}
          aria-label="Open devtools"
          aria-controls={panelId}
          aria-expanded={open}
        >
          {designVariant === 'dock' ? <Settings2 size={18} /> : <Bug size={18} />}
          <span className={styles.triggerText}>Devtools</span>
        </button>
      </Tooltip>
    </div>
  );
}
