import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

import { Icon } from './Icon';

/**
 * A short explanation shown on hover and on keyboard focus. The trigger is
 * described by it for screen readers.
 */
export function Tooltip({
  text,
  children,
  align = 'center',
}: {
  text: string;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}) {
  const id = useId();
  const trigger = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': id })
    : children;

  return (
    <span className="tooltip-anchor">
      {trigger}
      <span role="tooltip" id={id} className={`tooltip tooltip-${align}`}>
        {text}
      </span>
    </span>
  );
}

/** An info icon that explains the thing next to it. */
export function InfoTip({ text, label, align = 'start' }: { text: string; label: string; align?: 'start' | 'center' | 'end' }) {
  return (
    <Tooltip text={text} align={align}>
      <button type="button" className="info-button" aria-label={label}>
        <Icon name="info" size={14} />
      </button>
    </Tooltip>
  );
}
