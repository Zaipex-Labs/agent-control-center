import { useState, useCallback, useRef, useEffect } from 'react';
import { searchThreads } from '../lib/api';
import type { Thread } from '../lib/types';

interface SearchBarProps {
  projectId: string;
  onResults: (threads: Thread[] | null) => void;
}

export default function SearchBar({ projectId, onResults }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      onResults(null);
      return;
    }
    setSearching(true);
    try {
      const resp = await searchThreads(projectId, q.trim());
      onResults(resp.threads);
    } catch {
      onResults([]);
    } finally {
      setSearching(false);
    }
  }, [projectId, onResults]);

  const handleChange = (value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    if (!value.trim()) {
      onResults(null);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleClear = () => {
    setQuery('');
    onResults(null);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleClear();
  };

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        value={query}
        onChange={e => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Buscar hilos..."
        style={{
          width: '100%', background: 'var(--z-surface)',
          border: '1px solid var(--z-border)', borderRadius: 8,
          padding: '8px 32px 8px 12px', color: 'var(--z-text)',
          fontSize: 13, fontFamily: 'var(--font-sans)', outline: 'none',
          transition: 'border-color 0.15s',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--z-orange)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--z-border)'; }}
      />
      {query && (
        <button
          onClick={handleClear}
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', color: 'var(--z-text-muted)',
            fontSize: 14, cursor: 'pointer', padding: '0 2px',
            lineHeight: 1,
          }}
        >
          &times;
        </button>
      )}
      {searching && (
        <div style={{
          position: 'absolute', right: query ? 28 : 10, top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 10, color: 'var(--z-text-muted)',
        }}>
          ...
        </div>
      )}
    </div>
  );
}
