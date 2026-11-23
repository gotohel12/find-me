/** Tiny i18n: Arabic (RTL) + English, auto-detected, switchable. */
import en from '../../content/locales/en.json' with { type: 'json' };
import ar from '../../content/locales/ar.json' with { type: 'json' };

export type Lang = 'ar' | 'en';
type Dict = Record<string, string>;
const DICTS: Record<Lang, Dict> = { en, ar };
const STORAGE_KEY = 'findme.lang';

export function detectLang(preferred: readonly string[], stored: string | null): Lang {
  if (stored === 'ar' || stored === 'en') return stored;
  for (const l of preferred) {
    const base = l.toLowerCase().split('-')[0];
    if (base === 'ar') return 'ar';
    if (base === 'en') return 'en';
  }
  return 'en';
}

export function dirOf(lang: Lang): 'rtl' | 'ltr' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/** Translate; falls back to English, then to the key itself. */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(formatNumber(lang, v));
  }
  return s;
}

function formatNumber(lang: Lang, v: string | number): string {
  if (typeof v !== 'number') return v;
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-SA' : 'en-US').format(v);
}

export function missingKeys(): { ar: string[]; en: string[] } {
  const ka = new Set(Object.keys(ar));
  const ke = new Set(Object.keys(en));
  return { ar: [...ke].filter((k) => !ka.has(k)), en: [...ka].filter((k) => !ke.has(k)) };
}

// ---- browser glue ----------------------------------------------------------
function safeGet(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function initialLang(): Lang {
  const nav = (globalThis.navigator?.languages as readonly string[] | undefined) ?? [];
  return detectLang(nav, safeGet());
}

export function applyLang(lang: Lang): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lang);
  } catch {
    /* private mode: fine */
  }
  const html = globalThis.document?.documentElement;
  if (html) {
    html.lang = lang;
    html.dir = dirOf(lang);
  }
}
