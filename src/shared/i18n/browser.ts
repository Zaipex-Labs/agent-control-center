import { en } from './en.js';
import { es } from './es.js';

const translations: Record<string, Record<string, string>> = { en, es };

let cachedLang: string | null = null;

function matchSupported(raw: string): string | null {
  const lower = raw.toLowerCase();
  for (const code of Object.keys(translations)) {
    if (lower.startsWith(code)) return code;
  }
  return null;
}

function detectLang(): string {
  // 1. Explicit override in localStorage
  try {
    const override = localStorage.getItem('acc_lang');
    if (override && translations[override]) return override;
  } catch {
    // localStorage may be unavailable (SSR, private mode)
  }

  // 2. navigator.languages / navigator.language
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (nav) {
    const candidates = nav.languages && nav.languages.length > 0
      ? nav.languages
      : nav.language ? [nav.language] : [];
    for (const c of candidates) {
      const m = matchSupported(c);
      if (m) return m;
    }
  }

  // 3. Default
  return 'en';
}

export function getLang(): string {
  if (cachedLang === null) cachedLang = detectLang();
  return cachedLang;
}

export function setLang(lang: string): void {
  if (!translations[lang]) return;
  cachedLang = lang;
  try {
    localStorage.setItem('acc_lang', lang);
  } catch {
    // Ignore
  }
}

export function t(key: string, params?: Record<string, string | number>): string {
  const lang = getLang();
  let text = translations[lang]?.[key] ?? translations['en']?.[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }

  return text;
}
