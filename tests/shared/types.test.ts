// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import type {
  MessageType,
  Peer,
  Message,
  LogEntry,
  SharedStateEntry,
  AgentConfig,
  ProjectConfig,
  RegisterRequest,
  RegisterResponse,
  HealthResponse,
} from '../../src/shared/types.js';

describe('types - compile-time validation', () => {
  it('MessageType accepts all valid types', () => {
    const types: MessageType[] = [
      'message', 'question', 'response', 'contract_update',
      'notification', 'task_request', 'task_complete',
    ];
    expect(types).toHaveLength(7);
  });

  it('Peer interface has all required fields', () => {
    const peer: Peer = {
      id: 'abc',
      project_id: 'proj',
      pid: 123,
      name: 'Turing',
      role: 'backend',
      agent_type: 'claude-code',
      cwd: '/tmp',
      git_root: null,
      git_branch: null,
      tty: null,
      summary: '',
      registered_at: '2025-01-01T00:00:00Z',
      last_seen: '2025-01-01T00:00:00Z',
    };
    expect(peer.id).toBe('abc');
    expect(peer.git_root).toBeNull();
  });

  it('Message interface has delivered as number', () => {
    const msg: Message = {
      id: 1,
      project_id: 'proj',
      from_id: 'a',
      to_id: 'b',
      type: 'message',
      text: 'hello',
      metadata: null,
      sent_at: '2025-01-01T00:00:00Z',
      delivered: 0,
    };
    expect(msg.delivered).toBe(0);
  });

  it('ProjectConfig can hold multiple agents', () => {
    const config: ProjectConfig = {
      name: 'test',
      description: 'Test project',
      created_at: '2025-01-01T00:00:00Z',
      agents: [
        { role: 'backend', cwd: '/app/back', agent_cmd: 'claude', agent_args: [], instructions: '' },
        { role: 'frontend', cwd: '/app/front', agent_cmd: 'claude', agent_args: [], instructions: '' },
      ],
    };
    expect(config.agents).toHaveLength(2);
  });

  it('HealthResponse has expected shape', () => {
    const health: HealthResponse = {
      status: 'ok',
      peers: 5,
      pending_messages: 3,
    };
    expect(health.status).toBe('ok');
  });
});
