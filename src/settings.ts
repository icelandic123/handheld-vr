/**
 * Player comfort settings. Kept in this browser only (localStorage), and
 * everything works without them.
 */
export type ScreenDistance = 'near' | 'normal' | 'far';
export type PuppetHand = 'right' | 'left';

export interface Settings {
  /** Story narration and hints printed on the screen. */
  subtitles: boolean;
  largeText: boolean;
  screen: ScreenDistance;
  /** Which hand makes the one-hand puppets. */
  hand: PuppetHand;
}

export const DEFAULT_SETTINGS: Settings = { subtitles: true, largeText: false, screen: 'normal', hand: 'right' };

/** Screen scale about the player's eyes for each distance (1 = 1.35 m away). */
export const SCREEN_SCALE: Record<ScreenDistance, number> = { near: 0.85, normal: 1, far: 1.25 };

const KEY = 'little-lamp-theatre.settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* private window or blocked storage: use defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

const current: Settings = load();
const listeners = new Set<(s: Settings, changed: (keyof Settings)[]) => void>();

export function getSettings(): Readonly<Settings> {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => patch[k] !== undefined && patch[k] !== current[k]);
  if (!changed.length) return;
  Object.assign(current, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* not saved; still applies for this visit */
  }
  for (const l of listeners) l(current, changed);
}

export function onSettingsChange(fn: (s: Settings, changed: (keyof Settings)[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The next value of a setting, for one-poke cycling buttons. */
export function cycled<K extends keyof Settings>(key: K): Settings[K] {
  const v = current[key];
  const order: Record<keyof Settings, unknown[]> = {
    subtitles: [true, false],
    largeText: [false, true],
    screen: ['near', 'normal', 'far'],
    hand: ['right', 'left'],
  };
  const list = order[key];
  return list[(list.indexOf(v) + 1) % list.length] as Settings[K];
}

/** Short labels for the settings card and the landing page. */
export function describe(s: Settings): { key: keyof Settings; label: string; value: string }[] {
  return [
    { key: 'subtitles', label: 'Subtitles', value: s.subtitles ? 'on' : 'off' },
    { key: 'largeText', label: 'Text', value: s.largeText ? 'large' : 'normal' },
    { key: 'screen', label: 'Screen', value: s.screen },
    { key: 'hand', label: 'Puppet hand', value: s.hand },
  ];
}
