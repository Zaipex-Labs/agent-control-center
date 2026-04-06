import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { t, resetLangCache } from '../../src/shared/i18n/index.js';

// Save original env
const originalEnv = { ...process.env };

afterEach(() => {
  // Restore env
  process.env = { ...originalEnv };
  resetLangCache();
});

beforeEach(() => {
  resetLangCache();
});

describe('i18n - t()', () => {
  it('returns English text by default when LANG is not Spanish', () => {
    process.env['ACC_LANG'] = 'en';
    resetLangCache();
    expect(t('ui.noProjects')).toContain('No projects found');
  });

  it('returns Spanish text when ACC_LANG=es', () => {
    process.env['ACC_LANG'] = 'es';
    resetLangCache();
    expect(t('ui.noProjects')).toContain('No se encontraron proyectos');
  });

  it('falls back to English for unknown language', () => {
    process.env['ACC_LANG'] = 'fr';
    resetLangCache();
    // Should fall back to English
    expect(t('ui.noProjects')).toContain('No projects found');
  });

  it('returns the key itself if not found in any language', () => {
    process.env['ACC_LANG'] = 'en';
    resetLangCache();
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('interpolates parameters', () => {
    process.env['ACC_LANG'] = 'en';
    resetLangCache();
    const result = t('project.created', { name: 'test-proj' });
    expect(result).toContain('test-proj');
    expect(result).toContain('created');
  });

  it('interpolates parameters in Spanish', () => {
    process.env['ACC_LANG'] = 'es';
    resetLangCache();
    const result = t('project.created', { name: 'mi-proyecto' });
    expect(result).toContain('mi-proyecto');
  });

  it('handles multiple parameters', () => {
    process.env['ACC_LANG'] = 'en';
    resetLangCache();
    const result = t('send.sent', { count: '3', role: 'backend' });
    expect(result).toContain('3');
    expect(result).toContain('backend');
  });

  it('detects Spanish from system LANG env var', () => {
    delete process.env['ACC_LANG'];
    process.env['LANG'] = 'es_MX.UTF-8';
    resetLangCache();
    expect(t('ui.projectsHeading')).toBe('Proyectos');
  });

  it('defaults to English when LANG has no Spanish indicator', () => {
    delete process.env['ACC_LANG'];
    process.env['LANG'] = 'en_US.UTF-8';
    resetLangCache();
    expect(t('ui.projectsHeading')).toBe('Projects');
  });
});

describe('i18n - translation completeness', () => {
  it('en and es have the same keys', async () => {
    const { en } = await import('../../src/shared/i18n/en.js');
    const { es } = await import('../../src/shared/i18n/es.js');

    const enKeys = Object.keys(en).sort();
    const esKeys = Object.keys(es).sort();

    // Every English key must exist in Spanish
    const missingInEs = enKeys.filter(k => !esKeys.includes(k));
    expect(missingInEs, `Keys in en.ts missing from es.ts: ${missingInEs.join(', ')}`).toHaveLength(0);

    // Every Spanish key must exist in English
    const missingInEn = esKeys.filter(k => !enKeys.includes(k));
    expect(missingInEn, `Keys in es.ts missing from en.ts: ${missingInEn.join(', ')}`).toHaveLength(0);
  });

  it('no translation value is empty', async () => {
    const { en } = await import('../../src/shared/i18n/en.js');
    const { es } = await import('../../src/shared/i18n/es.js');

    for (const [key, value] of Object.entries(en)) {
      expect(value.length, `en.ts key "${key}" is empty`).toBeGreaterThan(0);
    }
    for (const [key, value] of Object.entries(es)) {
      expect(value.length, `es.ts key "${key}" is empty`).toBeGreaterThan(0);
    }
  });

  it('interpolation placeholders match between en and es', async () => {
    const { en } = await import('../../src/shared/i18n/en.js');
    const { es } = await import('../../src/shared/i18n/es.js');

    const placeholderRegex = /\{(\w+)\}/g;

    for (const key of Object.keys(en)) {
      const enMatches = [...en[key].matchAll(placeholderRegex)].map(m => m[1]).sort();
      const esValue = es[key];
      if (!esValue) continue;
      const esMatches = [...esValue.matchAll(placeholderRegex)].map(m => m[1]).sort();

      expect(esMatches, `Placeholder mismatch for key "${key}": en={${enMatches}} es={${esMatches}}`).toEqual(enMatches);
    }
  });
});
