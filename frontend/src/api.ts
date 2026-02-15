import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "";

const api = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
});

export interface Task {
  id: string;
  text: string;
  originalText: string;
  important: boolean;
  deadline: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export async function fetchTasks(): Promise<Task[]> {
  const { data } = await api.get<Task[]>("/tasks");
  return data;
}

export async function completeTask(id: string): Promise<Task> {
  const { data } = await api.patch<Task>(`/tasks/${id}/complete`);
  return data;
}

export async function reopenTask(id: string): Promise<Task> {
  const { data } = await api.patch<Task>(`/tasks/${id}/reopen`);
  return data;
}
