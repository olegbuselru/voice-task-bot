import axios from "axios";
import type { ApiTask, ApiAppointment, Client, AppointmentStatus, AppointmentKind } from "./types";

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

export async function fetchClients(): Promise<Client[]> {
  const { data } = await api.get<Client[]>("/clients");
  return data;
}

export async function fetchClientTasks(clientId: string): Promise<ApiTask[]> {
  const { data } = await api.get<ApiTask[]>(`/clients/${clientId}/tasks`);
  return data;
}

export interface FetchAppointmentsParams {
  from?: string;
  to?: string;
  clientId?: string;
  status?: AppointmentStatus;
}

export async function fetchAppointments(params: FetchAppointmentsParams = {}): Promise<ApiAppointment[]> {
  const { data } = await api.get<ApiAppointment[]>("/appointments", { params });
  return data;
}

export interface CreateAppointmentPayload {
  clientId?: string;
  clientName?: string;
  startAt: string;
  endAt?: string;
  kind?: AppointmentKind;
  status?: AppointmentStatus;
  notes?: string | null;
}

export async function createAppointment(payload: CreateAppointmentPayload): Promise<ApiAppointment> {
  const { data } = await api.post<ApiAppointment>("/appointments", payload);
  return data;
}

export async function updateAppointment(
  id: string,
  payload: Partial<CreateAppointmentPayload>
): Promise<ApiAppointment> {
  const { data } = await api.patch<ApiAppointment>(`/appointments/${id}`, payload);
  return data;
}

export async function cancelAppointment(id: string): Promise<ApiAppointment> {
  const { data } = await api.delete<ApiAppointment>(`/appointments/${id}`);
  return data;
}

export interface AvailabilitySlot {
  startAt: string;
  endAt: string;
}

export async function fetchAvailability(params: {
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<AvailabilitySlot[]> {
  const { data } = await api.get<AvailabilitySlot[]>("/availability", { params });
  return data;
}

export interface CreateTaskPayload {
  text?: string;
  title?: string;
  originalText?: string;
  important?: boolean;
  deadline?: string | null;
  dueAt?: string | null;
  clientId?: string;
  clientName?: string;
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
