'use client';

import { useId, useMemo } from 'react';
import { cn } from '../utils';

/*
 * GradientAvatar: the vercel/avatar idea in NovaCore's colours. The name hashes to one of eight curated diagonal
 * gradients; the same name always draws the same avatar. Initials sit on top in white.
 *
 * It is decorative: an avatar always sits beside the name it stands for, so it stays out of the accessible name.
 *
 * <GradientAvatar name="Ada Lovelace" size={36} />
 */

interface GradientAvatarProps {
  name: string;
  size?: number;
  ring?: boolean;
  shape?: 'circle' | 'rounded';
  /** Hide the initials, for very small marks. */
  initials?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** A stable 32-bit hash of the name (FNV-1a), so the colour never changes between renders or sessions. */
function hash(value: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Eight hand-picked gradients that sit with NovaCore's palette: blue, indigo, violet, rose, coral, amber, teal and
 * slate, each a light tone at the top left to a deeper one at the bottom right so white initials read. No greens or
 * yellow-greens, which turn sickly on avatars.
 */
const GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ['#7b98f2', '#2f52c4'],
  ['#958ee9', '#4a3fb3'],
  ['#b98ae2', '#7646b5'],
  ['#ee93b2', '#bd4672'],
  ['#f5a68c', '#c8573b'],
  ['#f0bf72', '#c47f25'],
  ['#74cfd1', '#25879a'],
  ['#a3abbd', '#525b6e'],
];

/** The gradient a name always gets. */
export function avatarGradient(name: string) {
  const [from, to] = GRADIENTS[hash(name.trim().toLowerCase()) % GRADIENTS.length];
  return { from, to };
}

/** Up to two initials: the first letters of the first two words ("Mark Steyn" → MS, "ada.lovelace" → AL, "Mark" → M). */
export function avatarInitials(name: string) {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? [words[0][0]] : [words[0][0], words[1][0]];
  return letters.join('').toUpperCase();
}

export function GradientAvatar({
  name = 'User',
  size = 36,
  ring,
  shape = 'rounded',
  initials = true,
  className,
  style,
}: GradientAvatarProps) {
  const id = useId().replace(/:/g, '-');
  const { from, to } = useMemo(() => avatarGradient(name), [name]);
  const letters = useMemo(() => avatarInitials(name), [name]);
  const showInitials = initials && size >= 18;
  const fontSize = Math.round(size * (letters.length > 1 ? 0.36 : 0.42));

  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden',
        shape === 'circle' ? 'rounded-full' : 'rounded-[22%]',
        ring && 'ring-1 ring-black/10 ring-offset-1 ring-offset-(--surface-card)',
        className,
      )}
      style={{ width: size, height: size, ...style }}
    >
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 80 80" className="absolute inset-0 block">
        <defs>
          <linearGradient id={`ga-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <rect width="80" height="80" fill={`url(#ga-${id})`} />
      </svg>
      {showInitials ? (
        <span
          aria-hidden="true"
          className="relative font-medium leading-none tracking-[-0.02em] text-white [text-shadow:0_1px_2px_rgba(0,0,0,.18)]"
          style={{ fontSize }}
        >
          {letters}
        </span>
      ) : null}
    </span>
  );
}
