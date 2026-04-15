import { selectAllPeers, deletePeer } from './database.js';
import { broadcast } from './websocket.js';

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function cleanStalePeers(): number {
  const peers = selectAllPeers();
  let removed = 0;
  for (const peer of peers) {
    // Skip dashboard peers — they don't have real PIDs, they use heartbeats
    if (peer.agent_type === 'dashboard') continue;
    if (!isProcessAlive(peer.pid)) {
      deletePeer(peer.id);
      // Notify the dashboard so its agent list matches reality. Without this
      // the UI keeps stale peers in React state until the user navigates away.
      broadcast('peer:disconnected', { id: peer.id }, peer.project_id);
      removed++;
    }
  }
  return removed;
}
