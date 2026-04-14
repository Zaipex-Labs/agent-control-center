import { Command } from 'commander';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROJECTS_DIR, ensureDirectories } from '../../shared/config.js';
import type { ProjectConfig, AgentConfig } from '../../shared/types.js';
import { success, err, dim, printProject, printProjectList } from '../ui.js';
import { t } from '../../shared/i18n/index.js';

function projectPath(name: string): string {
  return join(PROJECTS_DIR, `${name}.json`);
}

function loadProject(name: string): ProjectConfig {
  const path = projectPath(name);
  if (!existsSync(path)) {
    console.error(err(t('project.notFound', { name, path })));
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as ProjectConfig;
}

function saveProject(config: ProjectConfig): void {
  ensureDirectories();
  writeFileSync(projectPath(config.name), JSON.stringify(config, null, 2) + '\n');
}

function loadAllProjects(): ProjectConfig[] {
  ensureDirectories();
  try {
    return readdirSync(PROJECTS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(readFileSync(join(PROJECTS_DIR, f), 'utf-8')) as ProjectConfig)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ── "acc projects" (top-level) ─────────────────────────────────

export function registerProjectsCommand(program: Command): void {
  program
    .command('projects')
    .description(t('cmd.projects'))
    .action(() => {
      printProjectList(loadAllProjects());
    });
}

// ── "acc project <subcommand>" ─────────────────────────────────

export function registerProjectCommand(program: Command): void {
  const project = program
    .command('project')
    .description(t('cmd.project'));

  project
    .command('create <name>')
    .description(t('cmd.projectCreate'))
    .option('-d, --description <desc>', t('cmd.projectCreateDescOpt'), '')
    .action((name: string, opts: { description: string }) => {
      ensureDirectories();
      const path = projectPath(name);
      if (existsSync(path)) {
        console.error(err(t('project.alreadyExists', { name })));
        process.exit(1);
      }

      const config: ProjectConfig = {
        name,
        description: opts.description,
        created_at: new Date().toISOString(),
        agents: [],
      };
      saveProject(config);
      console.log(success(t('project.created', { name })));
      console.log(dim(`  ${t('project.configAt', { path })}`));
    });

  project
    .command('add-agent <name>')
    .description(t('cmd.projectAddAgent'))
    .requiredOption('-r, --role <role>', t('cmd.projectAddAgentRole'))
    .requiredOption('--cwd <dir>', t('cmd.projectAddAgentCwd'))
    .option('--name <name>', t('cmd.projectAddAgentName'))
    .option('--cmd <command>', t('cmd.projectAddAgentCmd'), 'claude')
    .option('--args <args>', t('cmd.projectAddAgentArgs'), '')
    .option('-i, --instructions <text>', t('cmd.projectAddAgentInstr'), '')
    .action((name: string, opts: { role: string; cwd: string; name?: string; cmd: string; args: string; instructions: string }) => {
      const config = loadProject(name);

      const existing = config.agents.find(a => a.role === opts.role);
      if (existing) {
        console.error(err(t('project.agentExists', { role: opts.role, name })));
        process.exit(1);
      }

      const resolvedCwd = resolve(opts.cwd);
      if (!existsSync(resolvedCwd)) {
        console.error(err(`Directory does not exist: ${resolvedCwd}`));
        process.exit(1);
      }

      const agent: AgentConfig = {
        role: opts.role,
        name: opts.name,
        cwd: resolvedCwd,
        agent_cmd: opts.cmd,
        agent_args: opts.args ? opts.args.split(',').map(a => a.trim()) : [],
        instructions: opts.instructions,
      };
      config.agents.push(agent);
      saveProject(config);
      console.log(success(t('project.agentAdded', { role: opts.role, name })));
    });

  project
    .command('remove-agent <name>')
    .description(t('cmd.projectRemoveAgent'))
    .requiredOption('-r, --role <role>', t('cmd.projectRemoveAgentRole'))
    .action((name: string, opts: { role: string }) => {
      const config = loadProject(name);

      const idx = config.agents.findIndex(a => a.role === opts.role);
      if (idx === -1) {
        console.error(err(t('project.agentNotFound', { role: opts.role, name })));
        process.exit(1);
      }

      config.agents.splice(idx, 1);
      saveProject(config);
      console.log(success(t('project.agentRemoved', { role: opts.role, name })));
    });

  project
    .command('show <name>')
    .description(t('cmd.projectShow'))
    .action((name: string) => {
      const config = loadProject(name);
      printProject(config);
    });
}
