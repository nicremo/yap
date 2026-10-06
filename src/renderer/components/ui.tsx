import { useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { Icon, type IconName } from './Icon';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  busy,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size}${className ? ` ${className}` : ''}`}
      disabled={busy || rest.disabled}
      {...rest}
    >
      {busy ? <span className="spinner spinner-inline" /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' switch-on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  );
}

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`row${disabled ? ' row-disabled' : ''}`}>
      <div className="row-text">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <Toggle label={title} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
  size = 'md',
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode; disabled?: boolean }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Read by screen readers: what this group chooses. */
  label: string;
  size?: 'sm' | 'md';
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.findIndex((option) => option.value === value);

  // Arrow keys move the selection, like native radio groups.
  const move = (delta: number) => {
    const count = options.length;
    let next = selected < 0 ? 0 : selected;
    for (let step = 0; step < count; step += 1) {
      next = (next + delta + count) % count;
      if (!options[next].disabled) break;
    }
    onChange(options[next].value);
    buttons.current[next]?.focus();
  };

  return (
    <div
      className={`segmented segmented-${size}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option, index) => {
        const active = index === selected;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active || (selected < 0 && index === 0) ? 0 : -1}
            className={`segmented-item${active ? ' segmented-item-active' : ''}`}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Cards that pick one value, e.g. the polish levels. A radio group for
 * assistive tech: one tab stop, arrow keys move the selection.
 */
export function RadioCards<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  cardClassName,
  disabled,
  render,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; disabled?: boolean; className?: string }>;
  onChange: (value: T) => void;
  className: string;
  cardClassName: string;
  disabled?: boolean;
  render: (value: T, active: boolean) => ReactNode;
}) {
  const cards = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.findIndex((option) => option.value === value);

  const move = (delta: number) => {
    const count = options.length;
    let next = selected < 0 ? 0 : selected;
    for (let step = 0; step < count; step += 1) {
      next = (next + delta + count) % count;
      if (!options[next].disabled) break;
    }
    onChange(options[next].value);
    cards.current[next]?.focus();
  };

  return (
    <div
      className={className}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option, index) => {
        const active = index === selected;
        return (
          <button
            key={option.value}
            ref={(element) => {
              cards.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active || (selected < 0 && index === 0) ? 0 : -1}
            className={`${cardClassName}${active ? ` ${cardClassName}-active` : ''}${option.className ? ` ${option.className}` : ''}`}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
          >
            {render(option.value, active)}
          </button>
        );
      })}
    </div>
  );
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

export function Chip({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`chip chip-${tone}`}>
      {icon && <Icon name={icon} size={12} strokeWidth={2.5} />}
      {children}
    </span>
  );
}

export function Card({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {(title || action) && (
        <header className="card-header">
          <div>
            {title && <h3>{title}</h3>}
            {description && <p className="card-description">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Notice({ tone = 'neutral', icon, children, action }: { tone?: Tone; icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`}>
      <Icon name={icon ?? (tone === 'success' ? 'check' : tone === 'neutral' || tone === 'accent' ? 'info' : 'alert')} size={16} />
      <div className="notice-body">{children}</div>
      {action}
    </div>
  );
}

export function KeyCap({ children, large, pressed }: { children: ReactNode; large?: boolean; pressed?: boolean }) {
  return <kbd className={`keycap${large ? ' keycap-large' : ''}${pressed ? ' keycap-pressed' : ''}`}>{children}</kbd>;
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0.02, Math.min(1, value));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {/* scaleX instead of width: a transform animates without relayout. */}
      <div className="progress-bar" style={{ transform: `scaleX(${clamped})` }} />
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" />;
}
