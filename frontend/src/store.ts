import { create } from "zustand";
import { isToday, isPast, parseISO } from "date-fns";
import type { Task, ColumnId } from "./types";
import type { ApiTask } from "./api";
import {
  fetchTasks as apiFetchTasks,
  createTask as apiCreateTask,
  completeTask as apiCompleteTask,
  reopenTask as apiReopenTask,
  type CreateTaskPayload,
} from "./api";
import { loadOverrides, setOverride, type OverridesMap } from "./lib/overrides";

export type ViewMode = "board" | "list" | "calendar";

export interface Filters {
  search: string;
  status: string | null; // column or "all"
  tags: string[];
  priority: string | null;
  overdue: boolean;
  todayOnly: boolean;
}

const DEFAULT_FILTERS: Filters = {
  search: "",
  status: null,
  tags: [],
  priority: null,
  overdue: false,
  todayOnly: false,
};

function inferColumn(task: ApiTask, overrides: OverridesMap): ColumnId {
  const ov = overrides[task.id];
  if (ov?.column) return ov.column;
  if (task.status === "completed") return "done";
  if (!task.deadline) return "inbox";
  const d = parseISO(task.deadline);
  if (isToday(d)) return "today";
  if (isPast(d)) return "inbox"; // overdue -> inbox
  return "planned";
}

function mergeTasks(apiTasks: ApiTask[], overrides: OverridesMap): Task[] {
  return apiTasks.map((t) => {
    const ov = overrides[t.id] ?? {};
    const column = inferColumn(t, overrides);
    return {
      ...t,
      column,
      order: ov.order ?? 0,
      priority: ov.priority ?? (t.important ? "high" : "med"),
      tags: ov.tags ?? [],
      notes: ov.notes,
    } as Task;
  });
}

interface TasksState {
  tasks: Task[];
  rawTasks: ApiTask[];
  overrides: OverridesMap;
  loading: boolean;
  error: string | null;
  viewMode: ViewMode;
  filters: Filters;
  lastFetched: number | null;

  // Actions
  fetchTasks: () => Promise<void>;
  createTask: (payload: CreateTaskPayload) => Promise<Task | null>;
  toggleTask: (id: string) => Promise<void>;
  setColumn: (taskId: string, column: ColumnId) => void;
  setOrder: (taskId: string, column: ColumnId, newOrder: number) => void;
  reorderTasks: (columnId: ColumnId, fromIndex: number, toIndex: number) => void;

  setViewMode: (mode: ViewMode) => void;
  setFilters: (f: Partial<Filters>) => void;

  getFilteredTasks: () => Task[];
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  rawTasks: [],
  overrides: loadOverrides(),
  loading: false,
  error: null,
  viewMode: "board",
  filters: DEFAULT_FILTERS,
  lastFetched: null,

  fetchTasks: async () => {
    set({ loading: true, error: null });
    try {
      const rawTasks = await apiFetchTasks();
      const overrides = loadOverrides();
      const tasks = mergeTasks(rawTasks, overrides);
      set({
        rawTasks,
        tasks,
        overrides,
        loading: false,
        lastFetched: Date.now(),
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load tasks",
      });
    }
  },

  createTask: async (payload) => {
    try {
      const task = await apiCreateTask(payload);
      const overrides = loadOverrides();
      const merged = mergeTasks([...get().rawTasks, task], overrides);
      set({ rawTasks: [...get().rawTasks, task], tasks: merged });
      return merged.find((t) => t.id === task.id) ?? null;
    } catch {
      return null;
    }
  },

  toggleTask: async (id) => {
    const { tasks, rawTasks } = get();
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    // Optimistic update
    const newStatus: "active" | "completed" =
      task.status === "active" ? "completed" : "active";
    const optimistic: ApiTask[] = rawTasks.map((t) =>
      t.id === id
        ? {
            ...t,
            status: newStatus,
            completedAt: newStatus === "completed" ? new Date().toISOString() : null,
          }
        : t
    );
    const overrides = loadOverrides();
    set({ rawTasks: optimistic, tasks: mergeTasks(optimistic, overrides) });

    try {
      if (task.status === "active") {
        await apiCompleteTask(id);
      } else {
        await apiReopenTask(id);
      }
      const rawTasksNext = await apiFetchTasks();
      set({ rawTasks: rawTasksNext, tasks: mergeTasks(rawTasksNext, overrides) });
    } catch (err) {
      // Revert
      set({ rawTasks, tasks: mergeTasks(rawTasks, overrides) });
      throw err;
    }
  },

  setColumn: (taskId, column) => {
    const { rawTasks, overrides } = get();
    const task = rawTasks.find((t) => t.id === taskId);
    const isDone = column === "done";

    if (task && isDone && task.status === "active") {
      apiCompleteTask(taskId)
        .then(() => {
          const next = rawTasks.map((t) =>
            t.id === taskId ? { ...t, status: "completed" as const, completedAt: new Date().toISOString() } : t
          );
          set({ rawTasks: next, tasks: mergeTasks(next, loadOverrides()) });
        })
        .catch(() => {});
      return;
    }
    if (task && !isDone && task.status === "completed") {
      apiReopenTask(taskId)
        .then(() => {
          const next = rawTasks.map((t) =>
            t.id === taskId ? { ...t, status: "active" as const, completedAt: null } : t
          );
          setOverride(taskId, { ...overrides[taskId], column });
          set({
            rawTasks: next,
            overrides: loadOverrides(),
            tasks: mergeTasks(next, loadOverrides()),
          });
        })
        .catch(() => {});
      return;
    }
    setOverride(taskId, { ...overrides[taskId], column });
    const nextOverrides = loadOverrides();
    set({ overrides: nextOverrides, tasks: mergeTasks(rawTasks, nextOverrides) });
  },

  setOrder: (taskId, columnId, newOrder) => {
    setOverride(taskId, { ...loadOverrides()[taskId], column: columnId, order: newOrder });
    const nextOverrides = loadOverrides();
    set({ overrides: nextOverrides, tasks: mergeTasks(get().rawTasks, nextOverrides) });
  },

  reorderTasks: (columnId, fromIndex, toIndex) => {
    const { tasks } = get();
    const colTasks = tasks
      .filter((t) => t.column === columnId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const [moved] = colTasks.splice(fromIndex, 1);
    colTasks.splice(toIndex, 0, moved);
    colTasks.forEach((t, i) => setOverride(t.id, { ...loadOverrides()[t.id], order: i }));
    const nextOverrides = loadOverrides();
    set({ overrides: nextOverrides, tasks: mergeTasks(get().rawTasks, nextOverrides) });
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setFilters: (f) => set({ filters: { ...get().filters, ...f } }),

  getFilteredTasks: () => {
    const { tasks, filters } = get();
    let out = [...tasks];

    if (filters.search.trim()) {
      const q = filters.search.toLowerCase().trim();
      out = out.filter(
        (t) =>
          t.text.toLowerCase().includes(q) ||
          (t.originalText ?? "").toLowerCase().includes(q) ||
          (t.notes ?? "").toLowerCase().includes(q)
      );
    }
    if (filters.status && filters.status !== "all") {
      out = out.filter((t) => t.column === filters.status);
    }
    if (filters.tags.length) {
      out = out.filter((t) =>
        filters.tags.every((tag) => (t.tags ?? []).includes(tag))
      );
    }
    if (filters.priority) {
      out = out.filter((t) => t.priority === filters.priority);
    }
    if (filters.overdue) {
      out = out.filter((t) => {
        if (!t.deadline || t.status === "completed") return false;
        return isPast(parseISO(t.deadline)) && !isToday(parseISO(t.deadline));
      });
    }
    if (filters.todayOnly) {
      out = out.filter((t) => {
        if (!t.deadline || t.status === "completed") return false;
        return isToday(parseISO(t.deadline));
      });
    }
    return out;
  },
}));
