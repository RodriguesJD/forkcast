import type { WeekPlan } from '../domain/types';
import { defaultSettings } from '../domain/defaults';

/**
 * The only module that touches `window`. Persists the plan and the shopping
 * checkbox state. Domain code never imports this.
 */

const PLAN_KEY = 'forkcast.plan.v1';
const CHECKED_KEY = 'forkcast.checked.v1';

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, quota). The app keeps working in memory.
  }
}

export function loadPlan(): WeekPlan {
  const raw = safeGet(PLAN_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<WeekPlan>;
      if (parsed && Array.isArray(parsed.entries) && parsed.settings) {
        // Fill in any settings added since this plan was saved.
        return { settings: { ...defaultSettings(), ...parsed.settings }, entries: parsed.entries };
      }
    } catch {
      // fall through to a fresh plan
    }
  }
  return { settings: defaultSettings(), entries: [] };
}

export function savePlan(plan: WeekPlan): void {
  safeSet(PLAN_KEY, JSON.stringify(plan));
}

export function loadChecked(): Record<string, boolean> {
  const raw = safeGet(CHECKED_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function saveChecked(checked: Record<string, boolean>): void {
  safeSet(CHECKED_KEY, JSON.stringify(checked));
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
