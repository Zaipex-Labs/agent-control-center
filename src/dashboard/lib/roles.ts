// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Role colors used by the agent ID cards and team cards.
// Each role has an avatar background color, a badge background, and
// a badge foreground. Unknown roles fall back to a neutral gray scheme.

export interface RoleStyle {
  avatar: string;
  badgeBg: string;
  badgeFg: string;
}

const ROLE_STYLES: Record<string, RoleStyle> = {
  backend:      { avatar: '#534AB7', badgeBg: '#EEEDFE', badgeFg: '#534AB7' },
  frontend:     { avatar: '#E8823A', badgeBg: '#FEF0E5', badgeFg: '#D85A30' },
  arquitectura: { avatar: '#4A9FE8', badgeBg: '#E6F1FB', badgeFg: '#185FA5' },
  architecture: { avatar: '#4A9FE8', badgeBg: '#E6F1FB', badgeFg: '#185FA5' },
  architect:    { avatar: '#4A9FE8', badgeBg: '#E6F1FB', badgeFg: '#185FA5' },
  qa:           { avatar: '#3DBA7A', badgeBg: '#EAF3DE', badgeFg: '#3B6D11' },
  devops:       { avatar: '#B8860B', badgeBg: '#FAEEDA', badgeFg: '#854F0B' },
  data:         { avatar: '#0F6E56', badgeBg: '#E1F5EE', badgeFg: '#0F6E56' },
  ml:           { avatar: '#0F6E56', badgeBg: '#E1F5EE', badgeFg: '#0F6E56' },
  security:     { avatar: '#6B6860', badgeBg: '#EEEAE0', badgeFg: '#3A3833' },
};

const FALLBACK: RoleStyle = { avatar: '#5A6272', badgeBg: '#EEEAE0', badgeFg: '#5A6272' };

export function roleStyle(role: string): RoleStyle {
  return ROLE_STYLES[role.toLowerCase()] ?? FALLBACK;
}
