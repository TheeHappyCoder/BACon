export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const EASE_OUT_CSS = 'cubic-bezier(0.22, 1, 0.36, 1)';

export const SPRING_SWAP = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 34,
  mass: 0.7,
};

export const PANEL = { type: 'spring', stiffness: 550, damping: 38 } as const;
export const LAYOUT = { type: 'spring', stiffness: 550, damping: 40 } as const;
export const FADE_IN = { duration: 0.16, ease: 'easeOut' } as const;
export const FADE_OUT = { duration: 0.1, ease: 'easeOut' } as const;
