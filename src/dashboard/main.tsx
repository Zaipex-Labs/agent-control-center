// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { setLang } from '../shared/i18n/browser';
import './styles/zaipex.css';

async function bootstrap(): Promise<void> {
  // Ask the broker for the CLI-configured language so dashboard and CLI stay
  // in sync. Falls back silently to navigator.language detection on error.
  // localStorage override (if any) already wins inside the i18n module.
  const hasLocalOverride = (() => {
    try { return !!localStorage.getItem('acc_lang'); } catch { return false; }
  })();

  if (!hasLocalOverride) {
    try {
      const resp = await fetch('/api/lang');
      if (resp.ok) {
        const data = await resp.json() as { lang?: string };
        if (data.lang) setLang(data.lang, false);
      }
    } catch {
      // Broker unreachable — keep navigator.language default
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
