// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// B-5 v0.3.4 — Onboarding tour state machine. The hook itself uses
// React state + localStorage which would require jsdom; the pure
// helpers below are extracted so we can exercise the decisions
// (eligibility, step resolution, next/done transitions) headlessly.

import { describe, it, expect } from 'vitest';
import {
  decideEligibility,
  resolveStep,
  computeNextStep,
  type TourFlags,
} from '../../src/dashboard/hooks/useOnboardingTour';

function flags(overrides: Partial<TourFlags> = {}): TourFlags {
  return { seen: false, eligible: false, step: null, ...overrides };
}

// ── decideEligibility ──────────────────────────────────────────

describe('decideEligibility', () => {
  it('returns noop when the tour was already seen', () => {
    expect(decideEligibility(flags({ seen: true }), 0)).toBe('noop');
    expect(decideEligibility(flags({ seen: true }), 5)).toBe('noop');
  });

  it('returns noop when projectCount is unknown (still loading)', () => {
    expect(decideEligibility(flags(), undefined)).toBe('noop');
  });

  it('marks eligible when the user lands with 0 projects', () => {
    expect(decideEligibility(flags(), 0)).toBe('set-eligible');
  });

  it('silently completes when the user arrived with pre-existing projects', () => {
    expect(decideEligibility(flags(), 3)).toBe('mark-seen-silently');
  });

  it('is sticky — already-eligible users are not re-decided on later renders', () => {
    expect(decideEligibility(flags({ eligible: true }), 0)).toBe('noop');
    expect(decideEligibility(flags({ eligible: true }), 5)).toBe('noop');
  });
});

// ── resolveStep ────────────────────────────────────────────────

describe('resolveStep', () => {
  it('returns null when the tour is not eligible', () => {
    expect(resolveStep(flags(), 'teams', 0)).toEqual({ step: null, bumpTo: null });
    expect(resolveStep(flags({ eligible: true, seen: true }), 'teams', 1)).toEqual({ step: null, bumpTo: null });
  });

  it('returns step 1 on the teams page when no project exists yet', () => {
    expect(resolveStep(flags({ eligible: true, step: null }), 'teams', 0))
      .toEqual({ step: 1, bumpTo: null });
  });

  it('auto-advances 1→2 once the first project exists', () => {
    expect(resolveStep(flags({ eligible: true, step: 1 }), 'teams', 1))
      .toEqual({ step: 2, bumpTo: 2 });
  });

  it('does not auto-advance 1→2 if no projects yet', () => {
    expect(resolveStep(flags({ eligible: true, step: 1 }), 'teams', 0))
      .toEqual({ step: 1, bumpTo: null });
  });

  it('returns null on a page that does not own the current step', () => {
    // Step 3 lives on ProjectPage; asking TeamsPage gets null.
    expect(resolveStep(flags({ eligible: true, step: 3 }), 'teams', 1))
      .toEqual({ step: null, bumpTo: null });
    // Step 1 lives on TeamsPage; asking ProjectPage gets null.
    expect(resolveStep(flags({ eligible: true, step: 1 }), 'project', undefined))
      .toEqual({ step: null, bumpTo: null });
  });

  it('shows step 3 and step 4 on the project page', () => {
    expect(resolveStep(flags({ eligible: true, step: 3 }), 'project', undefined))
      .toEqual({ step: 3, bumpTo: null });
    expect(resolveStep(flags({ eligible: true, step: 4 }), 'project', undefined))
      .toEqual({ step: 4, bumpTo: null });
  });

  it('clamps out-of-range stored steps to 1', () => {
    expect(resolveStep(flags({ eligible: true, step: 99 }), 'teams', 0))
      .toEqual({ step: 1, bumpTo: null });
    expect(resolveStep(flags({ eligible: true, step: 0 }), 'teams', 0))
      .toEqual({ step: 1, bumpTo: null });
  });
});

// ── computeNextStep ───────────────────────────────────────────

describe('computeNextStep', () => {
  it('advances 1 → 2 → 3 → 4', () => {
    expect(computeNextStep(1)).toBe(2);
    expect(computeNextStep(2)).toBe(3);
    expect(computeNextStep(3)).toBe(4);
  });

  it('marks done after step 4', () => {
    expect(computeNextStep(4)).toBe('done');
  });

  it('defaults to 1 when no step is stored, then advances', () => {
    expect(computeNextStep(null)).toBe(2);
  });
});
