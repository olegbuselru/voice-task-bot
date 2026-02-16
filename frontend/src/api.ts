import axios from "axios";
import type { ApiTask } from "./types";

const envBaseURL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
const baseURL = (envBaseURL && envBaseURL.length > 0
  ? envBaseURL
  : "https://voice-task-bot-backend.onrender.com").replace(/\/$/, "");

const api = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
});

export type { ApiTask };

export async function fetchTasks(): Promise<ApiTask[]> {
  const { data } = await api.get<ApiTask[]>("/tasks");
  return data;
}

export interface CreateTaskPayload {
  text: string;
  originalText?: string;
  important?: boolean;
  deadline?: string | null;
}

export async function createTask(payload: CreateTaskPayload): Promise<ApiTask> {
  const { data } = await api.post<ApiTask>("/tasks", payload);
  return data;
}

export async function completeTask(id: string): Promise<ApiTask> {
  const { data } = await api.patch<ApiTask>(`/tasks/${id}/complete`);
  return data;
}

export async function reopenTask(id: string): Promise<ApiTask> {
  const { data } = await api.patch<ApiTask>(`/tasks/${id}/reopen`);
  return data;
}
