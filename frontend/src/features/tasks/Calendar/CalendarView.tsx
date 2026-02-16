import { useCallback } from "react";
import { Calendar as BigCalendar, dateFnsLocalizer, type Event } from "react-big-calendar";
import { format, parse, startOfWeek, getDay, startOfDay, endOfDay, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { useTasksStore } from "../../../store";
import type { Task } from "../../../types";
import EmptyState from "../../../components/ui/EmptyState";
import { CalendarDays } from "lucide-react";

const locales = { "ru-RU": ru };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

interface CalendarEvent extends Event {
  task: Task;
}

export default function CalendarView() {
  const tasks = useTasksStore((s) => s.getFilteredTasks());
  const toggleTask = useTasksStore((s) => s.toggleTask);

  const events: CalendarEvent[] = tasks
    .filter((t) => t.deadline)
    .map((t) => {
      const d = parseISO(t.deadline!);
      const clientPrefix = t.client?.displayName ? `[${t.client.displayName}] ` : "";
      const statusPrefix =
        t.appointmentStatus === "canceled" || t.status === "canceled"
          ? "[Canceled] "
          : t.appointmentStatus === "done" || t.status === "completed"
            ? "[Done] "
            : "";
      return {
        id: t.id,
        title: `${statusPrefix}${clientPrefix}${t.text}`,
        start: startOfDay(d),
        end: endOfDay(d),
        task: t,
      };
    });

  const handleSelectEvent = useCallback(
    (event: CalendarEvent) => {
      toggleTask(event.task.id);
    },
    [toggleTask]
  );

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays size={48} className="text-purple-300" />}
        title="Нет задач"
        description="Добавьте задачи со сроками, чтобы видеть их в календаре"
      />
    );
  }

  return (
    <div className="anime-card p-4 h-[600px]">
      <BigCalendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        style={{ height: "100%" }}
        onSelectEvent={handleSelectEvent}
        views={["month", "week", "day"]}
        culture="ru-RU"
        defaultView="month"
        messages={{
          next: "Вперёд",
          previous: "Назад",
          today: "Сегодня",
          month: "Месяц",
          week: "Неделя",
          day: "День",
          agenda: "Повестка",
          date: "Дата",
          time: "Время",
          event: "Событие",
          noEventsInRange: "Нет задач в этом диапазоне",
        }}
        eventPropGetter={(event: CalendarEvent) => {
          const status = event.task.appointmentStatus ?? (event.task.status === "canceled" ? "canceled" : "planned");
          if (status === "canceled") {
            return {
              style: {
                backgroundColor: "rgba(251, 191, 191, 0.7)",
                border: "1px solid rgba(239, 68, 68, 0.8)",
                borderRadius: "8px",
                textDecoration: "line-through",
              },
            };
          }
          if (status === "done") {
            return {
              style: {
                backgroundColor: "rgba(167, 243, 208, 0.75)",
                border: "1px solid rgba(16, 185, 129, 0.85)",
                borderRadius: "8px",
              },
            };
          }
          return {
            style: {
              backgroundColor: "rgba(196, 181, 253, 0.8)",
              border: "1px solid rgba(167, 139, 250, 0.8)",
              borderRadius: "8px",
            },
          };
        }}
      />
    </div>
  );
}
