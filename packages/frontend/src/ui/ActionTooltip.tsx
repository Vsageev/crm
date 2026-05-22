import {
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useId,
} from 'react';
import { Button } from './Button';
import type { ButtonSize, ButtonVariant } from './Button';
import { Tooltip } from './Tooltip';
import type { TooltipPosition } from './Tooltip';
import styles from './ActionTooltip.module.css';

export type DisabledActionReasonKind =
  | 'loading'
  | 'invalid-form'
  | 'missing-selection'
  | 'permission'
  | 'unavailable'
  | 'active-operation';

export interface DisabledActionReason {
  kind: DisabledActionReasonKind;
  message: string;
}

type DisabledReasonInput = string | DisabledActionReason | null | undefined;

interface ActionTooltipProps {
  label: string;
  children: ReactElement<{
    className?: string;
    style?: CSSProperties;
    'aria-describedby'?: string;
    'aria-hidden'?: boolean;
  }>;
  describedById?: string;
  disabled?: boolean;
  focusable?: boolean;
  position?: TooltipPosition;
  triggerLabel?: string;
}

type ReasonedActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> & {
  children: ReactNode;
  disabled?: boolean;
  disabledReason?: DisabledReasonInput;
  useAriaDisabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

function getDisabledReasonMessage(reason: DisabledReasonInput) {
  if (!reason) return null;
  return typeof reason === 'string' ? reason : reason.message;
}

function mergeDescribedBy(existing: string | undefined, descriptionId: string) {
  return existing ? `${existing} ${descriptionId}` : descriptionId;
}

function mergeClassName(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ') || undefined;
}

function getNodeText(node: ReactNode): string | undefined {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    const text = node.map((child) => getNodeText(child)).filter(Boolean).join(' ').trim();
    return text || undefined;
  }
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return getNodeText(props.children);
  }
  return undefined;
}

/**
 * Shared disabled-action contract:
 * - use a tooltip on hover/focus for blocked icon, toolbar, or compact actions;
 * - keep a persistent aria-describedby target so the reason is not visual-only;
 * - wrap native disabled controls so the wrapper receives hover/focus;
 * - use aria-disabled only when the action must remain focusable, and guard onClick.
 */
export function ActionTooltip({
  label,
  children,
  describedById,
  disabled = false,
  focusable = disabled,
  position = 'top',
  triggerLabel,
}: ActionTooltipProps) {
  const generatedId = useId();
  const descriptionId = describedById ?? `${generatedId}-description`;

  if (!isValidElement(children)) {
    return children;
  }

  const child = cloneElement(children, {
    'aria-describedby': mergeDescribedBy(children.props['aria-describedby'], descriptionId),
    'aria-hidden': focusable && disabled ? true : children.props['aria-hidden'],
    className: mergeClassName(children.props.className, disabled ? styles.disabledButton : undefined),
  });

  return (
    <Tooltip label={label} position={position}>
      <span
        className={mergeClassName(styles.trigger, disabled ? styles.disabledTrigger : undefined)}
        tabIndex={focusable ? 0 : undefined}
        role={focusable ? 'button' : undefined}
        aria-label={focusable ? triggerLabel : undefined}
        aria-describedby={descriptionId}
        aria-disabled={disabled || undefined}
      >
        <span id={descriptionId} className={styles.srOnly}>
          {label}
        </span>
        {child}
      </span>
    </Tooltip>
  );
}

export function ReasonedActionButton({
  children,
  disabled = false,
  disabledReason,
  useAriaDisabled = false,
  onClick,
  className,
  ...props
}: ReasonedActionButtonProps) {
  const reasonMessage = disabled ? getDisabledReasonMessage(disabledReason) : null;

  const button = (
    <Button
      {...props}
      className={className}
      disabled={useAriaDisabled ? false : disabled}
      aria-disabled={useAriaDisabled && disabled ? true : props['aria-disabled']}
      onClick={(event) => {
        if (disabled && useAriaDisabled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
    >
      {children}
    </Button>
  );

  if (!reasonMessage) return button;

  return (
    <ActionTooltip
      label={reasonMessage}
      disabled={disabled}
      focusable={!useAriaDisabled}
      triggerLabel={props['aria-label'] ?? getNodeText(children)}
    >
      {button}
    </ActionTooltip>
  );
}
