import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:7929/ws?project_id=demo-team', {
  headers: { Origin: 'http://localhost:7929' },
});

const start = Date.now();
let pings = 0;
let pongs = 0;

ws.on('open', () => {
  console.log(`[${(Date.now()-start)/1000}s] OPEN — listening for heartbeat`);
});

ws.on('ping', () => {
  pings++;
  console.log(`[${((Date.now()-start)/1000).toFixed(1)}s] received PING #${pings} from broker`);
});

ws.on('pong', () => {
  pongs++;
  console.log(`[${((Date.now()-start)/1000).toFixed(1)}s] received PONG #${pongs}`);
});

ws.on('close', (code, reason) => {
  console.log(`[${((Date.now()-start)/1000).toFixed(1)}s] CLOSE code=${code} reason=${reason}`);
});

ws.on('error', (e) => {
  console.log(`[${((Date.now()-start)/1000).toFixed(1)}s] ERROR ${e.message}`);
});

// Auto-pong is enabled by default in ws — peer stays alive.
// Run for 95s to capture 3 full 30s heartbeat cycles.
setTimeout(() => {
  console.log(`\nFINAL: ${pings} pings received over 95s. Expected: 3 (one per 30s tick).`);
  ws.close();
  process.exit(0);
}, 95_000);
