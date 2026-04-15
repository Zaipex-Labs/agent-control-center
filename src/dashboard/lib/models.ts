// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Hardcoded model catalog — placeholder until the broker exposes
// GET /api/v1/models. The Agent editor picks from this list and the
// provider dot in the ID badge is driven by the provider field.

export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'other';

export interface ModelOption {
  id: string;
  label: string;
  provider: ModelProvider;
}

export const MODELS: ModelOption[] = [
  { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6',   provider: 'anthropic' },
  { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  provider: 'anthropic' },
  { id: 'claude-sonnet-4-5-20250414',label: 'Claude Sonnet 4.5', provider: 'anthropic' },
  { id: 'claude-opus-4-20250514',    label: 'Claude Opus 4',     provider: 'anthropic' },
  { id: 'claude-sonnet-4-20250514',  label: 'Claude Sonnet 4',   provider: 'anthropic' },
];

export const DEFAULT_MODEL_ID = 'claude-sonnet-4-6';

export function getModel(id: string | undefined | null): ModelOption | null {
  if (!id) return null;
  return MODELS.find(m => m.id === id) ?? null;
}

export function getModelLabel(id: string | undefined | null): string {
  return getModel(id)?.label ?? id ?? '';
}

export function getModelProvider(id: string | undefined | null): ModelProvider {
  return getModel(id)?.provider ?? 'other';
}

export const PROVIDER_DOTS: Record<ModelProvider, string> = {
  anthropic: '#E8823A',
  openai:    '#10A37F',
  google:    '#4285F4',
  other:     '#9AA0AA',
};
