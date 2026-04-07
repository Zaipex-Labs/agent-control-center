import { useState, useEffect } from 'react';
import { browseFolders } from '../lib/api';
import type { BrowseEntry } from '../lib/api';

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
}

export default function FolderPicker({ value, onChange }: FolderPickerProps) {
  const [open, setOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState('');
  const [folders, setFolders] = useState<BrowseEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (path?: string) => {
    setLoading(true);
    setError('');
    try {
      const resp = await browseFolders(path);
      setCurrentPath(resp.path);
      setFolders(resp.folders);
    } catch {
      setError('No se puede leer el directorio');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load(value || undefined);
  }, [open]);

  const handleSelect = () => {
    onChange(currentPath);
    setOpen(false);
  };

  const handleNavigate = (folder: BrowseEntry) => {
    load(folder.path);
  };

  if (!open) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div
          onClick={() => setOpen(true)}
          style={{
            flex: 1, padding: '10px 12px', borderRadius: 8,
            border: '1px solid #D0C9BE', fontSize: 13,
            fontFamily: 'var(--font-mono)', color: value ? '#1E2D40' : '#8AA8C0',
            cursor: 'pointer', background: '#fff',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#E8823A'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#D0C9BE'; }}
        >
          {value || 'Seleccionar carpeta...'}
        </div>
        <button
          onClick={() => setOpen(true)}
          style={{
            background: '#F5F3EF', border: '1px solid #D0C9BE', borderRadius: 8,
            padding: '8px 12px', cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 12, color: '#5A6272', fontFamily: 'var(--font-sans)',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#E8E4DC'; e.currentTarget.style.borderColor = '#E8823A'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#F5F3EF'; e.currentTarget.style.borderColor = '#D0C9BE'; }}
        >
          <span style={{ fontSize: 14 }}>📁</span> Explorar
        </button>
      </div>
    );
  }

  return (
    <div style={{
      border: '1px solid #E8823A', borderRadius: 10,
      overflow: 'hidden', background: '#FAFAF8',
    }}>
      {/* Current path bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderBottom: '1px solid #E2DDD4',
        background: '#F5F3EF',
      }}>
        <span style={{
          flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)',
          color: '#1E2D40', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {currentPath}
        </span>
        <button
          onClick={handleSelect}
          style={{
            background: '#E8823A', color: '#fff', border: 'none',
            padding: '4px 12px', borderRadius: 6, fontSize: 11,
            fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
            flexShrink: 0,
          }}
        >
          Seleccionar
        </button>
        <button
          onClick={() => setOpen(false)}
          style={{
            background: 'none', border: '1px solid #D0C9BE', borderRadius: 6,
            padding: '4px 10px', fontSize: 11, color: '#5A6272',
            cursor: 'pointer', fontFamily: 'var(--font-sans)', flexShrink: 0,
          }}
        >
          Cancelar
        </button>
      </div>

      {/* Folder list */}
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 16, textAlign: 'center', color: '#8AA8C0', fontSize: 13 }}>
            Cargando...
          </div>
        ) : error ? (
          <div style={{ padding: 16, textAlign: 'center', color: '#DC3C3C', fontSize: 13 }}>
            {error}
          </div>
        ) : folders.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: '#8AA8C0', fontSize: 13 }}>
            Carpeta vacia
          </div>
        ) : (
          folders.map((folder) => (
            <div
              key={folder.path}
              onClick={() => handleNavigate(folder)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 12px', cursor: 'pointer',
                fontSize: 13, color: '#1E2D40',
                transition: 'background 0.1s',
                borderBottom: '1px solid #F0ECE3',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#F0ECE3'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>
                {folder.name === '..' ? '⬆' : '📁'}
              </span>
              <span style={{
                fontFamily: folder.name === '..' ? 'var(--font-sans)' : 'var(--font-mono)',
                fontSize: 13, fontWeight: folder.name === '..' ? 500 : 400,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {folder.name === '..' ? 'Subir un nivel' : folder.name}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
