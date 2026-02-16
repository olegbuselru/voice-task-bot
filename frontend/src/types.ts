export interface Client {
  id: string;
  displayName: string;
  normalizedName: string;
  createdAt: string;
}

export type AppointmentStatus = "planned" | "done" | "canceled";
export type AppointmentKind = "session" | "homework" | "admin" | "other";

export interface ApiAppointment {
  id: string;
  clientId: string;
  client: Pick<Client, "id" | "displayName" | "normalizedName">;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  kind: AppointmentKind;
  notes: string | null;
  createdAt: string;
}

/** Raw task from API */
export interface ApiTask {
  id: string;
  text: string;
  originalText: string;
  important: boolean;
  deadline: string | null;
  status: "active" | "completed";
  createdAt: string;
  completedAt: string | null;
  clientId?: string | null;
  client?: Pick<Client, "id" | "displayName" | "normalizedName"> | null;
  appointmentId?: string;
  startAt?: string;
  endAt?: string;
  appointmentStatus?: AppointmentStatus;
  appointmentKind?: AppointmentKind;
}

/** Kanban columns */
export type ColumnId = "inbox" | "today" | "planned" | "done";

/** Extended task for UI (includes overrides) */
export interface Task extends ApiTask {
  /** UI-only: column override from localStorage */
  column?: ColumnId;
  /** UI-only: order override within column */
  order?: number;
  /** UI-only: priority for display */
  priority?: "low" | "med" | "high";
  /** UI-only: tags for filtering */
  tags?: string[];
  /** UI-only: notes */
  notes?: string;
}

export const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "today", label: "Today" },
  { id: "planned", label: "Planned" },
  { id: "done", label: "Done" },
];
