// Default agent name lookup, browser- and Node-safe.
// The idea is that every role maps to a memorable scientist-style name so
// agents feel like team members instead of "backend #2".

const DEFAULT_NAMES: Record<string, string> = {
  backend: 'Turing',
  frontend: 'Lovelace',
  qa: 'Curie',
  architect: 'Da Vinci',
  devops: 'Tesla',
  data: 'Gauss',
  ml: 'Euler',
  analytics: 'Fibonacci',
  security: 'Enigma',
};

const FALLBACK_NAMES = [
  'Faraday', 'Newton', 'Hypatia', 'Hawking', 'Galileo',
  'Ramanujan', 'Noether', 'Fermat', 'Kepler', 'Planck',
];

export function getDefaultName(role: string): string {
  if (DEFAULT_NAMES[role]) return DEFAULT_NAMES[role];
  // Deterministic pick based on role string so same role always gets same name
  let hash = 0;
  for (let i = 0; i < role.length; i++) {
    hash = ((hash << 5) - hash + role.charCodeAt(i)) | 0;
  }
  return FALLBACK_NAMES[Math.abs(hash) % FALLBACK_NAMES.length];
}
