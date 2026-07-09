import { createContext, useContext, type ReactNode } from 'react';
import type { ThemeOverride } from '../config/schema.js';

export interface Theme {
  accent: string;
  ok: string;
  warn: string;
  error: string;
}

export const PRESETS: Record<string, Theme> = {
  default: { accent: 'cyan', ok: 'green', warn: 'yellow', error: 'red' },
  nord: { accent: '#88C0D0', ok: '#A3BE8C', warn: '#EBCB8B', error: '#BF616A' },
  gruvbox: { accent: '#83A598', ok: '#B8BB26', warn: '#FABD2F', error: '#FB4934' },
};

export function resolveTheme(name: string, overrides?: ThemeOverride): Theme {
  const base = PRESETS[name] ?? PRESETS.default!;
  return { ...base, ...pruneUndefined(overrides) };
}

function pruneUndefined(o?: ThemeOverride): Partial<Theme> {
  if (!o) return {};
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as Partial<Theme>;
}

const ThemeContext = createContext<Theme>(PRESETS.default!);
export const useTheme = () => useContext(ThemeContext);
export function ThemeProvider({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
