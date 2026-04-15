// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Five pixel-ish office illustrations rendered as inline SVG strings.
// Each builder takes the "on" state and the list of agents (just needs a
// color per agent to tint chairs) and returns an SVG string meant to be
// consumed via dangerouslySetInnerHTML. Keeps heavy markup out of the
// React component so TeamsPage stays readable.

export interface OfficeAgent {
  color: string;
}

function officeDualDesk(on: boolean, ag: OfficeAgent[]): string {
  const w = on ? '#f0ece3' : '#d8d4cb';
  const f = on ? '#e8e3d8' : '#cec9c0';
  const m = on ? '#141f2e' : '#1a1a1a';
  return `<svg viewBox="0 0 260 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block">
    <rect x="0" y="155" width="260" height="45" fill="${f}"/>
    <rect x="0" y="0" width="260" height="155" fill="${w}"/>
    <rect x="100" y="12" width="60" height="45" rx="2" fill="${on ? '#dce8f0' : '#8a9aa8'}" stroke="#c8bfb0" stroke-width="1.5"/>
    <line x1="130" y1="12" x2="130" y2="57" stroke="#c8bfb0" stroke-width="1"/>
    <line x1="100" y1="35" x2="160" y2="35" stroke="#c8bfb0" stroke-width="1"/>
    <rect x="18" y="30" width="50" height="4" rx="1" fill="#c8bfb0"/>
    <rect x="22" y="18" width="8" height="12" rx="1" fill="#534AB7" opacity="${on ? 0.6 : 0.2}"/>
    <rect x="32" y="21" width="7" height="9" rx="1" fill="#E8823A" opacity="${on ? 0.5 : 0.15}"/>
    <rect x="41" y="19" width="9" height="11" rx="1" fill="#4A9FE8" opacity="${on ? 0.5 : 0.15}"/>
    <rect x="16" y="112" width="95" height="5" rx="2" fill="#b8a990" opacity="${on ? 1 : 0.6}"/>
    <rect x="20" y="117" width="4" height="38" fill="#a09080" opacity=".6"/>
    <rect x="103" y="117" width="4" height="38" fill="#a09080" opacity=".6"/>
    <rect x="34" y="78" width="52" height="34" rx="3" fill="#1E2D40"/>
    <rect x="37" y="81" width="46" height="28" rx="1" fill="${m}"/>
    ${on ? '<line x1="40" y1="88" x2="70" y2="88" stroke="#3DBA7A" stroke-width="1.5" opacity=".8"/><line x1="40" y1="93" x2="78" y2="93" stroke="#4A9FE8" stroke-width="1" opacity=".5"/><line x1="40" y1="98" x2="65" y2="98" stroke="#534AB7" stroke-width="1" opacity=".4"/><line x1="40" y1="103" x2="72" y2="103" stroke="#E8823A" stroke-width="1" opacity=".3"/>' : ''}
    <rect x="57" y="112" width="7" height="2" fill="#1E2D40"/>
    <rect x="53" y="113" width="15" height="2" rx="1" fill="#1E2D40"/>
    <rect x="148" y="112" width="95" height="5" rx="2" fill="#b8a990" opacity="${on ? 1 : 0.6}"/>
    <rect x="152" y="117" width="4" height="38" fill="#a09080" opacity=".6"/>
    <rect x="235" y="117" width="4" height="38" fill="#a09080" opacity=".6"/>
    <rect x="168" y="78" width="52" height="34" rx="3" fill="#1E2D40"/>
    <rect x="171" y="81" width="46" height="28" rx="1" fill="${m}"/>
    ${on ? '<rect x="174" y="86" width="18" height="11" rx="1" fill="#4A9FE8" opacity=".3"/><rect x="195" y="86" width="18" height="11" rx="1" fill="#E8823A" opacity=".3"/><rect x="174" y="100" width="38" height="4" rx="1" fill="#3DBA7A" opacity=".3"/>' : ''}
    <rect x="191" y="112" width="7" height="2" fill="#1E2D40"/>
    <rect x="187" y="113" width="15" height="2" rx="1" fill="#1E2D40"/>
    <rect x="232" y="95" width="13" height="17" rx="3" fill="#d4c4a8" opacity="${on ? 1 : 0.5}"/>
    <ellipse cx="238" cy="93" rx="9" ry="7" fill="#3DBA7A" opacity="${on ? 0.55 : 0.15}"/>
    <rect x="96" y="102" width="8" height="10" rx="2" fill="#E8823A" opacity="${on ? 0.7 : 0.2}"/>
    <ellipse cx="60" cy="146" rx="15" ry="5.5" fill="${ag[0]?.color || '#888'}" opacity="${on ? 0.28 : 0.08}"/>
    ${ag[1] ? `<ellipse cx="194" cy="146" rx="15" ry="5.5" fill="${ag[1].color}" opacity="${on ? 0.28 : 0.08}"/>` : ''}
    ${on
      ? '<circle cx="50" cy="74" r="2" fill="#3DBA7A" opacity=".6"><animate attributeName="cy" values="74;68;74" dur="2.5s" repeatCount="indefinite"/><animate attributeName="opacity" values=".6;.2;.6" dur="2.5s" repeatCount="indefinite"/></circle><circle cx="200" cy="72" r="1.5" fill="#3DBA7A" opacity=".5"><animate attributeName="cy" values="72;66;72" dur="3s" repeatCount="indefinite"/></circle>'
      : '<text x="118" y="72" font-family="JetBrains Mono" font-size="14" fill="#9aa0aa" opacity=".4" font-weight="500">z</text><text x="130" y="62" font-family="JetBrains Mono" font-size="11" fill="#9aa0aa" opacity=".3" font-weight="500">z</text><text x="140" y="54" font-family="JetBrains Mono" font-size="9" fill="#9aa0aa" opacity=".2" font-weight="500">z</text>'}
  </svg>`;
}

function officeServerRoom(on: boolean, ag: OfficeAgent[]): string {
  const w = on ? '#eae6de' : '#d5d1c9';
  const f = on ? '#e0dbd2' : '#c8c3bb';
  const m = on ? '#141f2e' : '#1a1a1a';
  return `<svg viewBox="0 0 260 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block">
    <rect x="0" y="155" width="260" height="45" fill="${f}"/>
    <rect x="0" y="0" width="260" height="155" fill="${w}"/>
    <rect x="15" y="22" width="45" height="120" rx="4" fill="#1E2D40" stroke="#243d58" stroke-width="1"/>
    ${[0, 1, 2, 3, 4].map(i => `
      <rect x="21" y="${32 + i * 16}" width="33" height="9" rx="2" fill="${on ? '#141f2e' : '#0f1520'}"/>
      ${on
        ? `<circle cx="49" cy="${36.5 + i * 16}" r="2" fill="${['#3DBA7A', '#4A9FE8', '#E8823A', '#534AB7', '#3DBA7A'][i]}"><animate attributeName="opacity" values="1;.3;1" dur="${1.5 + i * 0.3}s" repeatCount="indefinite"/></circle>`
        : `<circle cx="49" cy="${36.5 + i * 16}" r="2" fill="#555"/>`}
    `).join('')}
    <rect x="80" y="108" width="160" height="5" rx="2" fill="#b8a990" opacity="${on ? 1 : 0.6}"/>
    <rect x="84" y="113" width="3" height="42" fill="#a09080" opacity=".5"/>
    <rect x="233" y="113" width="3" height="42" fill="#a09080" opacity=".5"/>
    <rect x="90" y="70" width="60" height="38" rx="3" fill="#1E2D40"/>
    <rect x="93" y="73" width="54" height="32" rx="1" fill="${m}"/>
    ${on ? '<text x="97" y="85" font-family="JetBrains Mono" font-size="7.5" fill="#3DBA7A" opacity=".8">$ acc up</text><text x="97" y="94" font-family="JetBrains Mono" font-size="7" fill="#4A9FE8" opacity=".6">broker: ready</text><text x="97" y="102" font-family="JetBrains Mono" font-size="7" fill="#E8823A" opacity=".4">agents: ok</text>' : ''}
    <rect x="117" y="108" width="6" height="2" fill="#1E2D40"/>
    <rect x="175" y="70" width="55" height="38" rx="3" fill="#1E2D40"/>
    <rect x="178" y="73" width="49" height="32" rx="1" fill="${m}"/>
    ${on ? '<rect x="181" y="78" width="20" height="10" rx="1" fill="#534AB7" opacity=".3"/><rect x="204" y="78" width="20" height="10" rx="1" fill="#E8823A" opacity=".3"/><rect x="181" y="92" width="43" height="5" rx="1" fill="#3DBA7A" opacity=".25"/>' : ''}
    <rect x="199" y="108" width="6" height="2" fill="#1E2D40"/>
    ${ag.map((a, i) => `<ellipse cx="${120 + i * 55}" cy="143" rx="13" ry="5" fill="${a.color}" opacity="${on ? 0.25 : 0.08}"/>`).join('')}
    <rect x="195" y="20" width="48" height="38" rx="3" fill="${on ? '#f0ece3' : '#ddd8d0'}" stroke="#c8bfb0" stroke-width="1"/>
    ${on ? '<text x="204" y="35" font-family="JetBrains Mono" font-size="7" fill="#1E2D40" opacity=".5">TODO</text><line x1="202" y1="42" x2="234" y2="42" stroke="#E8823A" stroke-width=".8" opacity=".4"/><line x1="202" y1="48" x2="228" y2="48" stroke="#4A9FE8" stroke-width=".8" opacity=".3"/>' : ''}
    ${!on ? '<text x="120" y="48" font-family="JetBrains Mono" font-size="15" fill="#9aa0aa" opacity=".4" font-weight="500">z</text><text x="134" y="37" font-family="JetBrains Mono" font-size="11" fill="#9aa0aa" opacity=".28" font-weight="500">z</text><text x="145" y="28" font-family="JetBrains Mono" font-size="8" fill="#9aa0aa" opacity=".18" font-weight="500">z</text>' : ''}
  </svg>`;
}

function officeOpenPlan(on: boolean, ag: OfficeAgent[]): string {
  const w = on ? '#f0ece3' : '#d8d4cb';
  const f = on ? '#e8e3d8' : '#cec9c0';
  const m = on ? '#141f2e' : '#1a1a1a';
  const n = Math.min(ag.length, 4) || 1;
  const bw = Math.floor((220 - ((n - 1) * 10)) / n);
  return `<svg viewBox="0 0 260 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block">
    <rect x="0" y="155" width="260" height="45" fill="${f}"/>
    <rect x="0" y="0" width="260" height="155" fill="${w}"/>
    <rect x="25" y="8" width="120" height="52" rx="3" fill="${on ? '#f7f4ee' : '#e0dcd4'}" stroke="#c8bfb0" stroke-width="1.5"/>
    ${on ? '<line x1="38" y1="20" x2="110" y2="20" stroke="#4A9FE8" stroke-width="1.2" opacity=".4"/><line x1="38" y1="28" x2="96" y2="28" stroke="#E8823A" stroke-width="1" opacity=".35"/><line x1="38" y1="36" x2="120" y2="36" stroke="#3DBA7A" stroke-width="1" opacity=".3"/><rect x="38" y="43" width="22" height="10" rx="1" fill="#534AB7" opacity=".15"/><rect x="65" y="43" width="28" height="10" rx="1" fill="#E8823A" opacity=".12"/>' : ''}
    <rect x="178" y="12" width="52" height="40" rx="2" fill="${on ? '#dce8f0' : '#8a9aa8'}" stroke="#c8bfb0" stroke-width="1.5"/>
    <line x1="204" y1="12" x2="204" y2="52" stroke="#c8bfb0" stroke-width="1"/>
    <rect x="12" y="112" width="236" height="5" rx="2" fill="#b8a990" opacity="${on ? 1 : 0.6}"/>
    <rect x="16" y="117" width="3" height="38" fill="#a09080" opacity=".5"/>
    <rect x="241" y="117" width="3" height="38" fill="#a09080" opacity=".5"/>
    ${ag.slice(0, 4).map((a, i) => {
      const mx = 20 + i * (bw + 10);
      return `
      <rect x="${mx}" y="78" width="${bw}" height="34" rx="3" fill="#1E2D40"/>
      <rect x="${mx + 3}" y="81" width="${bw - 6}" height="28" rx="1" fill="${m}"/>
      ${on ? `<line x1="${mx + 5}" y1="89" x2="${mx + bw - 10}" y2="89" stroke="${a.color}" stroke-width="1" opacity=".6"/><line x1="${mx + 5}" y1="94" x2="${mx + bw - 14}" y2="94" stroke="#4A9FE8" stroke-width=".8" opacity=".4"/><line x1="${mx + 5}" y1="99" x2="${mx + bw - 8}" y2="99" stroke="#3DBA7A" stroke-width=".8" opacity=".3"/>` : ''}
      <rect x="${mx + Math.floor(bw / 2) - 3}" y="112" width="6" height="2" fill="#1E2D40"/>
      <ellipse cx="${mx + Math.floor(bw / 2)}" cy="144" rx="12" ry="4.5" fill="${a.color}" opacity="${on ? 0.25 : 0.08}"/>`;
    }).join('')}
    ${on
      ? '<circle cx="85" cy="72" r="2" fill="#3DBA7A" opacity=".5"><animate attributeName="cy" values="72;66;72" dur="2.8s" repeatCount="indefinite"/></circle>'
      : '<text x="115" y="68" font-family="JetBrains Mono" font-size="14" fill="#9aa0aa" opacity=".4" font-weight="500">z</text><text x="128" y="58" font-family="JetBrains Mono" font-size="10" fill="#9aa0aa" opacity=".28" font-weight="500">z</text>'}
  </svg>`;
}

function officeCozyCorner(on: boolean, ag: OfficeAgent[]): string {
  const w = on ? '#eee9e0' : '#d5d1c9';
  const f = on ? '#e3ded5' : '#cac5bd';
  const m = on ? '#141f2e' : '#1a1a1a';
  return `<svg viewBox="0 0 260 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block">
    <rect x="0" y="155" width="260" height="45" fill="${f}"/>
    <rect x="0" y="0" width="260" height="155" fill="${w}"/>
    ${on ? '<ellipse cx="36" cy="80" rx="45" ry="60" fill="#faf3e0" opacity=".22"/>' : ''}
    <rect x="26" y="58" width="4" height="94" fill="#b8a990"/>
    <ellipse cx="28" cy="56" rx="16" ry="9" fill="${on ? '#E8823A' : '#8a7a6a'}" opacity="${on ? 0.7 : 0.4}"/>
    ${on ? '<ellipse cx="28" cy="56" rx="10" ry="5" fill="#fce8a0" opacity=".45"/>' : ''}
    <rect x="72" y="112" width="170" height="5" rx="2" fill="#b8a990" opacity="${on ? 1 : 0.6}"/>
    <rect x="76" y="117" width="3" height="38" fill="#a09080" opacity=".5"/>
    <rect x="235" y="117" width="3" height="38" fill="#a09080" opacity=".5"/>
    <rect x="88" y="74" width="58" height="38" rx="3" fill="#1E2D40"/>
    <rect x="91" y="77" width="52" height="32" rx="1" fill="${m}"/>
    ${on ? '<line x1="95" y1="85" x2="128" y2="85" stroke="#3DBA7A" stroke-width="1.2" opacity=".7"/><line x1="95" y1="90" x2="138" y2="90" stroke="#E8823A" stroke-width="1" opacity=".5"/><line x1="95" y1="95" x2="122" y2="95" stroke="#4A9FE8" stroke-width=".8" opacity=".4"/><line x1="95" y1="100" x2="133" y2="100" stroke="#534AB7" stroke-width=".8" opacity=".3"/>' : ''}
    <rect x="114" y="112" width="6" height="2" fill="#1E2D40"/>
    <rect x="178" y="78" width="52" height="34" rx="3" fill="#1E2D40"/>
    <rect x="181" y="81" width="46" height="28" rx="1" fill="${m}"/>
    ${on ? '<rect x="184" y="86" width="20" height="10" rx="1" fill="#534AB7" opacity=".25"/><rect x="206" y="86" width="18" height="10" rx="1" fill="#3DBA7A" opacity=".25"/><rect x="184" y="100" width="40" height="4" rx="1" fill="#E8823A" opacity=".2"/>' : ''}
    <rect x="201" y="112" width="6" height="2" fill="#1E2D40"/>
    ${ag.slice(0, 2).map((a, i) => `<ellipse cx="${117 + i * 87}" cy="145" rx="14" ry="5" fill="${a.color}" opacity="${on ? 0.28 : 0.1}"/>`).join('')}
    <rect x="72" y="14" width="42" height="35" rx="2" fill="${on ? '#e2ddd4' : '#d0cbc3'}" stroke="#c8bfb0" stroke-width="1"/>
    ${on ? '<rect x="78" y="20" width="12" height="8" rx="1" fill="#4A9FE8" opacity=".15"/><rect x="78" y="32" width="28" height="3" rx="1" fill="#9aa0aa" opacity=".2"/>' : ''}
    <rect x="176" y="18" width="55" height="38" rx="3" fill="#f0ece3" stroke="#c8bfb0" stroke-width="1"/>
    ${on ? '<circle cx="194" cy="30" r="5" fill="none" stroke="#E8823A" stroke-width="1" opacity=".3"/><circle cx="214" cy="30" r="5" fill="none" stroke="#4A9FE8" stroke-width="1" opacity=".3"/><line x1="184" y1="42" x2="224" y2="42" stroke="#3DBA7A" stroke-width=".8" opacity=".25"/>' : ''}
    ${!on ? '<text x="130" y="58" font-family="JetBrains Mono" font-size="15" fill="#9aa0aa" opacity=".4" font-weight="500">z</text><text x="144" y="46" font-family="JetBrains Mono" font-size="11" fill="#9aa0aa" opacity=".28" font-weight="500">z</text><text x="155" y="36" font-family="JetBrains Mono" font-size="8" fill="#9aa0aa" opacity=".18" font-weight="500">z</text>' : ''}
    ${on ? '<circle cx="115" cy="68" r="1.8" fill="#E8823A" opacity=".5"><animate attributeName="cy" values="68;62;68" dur="2.2s" repeatCount="indefinite"/><animate attributeName="opacity" values=".5;.15;.5" dur="2.2s" repeatCount="indefinite"/></circle>' : ''}
  </svg>`;
}

function officeStanding(on: boolean, ag: OfficeAgent[]): string {
  const w = on ? '#edeae2' : '#d6d2ca';
  const f = on ? '#e5e0d8' : '#ccc8c0';
  const m = on ? '#141f2e' : '#1a1a1a';
  return `<svg viewBox="0 0 260 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block">
    <rect x="0" y="155" width="260" height="45" fill="${f}"/>
    <rect x="0" y="0" width="260" height="155" fill="${w}"/>
    <rect x="25" y="10" width="210" height="3" rx="1" fill="#c8bfb0"/>
    ${on
      ? '<circle cx="72" cy="7" r="3.5" fill="#E8823A" opacity=".4"/><circle cx="130" cy="7" r="3.5" fill="#3DBA7A" opacity=".4"/><circle cx="188" cy="7" r="3.5" fill="#4A9FE8" opacity=".4"/>'
      : '<circle cx="72" cy="7" r="3.5" fill="#aaa" opacity=".15"/><circle cx="130" cy="7" r="3.5" fill="#aaa" opacity=".15"/><circle cx="188" cy="7" r="3.5" fill="#aaa" opacity=".15"/>'}
    <rect x="20" y="90" width="95" height="5" rx="2" fill="#b8a990" opacity="${on ? 1 : 0.6}"/>
    <rect x="24" y="95" width="3" height="60" fill="#a09080" opacity=".6"/>
    <rect x="108" y="95" width="3" height="60" fill="#a09080" opacity=".6"/>
    <rect x="145" y="90" width="95" height="5" rx="2" fill="#b8a990" opacity="${on ? 1 : 0.6}"/>
    <rect x="149" y="95" width="3" height="60" fill="#a09080" opacity=".6"/>
    <rect x="233" y="95" width="3" height="60" fill="#a09080" opacity=".6"/>
    <rect x="30" y="50" width="56" height="40" rx="3" fill="#1E2D40"/>
    <rect x="33" y="53" width="50" height="34" rx="1" fill="${m}"/>
    ${on ? '<text x="37" y="65" font-family="JetBrains Mono" font-size="7" fill="#3DBA7A" opacity=".8">import acc</text><text x="37" y="74" font-family="JetBrains Mono" font-size="7" fill="#4A9FE8" opacity=".6">broker.start()</text><text x="37" y="83" font-family="JetBrains Mono" font-size="7" fill="#E8823A" opacity=".4">agents: 2</text>' : ''}
    <rect x="55" y="90" width="6" height="2" fill="#1E2D40"/>
    <rect x="155" y="50" width="56" height="40" rx="3" fill="#1E2D40"/>
    <rect x="158" y="53" width="50" height="34" rx="1" fill="${m}"/>
    ${on ? '<rect x="162" y="58" width="22" height="13" rx="1" fill="#E8823A" opacity=".25"/><rect x="186" y="58" width="18" height="13" rx="1" fill="#534AB7" opacity=".25"/><rect x="162" y="75" width="42" height="5" rx="1" fill="#3DBA7A" opacity=".2"/>' : ''}
    <rect x="180" y="90" width="6" height="2" fill="#1E2D40"/>
    <rect x="95" y="28" width="14" height="20" rx="3" fill="#d4c4a8" opacity="${on ? 1 : 0.5}"/>
    <ellipse cx="102" cy="24" rx="11" ry="8" fill="#3DBA7A" opacity="${on ? 0.5 : 0.15}"/>
    <ellipse cx="96" cy="20" rx="6" ry="5" fill="#3DBA7A" opacity="${on ? 0.35 : 0.1}"/>
    ${ag.slice(0, 2).map((a, i) => `<ellipse cx="${67 + i * 120}" cy="142" rx="14" ry="5" fill="${a.color}" opacity="${on ? 0.25 : 0.08}"/>`).join('')}
    ${on
      ? '<circle cx="58" cy="44" r="2" fill="#3DBA7A" opacity=".6"><animate attributeName="cy" values="44;38;44" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values=".6;.2;.6" dur="2s" repeatCount="indefinite"/></circle><circle cx="183" cy="42" r="1.5" fill="#4A9FE8" opacity=".5"><animate attributeName="cy" values="42;36;42" dur="2.6s" repeatCount="indefinite"/></circle>'
      : '<text x="112" y="62" font-family="JetBrains Mono" font-size="15" fill="#9aa0aa" opacity=".4" font-weight="500">z</text><text x="126" y="50" font-family="JetBrains Mono" font-size="11" fill="#9aa0aa" opacity=".28" font-weight="500">z</text><text x="137" y="40" font-family="JetBrains Mono" font-size="8" fill="#9aa0aa" opacity=".18" font-weight="500">z</text>'}
  </svg>`;
}

const BUILDERS = [officeDualDesk, officeServerRoom, officeOpenPlan, officeCozyCorner, officeStanding];
export const OFFICE_COUNT = BUILDERS.length;

export function renderOffice(variant: number, on: boolean, agents: OfficeAgent[]): string {
  const i = ((variant % OFFICE_COUNT) + OFFICE_COUNT) % OFFICE_COUNT;
  return BUILDERS[i](on, agents);
}

// Deterministic office index from a project name so the same project keeps
// the same illustration across renders, but different projects usually get
// different ones.
export function officeIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % OFFICE_COUNT;
}
