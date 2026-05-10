// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Origin / Host policy for the broker. The threat model in SECURITY.md
// declares zaipex-acc as a localhost-only tool with no auth — meaning
// any code running on the user's box already has the same trust as the
// agents. The line we draw is at the BROWSER boundary: a webpage opened
// in the user's browser must not be able to talk to the broker as if it
// were the dashboard.
//
// What blocks the easy CSRF / WS-hijack from a remote site (the common
// case) is rejecting cross-origin requests. We allow:
//   - Origin: http(s)://localhost(:port)?     ← dashboard, dev tools
//   - Origin: http(s)://127.0.0.1(:port)?     ← same
//   - Origin: http(s)://[::1](:port)?         ← IPv6 loopback
//   - Origin missing AND remote = loopback    ← curl/test/CLI clients
//
// Notes:
//   - Browsers ALWAYS send Origin on cross-origin WS / fetch, so a
//     remote attacker can't bypass by omitting it.
//   - A non-browser client (curl, ws lib, our own tests) typically does
//     NOT send Origin — that's why undefined falls back to checking
//     remoteAddress is loopback. If the broker accidentally bound to
//     0.0.0.0 (deployment misconfiguration) this is the last line of
//     defense.
//   - This policy still allows a malicious dev-server on
//     http://127.0.0.1:8080 (different port, same machine) — closing
//     that gap requires a per-connection token the attacker can't guess
//     and is tracked in followups.md.

import type { IncomingMessage } from 'node:http';

const LOCALHOST_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/;
const LOCALHOST_HOST_RE = /^(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/;

function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1'
  );
}

export function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    return LOCALHOST_ORIGIN_RE.test(origin);
  }
  return isLoopback(req.socket.remoteAddress ?? undefined);
}

export function isAllowedHost(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (typeof host !== 'string' || host.length === 0) return false;
  return LOCALHOST_HOST_RE.test(host);
}

// "application/json" optionally followed by "; charset=utf-8" or any
// other parameter. Anything else (text/plain, multipart, missing CT) is
// rejected so cross-origin "simple requests" (which can omit preflight
// when CT is text/plain or form-urlencoded) cannot reach the broker.
export function isJsonContentType(req: IncomingMessage): boolean {
  const ct = req.headers['content-type'];
  if (typeof ct !== 'string') return false;
  const main = ct.split(';', 1)[0].trim().toLowerCase();
  return main === 'application/json';
}

// Write a minimal HTTP error response on a raw upgrade socket so the
// client sees a proper 4xx instead of a TCP RST. ws lib's handleUpgrade
// hasn't been called yet at this point so the socket is still in HTTP
// mode.
export function rejectUpgrade(
  socket: { write: (s: string) => void; destroy: () => void },
  status: number,
  reason: string,
): void {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      'Connection: close\r\n' +
      'Content-Length: 0\r\n' +
      '\r\n',
  );
  socket.destroy();
}
