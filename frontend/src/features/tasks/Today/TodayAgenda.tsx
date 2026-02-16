import { useMemo } from "react";
import { format, isToday, parseISO } from "date-fns";
import { CalendarDays, CheckCircle2, CircleOff } from "lucide-react";
import { useTasksStore } from "../../../store";
import EmptyState from "../../../components/ui/EmptyState";

export default function TodayAgenda() {
  const tasks = useTasksStore((s) => s.getFilteredTasks());
  const setAppointmentStatus = useTasksStore((s) => s.setAppointmentStatus);

  const todayItems = useMemo(() => {
    return tasks
      .filter((task) => {
        if (!task.appointmentId) return false;
        const source = task.startAt ?? task.deadline;
        if (!source) return false;
        return isToday(parseISO(source));
      })
      .sort((a, b) => {
        const aTime = parseISO(a.startAt ?? a.deadline ?? new Date().toISOString()).getTime();
        const bTime = parseISO(b.startAt ?? b.deadline ?? new Date().toISOString()).getTime();
        return aTime - bTime;
      });
  }, [tasks]);

  if (!todayItems.length) {
    return (
      <EmptyState
        icon={<CalendarDays size={48} className="text-purple-300" />}
        title="Сегодня записей нет"
        description="Новые записи на сегодня появятся здесь"
      />
    );
  }

  return (
    <div className="anime-card p-5">
      <h2 className="text-lg font-bold text-purple-800 mb-4">Today agenda</h2>
      <div className="space-y-3">
        {todayItems.map((item) => {
          const start = item.startAt ?? item.deadline;
          const status = item.appointmentStatus ?? "planned";
          return (
            <div
              key={item.id}
              className="rounded-xl border border-purple-200 bg-white/70 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div>
                <p className="font-semibold text-purple-900">{item.text}</p>
                <p className="text-sm text-purple-600">
                  {start ? format(parseISO(start), "HH:mm") : "--:--"}
                  {item.client?.displayName ? ` • ${item.client.displayName}` : ""}
                  {status === "canceled" ? " • Canceled" : status === "done" ? " • Done" : " • Planned"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setAppointmentStatus(item.id, "done")}
                  disabled={status === "done"}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle2 size={14} />
                  Done
                </button>
                <button
                  onClick={() => setAppointmentStatus(item.id, "canceled")}
                  disabled={status === "canceled"}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm text-rose-700 disabled:opacity-50"
                >
                  <CircleOff size={14} />
                  Cancel
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
