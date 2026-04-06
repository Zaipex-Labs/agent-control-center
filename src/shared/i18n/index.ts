import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { en } from './en.js';
import { es } from './es.js';

const translations: Record<string, Record<string, string>> = { en, es };

let cachedLang: string | null = null;

function detectLang(): string {
  // 1. ACC_LANG env var
  const envLang = process.env['ACC_LANG'];
  if (envLang && translations[envLang]) return envLang;

  // 2. Config file
  try {
    const configPath = join(process.env['ACC_HOME'] ?? join(homedir(), '.zaipex-acc'), 'config.json');
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, string>;
      if (config['lang'] && translations[config['lang']]) return config['lang'];
    }
  } catch {
    // Ignore config read errors
  }

  // 3. System LANG
  const sysLang = process.env['LANG'] ?? '';
  if (sysLang.includes('es')) return 'es';

  // 4. Default
  return 'en';
}

function getLang(): string {
  if (cachedLang === null) {
    cachedLang = detectLang();
  }
  return cachedLang;
}

export function resetLangCache(): void {
  cachedLang = null;
}

export function t(key: string, params?: Record<string, string>): string {
  const lang = getLang();
  let text = translations[lang]?.[key] ?? translations['en']?.[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, v);
    }
  }

  return text;
}
