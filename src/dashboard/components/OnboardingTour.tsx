// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// B-5 v0.3.4 — Floating callout that walks users through the four
// onboarding steps. Non-anchored on purpose: anchoring tooltips to
// specific DOM nodes is brittle when the cards reflow on different
// viewports and the spawn panel replaces the Encender button mid-tour.
// Instead, the callout sits in the bottom-right corner with a one-line
// hint about where to look, plus a skip-anytime link and a primary
// Next/Done button.
//
// Skipping or completing sets `acc.onboarding.seen` once and never
// shows again. The "Ver tour" link on TeamsPage calls restart() which
// resets the flag — that's the recovery affordance for users who
// dismissed too eagerly.

import { t } from '../../shared/i18n/browser';
import type { TourStepNum } from '../hooks/useOnboardingTour';

interface OnboardingTourProps {
  step: TourStepNum;
  totalSteps: number;
  onNext: () => void;
  onSkip: () => void;
}

const STEP_KEYS: Record<TourStepNum, { title: string; body: string; hint: string }> = {
  1: { title: 'tour.s1.title', body: 'tour.s1.body', hint: 'tour.s1.hint' },
  2: { title: 'tour.s2.title', body: 'tour.s2.body', hint: 'tour.s2.hint' },
  3: { title: 'tour.s3.title', body: 'tour.s3.body', hint: 'tour.s3.hint' },
  4: { title: 'tour.s4.title', body: 'tour.s4.body', hint: 'tour.s4.hint' },
};

export default function OnboardingTour({ step, totalSteps, onNext, onSkip }: OnboardingTourProps) {
  const keys = STEP_KEYS[step];
  const isLast = step === totalSteps;

  return (
    <div
      role="dialog"
      aria-label={t('tour.aria')}
      style={{
        position: 'fixed', right: 24, bottom: 24, zIndex: 200,
        width: 360, maxWidth: 'calc(100vw - 48px)',
        background: '#FAF7F1', color: '#1E2D40',
        border: '1px solid #DDD5C8',
        borderLeft: '4px solid #E8823A',
        borderRadius: 12,
        padding: '16px 18px',
        boxShadow: '0 16px 40px rgba(15,24,36,0.18)',
        fontFamily: 'var(--font-sans)',
        animation: 'acc-step-in 0.35s ease both',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          textTransform: 'uppercase', letterSpacing: 1.2,
          color: '#E8823A',
        }}>
          {t('tour.stepOf', { current: step, total: totalSteps })}
        </span>
        <button
          onClick={onSkip}
          aria-label={t('tour.skipAria')}
          style={{
            background: 'none', border: 'none',
            color: '#9AA0AA', cursor: 'pointer',
            fontSize: 18, lineHeight: 1, padding: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#1E2D40'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#9AA0AA'; }}
        >×</button>
      </div>

      <h3 style={{
        margin: '0 0 4px',
        fontFamily: 'var(--font-serif)',
        fontSize: 18, fontWeight: 500,
        color: '#1E2D40',
      }}>
        {t(keys.title)}
      </h3>

      <p style={{
        margin: '0 0 6px',
        fontSize: 13, lineHeight: 1.55,
        color: '#3D4554',
      }}>
        {t(keys.body)}
      </p>

      <p style={{
        margin: '0 0 14px',
        fontSize: 12, lineHeight: 1.45,
        color: '#5A6272',
        fontStyle: 'italic',
      }}>
        ↘ {t(keys.hint)}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={onSkip}
          style={{
            background: 'none', border: 'none', padding: 0,
            color: '#5A6272', cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: 12,
            textDecoration: 'underline', textUnderlineOffset: 3,
          }}
        >
          {t('tour.skip')}
        </button>
        <button
          onClick={onNext}
          style={{
            background: '#E8823A', color: '#fff', border: 'none',
            padding: '8px 18px', borderRadius: 8,
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
            letterSpacing: 0.4, cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#D4732E'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#E8823A'; }}
        >
          {isLast ? t('tour.done') : t('tour.next') + ' →'}
        </button>
      </div>
    </div>
  );
}
