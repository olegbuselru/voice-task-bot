import { create } from "zustand";
import type { Task } from "./api";
import { fetchTasks as apiFetchTasks, completeTask as apiCompleteTask, reopenTask as apiReopenTask } from "./api";

interface TasksState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  fetchTasks: () => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  fetchTasks: async () => {
    set({ loading: true, error: null });
    try {
      const tasks = await apiFetchTasks();
      set({ tasks, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load tasks",
      });
    }
  },

  toggleTask: async (id: string) => {
    const { tasks } = get();
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    try {
      if (task.status === "active") {
        await apiCompleteTask(id);
      } else {
        await apiReopenTask(id);
      }
      const next = await apiFetchTasks();
      set({ tasks: next });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to update task",
      });
    }
  },
}));
