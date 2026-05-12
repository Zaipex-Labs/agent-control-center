// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE A v0.3.3 — Token observability panel for ProjectPage's right
// rail. Polls /api/projects/:id/tokens every 30s + on demand. Per-agent
// row shows total tokens + proportional bar; click for a detail modal
// with hourly histogram and top-5 most-expensive turns.

import React, { useEffect, useState, useCallback } from 'react';
import { getProjectTokens, type TokensReport, type TokenPeriod } from '../lib/api';
import { t } from '../../shared/i18n/browser';

const POLL_INTERVAL_MS = 30_000;

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(2)}k`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

interface TokensPanelProps {
  projectId: string;
  refreshKey?: number;
}

export default function TokensPanel({ projectId, refreshKey }: TokensPanelProps) {
  const [report, setReport] = useState<TokensReport | null>(null);
  const [period, setPeriod] = useState<TokenPeriod>('today');
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchReport = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const r = await getProjectTokens(projectId, period);
      setReport(r);
    } catch {
      // silent — the panel just stays on the last good snapshot
    } finally {
      setLoading(false);
    }
  }, [projectId, period]);

  useEffect(() => {
    void fetchReport();
    const t = setInterval(() => { void fetchReport(); }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [fetchReport, refreshKey]);

  if (!report || report.total.turns === 0) {
    return (
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10,
        color: 'var(--z-text-muted)',
      }}>
        {loading ? t('dash.tokensLoading') : t('dash.tokensEmpty')}
      </div>
    );
  }

  const max = Math.max(1, ...report.by_agent.map(a => a.total));

  return (
    <div>
      {/* Period switcher */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 10,
        fontFamily: 'var(--font-mono)', fontSize: 10,
      }}>
        {(['today', 'week', 'month'] as TokenPeriod[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              background: period === p ? 'var(--z-navy-dark)' : 'transparent',
              color: period === p ? 'var(--z-text)' : 'var(--z-text-muted)',
              border: '1px solid var(--z-border)',
              borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: 1, fontSize: 9,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {t(`dash.tokensPeriod.${p}`)}
          </button>
        ))}
      </div>

      {/* Total roll-up */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 12, paddingBottom: 8,
        borderBottom: '1px solid var(--z-border)',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          textTransform: 'uppercase', letterSpacing: 1.5,
          color: 'var(--z-text-muted)',
        }}>
          {t('dash.tokensTotal')}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 13,
          color: 'var(--z-text)',
        }}>
          {formatTokens(report.total.total)}
          <span style={{ color: 'var(--z-text-muted)', marginLeft: 6, fontSize: 10 }}>
            ({report.total.turns} {t('dash.tokensTurns')})
          </span>
        </span>
      </div>

      {/* Per-agent bars */}
      {report.by_agent.map(a => (
        <div key={a.role} style={{ marginBottom: 8 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontFamily: 'var(--font-mono)', fontSize: 11,
            marginBottom: 2,
          }}>
            <span style={{ color: 'var(--z-text)' }}>{a.role}</span>
            <span style={{ color: 'var(--z-text-muted)' }}>
              {formatTokens(a.total)}
              <span style={{ fontSize: 9, marginLeft: 4 }}>
                ({a.turns}t)
              </span>
            </span>
          </div>
          <div style={{
            height: 6, background: 'var(--z-navy-deep)',
            borderRadius: 3, overflow: 'hidden',
          }}>
            <div style={{
              width: `${(a.total / max) * 100}%`,
              height: '100%',
              background: 'var(--z-green)',
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      ))}

      <button
        onClick={() => setDetailOpen(true)}
        style={{
          marginTop: 10, padding: '4px 8px',
          background: 'transparent', border: '1px solid var(--z-border)',
          color: 'var(--z-text-secondary)',
          borderRadius: 4, cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 10,
          width: '100%',
        }}
      >
        {t('dash.tokensSeeDetail')}
      </button>

      {detailOpen && (
        <TokensDetailModal report={report} onClose={() => setDetailOpen(false)} />
      )}
    </div>
  );
}

function TokensDetailModal({
  report,
  onClose,
}: {
  report: TokensReport;
  onClose: () => void;
}) {
  const histMax = Math.max(1, ...report.by_hour.map(b => b.total));

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,24,36,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 120, padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--z-navy-deep)', color: 'var(--z-text)',
          border: '1px solid var(--z-border)', borderRadius: 12,
          padding: 24, maxWidth: 640, width: '100%',
          maxHeight: '85vh', overflowY: 'auto',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 20,
        }}>
          <h2 style={{
            fontFamily: 'var(--font-serif)', fontSize: 22, margin: 0,
            color: 'var(--z-text)',
          }}>
            {t('dash.tokensDetailTitle')}
          </h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none',
            color: 'var(--z-text-muted)', fontSize: 24, cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
          }}>×</button>
        </div>

        {/* Totals breakdown */}
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--z-text-secondary)',
          marginBottom: 16,
        }}>
          <div>{t('dash.tokensInput')}: {formatTokens(report.total.input)}</div>
          <div>{t('dash.tokensOutput')}: {formatTokens(report.total.output)}</div>
          <div>{t('dash.tokensCacheCreation')}: {formatTokens(report.total.cache_creation)}</div>
          <div>{t('dash.tokensCacheRead')}: {formatTokens(report.total.cache_read)}</div>
          <div style={{ marginTop: 6, color: 'var(--z-text)' }}>
            <strong>{t('dash.tokensTotal')}: {formatTokens(report.total.total)}</strong>
            {' '}— {report.total.turns} {t('dash.tokensTurns')}
          </div>
        </div>

        {/* Hour histogram */}
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          textTransform: 'uppercase', letterSpacing: 1.5,
          color: 'var(--z-text-muted)', marginBottom: 8,
        }}>
          {t('dash.tokensByHour')}
        </div>
        {report.by_hour.length === 0 ? (
          <div style={{ color: 'var(--z-text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
            {t('dash.tokensEmpty')}
          </div>
        ) : (
          <svg width="100%" height={80} viewBox={`0 0 ${report.by_hour.length * 16} 80`} preserveAspectRatio="none" style={{ marginBottom: 16 }}>
            {report.by_hour.map((b, i) => {
              const h = (b.total / histMax) * 70;
              return (
                <g key={b.hour}>
                  <rect
                    x={i * 16 + 2} y={80 - h - 2}
                    width={12} height={h}
                    fill="var(--z-green)" opacity={0.85}
                  />
                  <title>{`${b.hour} — ${formatTokens(b.total)}`}</title>
                </g>
              );
            })}
          </svg>
        )}

        {/* Top turns */}
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          textTransform: 'uppercase', letterSpacing: 1.5,
          color: 'var(--z-text-muted)', marginBottom: 8,
        }}>
          {t('dash.tokensTopTurns')}
        </div>
        {report.top_turns.length === 0 ? (
          <div style={{ color: 'var(--z-text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
            {t('dash.tokensEmpty')}
          </div>
        ) : (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            {report.top_turns.map((turn, i) => (
              <div key={turn.turn_uuid ?? i} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '4px 0', borderBottom: '1px solid var(--z-border)',
              }}>
                <span>
                  <span style={{ color: 'var(--z-text-muted)' }}>{i + 1}.</span>{' '}
                  <span style={{ color: 'var(--z-text)' }}>{turn.role}</span>{' '}
                  <span style={{ color: 'var(--z-text-muted)', fontSize: 10 }}>
                    {new Date(turn.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
                <span style={{ color: 'var(--z-green)' }}>{formatTokens(turn.total)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
