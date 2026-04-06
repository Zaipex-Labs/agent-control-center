import { execSync } from 'node:child_process';

const log = (msg: string) => console.error(`[broker:tmux] ${msg}`);

export function hasTmuxSession(projectId: string): boolean {
  try {
    execSync(`tmux has-session -t acc-${projectId}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function tmuxNotify(
  projectId: string,
  targetRole: string,
  fromName: string,
  fromRole: string,
): boolean {
  const sessionName = `acc-${projectId}`;
  if (!hasTmuxSession(projectId)) return false;

  const paneTarget = `${sessionName}:${targetRole}`;
  const notification = `Tienes un nuevo mensaje de ${fromName} (${fromRole}). Usa check_messages para leerlo.`;
  try {
    execSync(`tmux send-keys -t ${paneTarget} -l ${shellEscape(notification)}`, {
      stdio: 'pipe',
      timeout: 3000,
    });
    execSync(`tmux send-keys -t ${paneTarget} Enter`, {
      stdio: 'pipe',
      timeout: 3000,
    });
    log(`notify OK to ${paneTarget} (from ${fromRole})`);
    return true;
  } catch (e) {
    log(`notify FAILED to ${paneTarget}: ${e}`);
    return false;
  }
}
