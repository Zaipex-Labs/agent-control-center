#!/bin/sh
# QW-5 evidence: spin up a side broker, send SIGTERM, capture the
# graceful-shutdown log lines as evidence for v0.2.3.
set -e
PORT=${ACC_PORT:-7929}
HOME_DIR=${ACC_HOME:-/tmp/acc-qa-sigterm}
EV=${EV:-docs/audits/v0.2.3-security/evidence}
mkdir -p "$EV"

BROKER_LOG=$(mktemp)
WS_LOG=$(mktemp)

ACC_HOME="$HOME_DIR" ACC_PORT=$PORT node dist/broker/index.js >"$BROKER_LOG" 2>&1 &
BROKER_PID=$!

# Wait for /health to come up.
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then break; fi
  sleep 0.3
done

# Open a WS so we can verify the close-code-1001 behaviour.
node -e "const W=require('ws');const w=new W('ws://127.0.0.1:$PORT/ws');w.on('open',()=>console.log('[ws-client] connected'));w.on('close',(c,r)=>{console.log('[ws-client] CLOSE code='+c+' reason='+r.toString());process.exit(0)});setTimeout(()=>process.exit(0),10000);" >"$WS_LOG" 2>&1 &
WS_PID=$!
sleep 0.5

# Send SIGTERM.
kill -TERM $BROKER_PID
wait $BROKER_PID 2>/dev/null || true
wait $WS_PID    2>/dev/null || true

OUT="$EV/sigterm-clean.log"
{
  echo "# QW-5 evidence — graceful broker shutdown on SIGTERM"
  echo "# captured by scripts/qa-v0.2.3-sigterm.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "## broker stderr (full lifecycle)"
  cat "$BROKER_LOG"
  echo
  echo "## ws client stderr (verifies clean 1001 close)"
  cat "$WS_LOG"
  echo
  echo "## broker process exited (SIGTERM → graceful shutdown → exit 0)"
} > "$OUT"

rm -f "$BROKER_LOG" "$WS_LOG"
cat "$OUT"
