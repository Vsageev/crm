import { type SelectHTMLAttributes, forwardRef } from 'react';
import styles from './Select.module.css';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className, id, children, ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className={styles.wrapper}>
        {label && (
          <label htmlFor={selectId} className={styles.label}>
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={[styles.select, error && styles.error, className].filter(Boolean).join(' ')}
          {...props}
        >
          {children}
        </select>
        {error && <span className={styles.errorText}>{error}</span>}
      </div>
    );
  },
);

Select.displayName = 'Select';
