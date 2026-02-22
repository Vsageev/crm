import { type ReactNode } from 'react';
import styles from './Badge.module.css';

type BadgeColor = 'default' | 'success' | 'error' | 'warning' | 'info';

interface BadgeProps {
  color?: BadgeColor;
  children: ReactNode;
  className?: string;
}

export function Badge({ color = 'default', children, className }: BadgeProps) {
  const cls = [styles.badge, styles[color], className].filter(Boolean).join(' ');

  return <span className={cls}>{children}</span>;
}
