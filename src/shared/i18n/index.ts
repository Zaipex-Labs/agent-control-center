// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';
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

function detectMacosLocale(): string | null {
  if (platform() !== 'darwin') return null;
  try {
    const out = execSync('defaults read -g AppleLocale', {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 500,
    }).toString().trim();
    return matchSupported(out);
  } catch {
    return null;
  }
}

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

  // 3. macOS system language first (AppleLocale is the real source of truth;
  //    LANG is usually en_US.UTF-8 by Terminal.app default regardless of UI lang)
  //    ACC_DISABLE_OS_LOCALE is an undocumented test-only escape hatch so the
  //    POSIX-env fallback can be tested deterministically on macOS.
  if (!process.env['ACC_DISABLE_OS_LOCALE']) {
    const mac = detectMacosLocale();
    if (mac) return mac;
  }

  // 4. POSIX locale env vars (LC_ALL > LC_MESSAGES > LANG > LANGUAGE)
  for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANG', 'LANGUAGE']) {
    const v = process.env[key];
    if (v && v !== 'C' && v !== 'POSIX') {
      const m = matchSupported(v);
      if (m) return m;
    }
  }

  // 5. Default
  return 'en';
}

export function getLang(): string {
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
