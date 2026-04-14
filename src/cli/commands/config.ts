import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ACC_HOME, ensureDirectories } from '../../shared/config.js';
import { success, err } from '../ui.js';
import { t } from '../../shared/i18n/index.js';

const CONFIG_PATH = join(ACC_HOME, 'config.json');

function loadConfig(): Record<string, string> {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, string>;
    }
  } catch {
    // Ignore
  }
  return {};
}

function saveConfig(config: Record<string, string>): void {
  ensureDirectories();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

const SUPPORTED_LANGS = ['en', 'es'];

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description(t('cmd.config'));

  const set = config
    .command('set')
    .description(t('cmd.configSet'));

  set
    .command('lang <language>')
    .description(t('cmd.configSetLang'))
    .action((lang: string) => {
      if (!SUPPORTED_LANGS.includes(lang)) {
        console.error(err(t('config.invalidLang', { lang })));
        process.exit(1);
      }

      const cfg = loadConfig();
      cfg['lang'] = lang;
      saveConfig(cfg);
      console.log(success(t('config.langSet', { lang })));
    });
}
