import { useState, useEffect, useCallback } from 'react';
import { listSharedKeys, getSharedState } from '../lib/api';
import type { SharedStateEntry } from '../lib/types';
import { t } from '../../shared/i18n/browser';

const KNOWN_NAMESPACES = ['resume', 'contracts', 'config', 'types', 'schemas', 'env', 'files'];

interface NamespaceData {
  namespace: string;
  keys: string[];
  lastUpdated?: { by: string; at: string };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('dash.now');
  if (mins < 60) return t('dash.mins', { mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('dash.hrs', { hrs });
  return t('dash.days', { days: Math.floor(hrs / 24) });
}

function JsonPreview({ value }: { value: string }) {
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    formatted = value;
  }

  return (
    <pre style={{
      fontSize: 11, fontFamily: 'var(--font-mono)',
      color: 'var(--z-green)', background: 'var(--z-navy-deep)',
      border: '1px solid var(--z-border)', borderRadius: 6,
      padding: 10, margin: '6px 0 0', overflowX: 'auto',
      maxHeight: 200, lineHeight: 1.5, whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}>
      {formatted}
    </pre>
  );
}

function NamespaceCard({ ns, projectId }: { ns: NamespaceData; projectId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState<SharedStateEntry | null>(null);

  const loadKey = useCallback(async (key: string) => {
    if (selectedKey === key) {
      setSelectedKey(null);
      setKeyValue(null);
      return;
    }
    setSelectedKey(key);
    try {
      const entry = await getSharedState(projectId, ns.namespace, key);
      setKeyValue(entry);
    } catch {
      setKeyValue(null);
    }
  }, [projectId, ns.namespace, selectedKey]);

  return (
    <div style={{
      border: '1px solid var(--z-border)', borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 12px', cursor: 'pointer',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--z-text)' }}>
            {ns.namespace}/
          </div>
          <div style={{ fontSize: 11, color: 'var(--z-text-muted)', marginTop: 2 }}>
            {ns.keys.length === 1 ? t('dash.keysSingular', { count: ns.keys.length }) : t('dash.keys', { count: ns.keys.length })}
            {ns.lastUpdated && (
              <span> &middot; {ns.lastUpdated.by}, {timeAgo(ns.lastUpdated.at)}</span>
            )}
          </div>
        </div>
        <span style={{
          fontSize: 10, color: 'var(--z-text-muted)',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
        }}>&#9654;</span>
      </div>

      {expanded && (
        <div style={{
          borderTop: '1px solid var(--z-border)',
          padding: '6px 0',
        }}>
          {ns.keys.map(key => (
            <div key={key}>
              <div
                onClick={() => loadKey(key)}
                style={{
                  padding: '6px 12px', fontSize: 12, cursor: 'pointer',
                  color: selectedKey === key ? 'var(--z-orange)' : 'var(--z-text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  transition: 'color 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--z-text)'; }}
                onMouseLeave={e => { if (selectedKey !== key) e.currentTarget.style.color = 'var(--z-text-secondary)'; }}
              >
                {key}
              </div>
              {selectedKey === key && keyValue && (
                <div style={{ padding: '0 12px 8px' }}>
                  <JsonPreview value={keyValue.value} />
                  <div style={{ fontSize: 10, color: 'var(--z-text-muted)', marginTop: 4 }}>
                    {t('dash.by', { user: keyValue.updated_by })} &middot; {timeAgo(keyValue.updated_at)}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SharedStatePanelProps {
  projectId: string;
  refreshKey?: number;
}

export default function SharedStatePanel({ projectId, refreshKey }: SharedStatePanelProps) {
  const [namespaces, setNamespaces] = useState<NamespaceData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all(
      KNOWN_NAMESPACES.map(async (ns) => {
        try {
          const keys = await listSharedKeys(projectId, ns);
          if (keys.length === 0) return null;

          // Get last updated info from first key
          let lastUpdated: { by: string; at: string } | undefined;
          try {
            const entry = await getSharedState(projectId, ns, keys[0]);
            lastUpdated = { by: entry.updated_by, at: entry.updated_at };
          } catch { /* ignore */ }

          return { namespace: ns, keys, lastUpdated } as NamespaceData;
        } catch {
          return null;
        }
      }),
    ).then(results => {
      if (cancelled) return;
      setNamespaces(results.filter((r): r is NamespaceData => r !== null));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [projectId, refreshKey]);

  return (
    <div>
      <h3 style={{
        fontSize: 13, fontWeight: 600, color: 'var(--z-text)',
        marginBottom: 12, letterSpacing: -0.2,
      }}>
        {t('dash.sharedState')}
      </h3>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--z-text-muted)', padding: 8 }}>
          {t('dash.loading')}
        </div>
      ) : namespaces.length === 0 ? (
        <div style={{
          fontSize: 12, color: 'var(--z-text-muted)', padding: 16,
          textAlign: 'center', border: '1px dashed var(--z-border)',
          borderRadius: 8,
        }}>
          {t('dash.noSharedData')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {namespaces.map(ns => (
            <NamespaceCard key={ns.namespace} ns={ns} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
}
