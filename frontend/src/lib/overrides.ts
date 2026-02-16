import type { ColumnId } from "../types";

const STORAGE_KEY = "voice-task-overrides";

export interface TaskOverrides {
  column?: ColumnId;
  order?: number;
  priority?: "low" | "med" | "high";
  tags?: string[];
  notes?: string;
}

export interface OverridesMap {
  [taskId: string]: TaskOverrides;
}

export function loadOverrides(): OverridesMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as OverridesMap;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveOverrides(map: OverridesMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function getOverride(taskId: string): TaskOverrides | undefined {
  return loadOverrides()[taskId];
}

export function setOverride(taskId: string, overrides: Partial<TaskOverrides>): void {
  const map = loadOverrides();
  const current = map[taskId] ?? {};
  map[taskId] = { ...current, ...overrides };
  saveOverrides(map);
}

export function removeOverride(taskId: string): void {
  const map = loadOverrides();
  delete map[taskId];
  saveOverrides(map);
}
