/**
 * Plain module, deliberately not 'use client': a server component that imports
 * a value from a client module gets a module reference, not the value.
 *
 * The four status steps are validated as a categorical palette against the
 * paper surface — lightness band, chroma floor, CVD separation (worst adjacent
 * pair deutan ΔE 13.4) and normal-vision separation (ΔE 20.1) all pass. They
 * are the same four steps the queue urgency rails use. Re-validate before
 * changing any of them.
 */
export const CHART_INK = '#14181A';
export const CHART_MUTED = '#5D6663';
export const CHART_RULE = '#E4DED4';

export const STATUS_STEPS = ['#2A7BA8', '#D6A400', '#DC4A16', '#93174F'] as const;

export const CHART_COLORS = {
  /** Single-series magnitude, the house accent. */
  accent: '#0F6D5A',
  /** Single-series magnitude where the subject is an alert (rules firing). */
  alert: '#DC4A16',
} as const;
