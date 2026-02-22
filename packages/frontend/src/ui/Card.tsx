import { type HTMLAttributes, type ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hoverable?: boolean;
}

export function Card({ children, hoverable, className, ...props }: CardProps) {
  const cls = [styles.card, hoverable && styles.hoverable, className].filter(Boolean).join(' ');

  return (
    <div className={cls} {...props}>
      {children}
    </div>
  );
}
