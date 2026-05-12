// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// B-5 v0.3.4 — Onboarding tour state.
//
// The tour is a 4-step floating callout that walks first-time users
// through the dashboard. Spans two pages — Teams (steps 1-2) and
// Project (steps 3-4) — so the step counter lives in localStorage,
// not React state.
//
// localStorage keys (under the existing `acc.*` namespace):
//   acc.onboarding.seen     '1' once the user finished or skipped.
//   acc.onboarding.step     current step '1'..'4' while in-flight.
//   acc.onboarding.eligible '1' once we observe the user landed with
//                           zero projects (cold start). Users who arrive
//                           with pre-existing projects never become
//                           eligible — we don't ambush returning users
//                           upgrading from a prior version. The eligible
//                           flag is set the moment we know projectCount,
//                           so a brand-new user who creates a project
//                           keeps the flag and the tour starts.
//
// `restart()` clears all three flags and re-enters the tour at step 1.
// The dashboard exposes a "Ver tour" link gated on `seen === '1'` to
// surface this affordance without crowding the cold-start UI.

import { useCallback, useEffect, useState } from 'react';

export const TOUR_KEY_SEEN = 'acc.onboarding.seen';
export const TOUR_KEY_STEP = 'acc.onboarding.step';
export const TOUR_KEY_ELIGIBLE = 'acc.onboarding.eligible';

export type TourStepNum = 1 | 2 | 3 | 4;
export type TourPage = 'teams' | 'project';

export const TOUR_STEPS: Array<{ step: TourStepNum; page: TourPage }> = [
  { step: 1, page: 'teams' },
  { step: 2, page: 'teams' },
  { step: 3, page: 'project' },
  { step: 4, page: 'project' },
];

function readLs(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLs(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode — silent */ }
}
function removeLs(key: string): void {
  try { localStorage.removeItem(key); } catch { /* silent */ }
}

// ── Pure helpers (exported for tests) ───────────────────────────
// All onboarding-state decisions are split out of the hook so they
// can be unit-tested without a React renderer.

export interface TourFlags {
  seen: boolean;
  eligible: boolean;
  step: number | null;
}

export function decideEligibility(
  flags: TourFlags,
  projectCount: number | undefined,
): 'noop' | 'set-eligible' | 'mark-seen-silently' {
  if (flags.seen) return 'noop';
  if (flags.eligible) return 'noop';
  if (projectCount === undefined) return 'noop';
  if (projectCount === 0) return 'set-eligible';
  return 'mark-seen-silently';
}

export function resolveStep(
  flags: TourFlags,
  page: TourPage,
  projectCount: number | undefined,
): { step: TourStepNum | null; bumpTo: TourStepNum | null } {
  if (flags.seen || !flags.eligible) return { step: null, bumpTo: null };
  const parsed = flags.step ?? 1;
  const candidate = (parsed >= 1 && parsed <= 4 ? parsed : 1) as TourStepNum;
  // Auto-advance 1→2 once the user has at least one project. Keeps the
  // callout meaningful: step 1 only makes sense with a card visible.
  if (candidate === 1 && page === 'teams' && projectCount !== undefined && projectCount > 0) {
    return { step: 2, bumpTo: 2 };
  }
  const def = TOUR_STEPS.find(s => s.step === candidate);
  if (!def || def.page !== page) return { step: null, bumpTo: null };
  return { step: candidate, bumpTo: null };
}

export function computeNextStep(current: number | null): TourStepNum | 'done' {
  const c = current ?? 1;
  if (c + 1 > 4) return 'done';
  return (c + 1) as TourStepNum;
}

export interface UseOnboardingTourArgs {
  // Which page is asking. The hook only returns a non-null step when it
  // matches the page where that step is rendered.
  page: TourPage;
  // The current count of projects on this page (only meaningful for
  // `page === 'teams'` — pass `undefined` from ProjectPage). Used once,
  // on first observation, to decide eligibility.
  projectCount?: number;
}

export interface UseOnboardingTourResult {
  step: TourStepNum | null;          // null = nothing to show on this page
  totalSteps: number;
  next: () => void;
  skip: () => void;
  restart: () => void;
}

export function useOnboardingTour(args: UseOnboardingTourArgs): UseOnboardingTourResult {
  const { page, projectCount } = args;

  // Tick when localStorage changes (we don't get StorageEvent on the
  // same tab, so we bump a counter manually after our own writes).
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick(t => t + 1), []);

  const flags = (): TourFlags => ({
    seen: readLs(TOUR_KEY_SEEN) === '1',
    eligible: readLs(TOUR_KEY_ELIGIBLE) === '1',
    step: readLs(TOUR_KEY_STEP) ? Number(readLs(TOUR_KEY_STEP)) : null,
  });

  // Decide eligibility on the first render where we know projectCount.
  // After the first observation, the flag is sticky in localStorage.
  useEffect(() => {
    if (page !== 'teams') return;
    const decision = decideEligibility(flags(), projectCount);
    if (decision === 'set-eligible') {
      writeLs(TOUR_KEY_ELIGIBLE, '1');
      bump();
    } else if (decision === 'mark-seen-silently') {
      writeLs(TOUR_KEY_SEEN, '1');
      bump();
    }
    // 'noop' — nothing to write.
  }, [page, projectCount, bump]);

  // Resolve current step.
  const { step, bumpTo } = resolveStep(flags(), page, projectCount);
  if (bumpTo !== null) writeLs(TOUR_KEY_STEP, String(bumpTo));
  // Suppress unused-var (tick triggers re-evaluation of readLs above).
  void tick;

  const next = useCallback(() => {
    const current = flags().step;
    const after = computeNextStep(current);
    if (after === 'done') {
      writeLs(TOUR_KEY_SEEN, '1');
      removeLs(TOUR_KEY_STEP);
    } else {
      writeLs(TOUR_KEY_STEP, String(after));
    }
    bump();
  }, [bump]);

  const skip = useCallback(() => {
    writeLs(TOUR_KEY_SEEN, '1');
    removeLs(TOUR_KEY_STEP);
    bump();
  }, [bump]);

  const restart = useCallback(() => {
    removeLs(TOUR_KEY_SEEN);
    writeLs(TOUR_KEY_ELIGIBLE, '1');
    writeLs(TOUR_KEY_STEP, '1');
    bump();
  }, [bump]);

  return { step, totalSteps: TOUR_STEPS.length, next, skip, restart };
}
