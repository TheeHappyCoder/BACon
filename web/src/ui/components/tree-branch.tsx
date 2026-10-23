import * as React from 'react';

import { cn } from '../utils';

export function TreeBranch({
  active = false,
  className,
  last = false,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & {
  active?: boolean;
  last?: boolean;
}) {
  const lineClass = 'border-border';

  return (
    <span
      aria-hidden="true"
      className={cn('relative z-10 h-full w-4 shrink-0', className)}
      data-active={active || undefined}
      data-last={last || undefined}
      data-slot="tree-branch"
      {...props}
    >
      <span
        className={cn(
          'absolute left-1 -top-1 h-[calc(50%+0.25rem)] w-2.5 rounded-bl-[6px] border-b border-l',
          lineClass,
        )}
      />
      {!last ? (
        <span
          className={cn(
            'absolute -bottom-1 left-1 top-1/2 border-l',
            lineClass,
          )}
        />
      ) : null}
    </span>
  );
}
