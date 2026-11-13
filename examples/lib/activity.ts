import { useSyncExternalStore } from "react";

export type ActivityStatus = "running" | "ok" | "error";

export type Activity = {
  id: number;
  category: string;
  label: string;
  detail?: string;
  /** wall clock time the action started */
  time: number;
  /** performance.now() at start */
  start: number;
  duration?: number;
  status: ActivityStatus;
  result?: string;
};

const MAX_ENTRIES = 2000;

let entries: Activity[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
let scheduled = false;

function emit() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const listener of listeners) listener();
  });
}

function update(id: number, patch: Partial<Activity>) {
  entries = entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
  emit();
}

/** Start an activity, returns a function to finish it */
export function begin(category: string, label: string, detail?: string) {
  const entry: Activity = {
    id: nextId++,
    category,
    label,
    detail,
    time: Date.now(),
    start: performance.now(),
    status: "running",
  };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  emit();

  return (status: "ok" | "error", result?: string) => {
    update(entry.id, {
      status,
      result,
      duration: performance.now() - entry.start,
    });
  };
}

/** Run an async function and record it in the activity log */
export async function track<T>(
  category: string,
  label: string,
  fn: () => Promise<T> | T,
  summarize?: (result: T) => string,
  detail?: string,
): Promise<T> {
  const finish = begin(category, label, detail);
  try {
    const result = await fn();
    finish("ok", summarize?.(result));
    return result;
  } catch (error) {
    finish("error", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** Record an already measured action */
export function record(
  category: string,
  label: string,
  duration: number,
  result?: string,
  status: "ok" | "error" = "ok",
  detail?: string,
) {
  const entry: Activity = {
    id: nextId++,
    category,
    label,
    detail,
    time: Date.now(),
    start: performance.now() - duration,
    duration,
    status,
    result,
  };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  emit();
}

export function clearActivity() {
  entries = entries.filter((e) => e.status === "running");
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActivity() {
  return useSyncExternalStore(subscribe, () => entries);
}
