import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Calendar, Flag } from "lucide-react";
import { format, parseISO, isPast, isToday } from "date-fns";
import { ru } from "date-fns/locale";
import type { Task } from "../../../types";
import { useTasksStore } from "../../../store";

interface TaskCardProps {
  task: Task;
}

export default function TaskCard({ task }: TaskCardProps) {
  const toggleTask = useTasksStore((s) => s.toggleTask);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isActive = task.status === "active";
  const deadline = task.deadline ? parseISO(task.deadline) : null;
  const isOverdue = deadline && isPast(deadline) && !isToday(deadline) && isActive;

  const priorityColors = {
    low: "text-slate-500",
    med: "text-amber-600",
    high: "text-rose-500",
  } as const;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`anime-card p-4 mb-3 opacity-${isDragging ? "80" : "100"} ${
        isDragging ? "shadow-xl ring-2 ring-purple-400" : ""
      }`}
    >
      <div className="flex gap-3 items-start">
        <button
          {...attributes}
          {...listeners}
          className="mt-1 shrink-0 rounded p-1 text-purple-400 hover:bg-purple-100 cursor-grab active:cursor-grabbing touch-none"
          aria-label="Перетащить"
        >
          <GripVertical size={18} />
        </button>
        <label className="flex-1 min-w-0 cursor-pointer flex gap-3 items-start">
          <input
            type="checkbox"
            checked={!isActive}
            onChange={() => toggleTask(task.id)}
            className="mt-1 h-4 w-4 rounded border-purple-300 text-purple-500 focus:ring-purple-400"
          />
          <div className="min-w-0 flex-1">
            <span
              className={
                isActive
                  ? "text-purple-900 font-medium"
                  : "text-purple-500 line-through"
              }
            >
              {task.text}
            </span>
            {task.client?.displayName && (
              <p className="mt-1 text-xs text-indigo-500">{task.client.displayName}</p>
            )}
            {deadline && (
              <p
                className={`mt-1 flex items-center gap-1 text-xs ${
                  isOverdue ? "text-rose-500" : "text-purple-500"
                }`}
              >
                <Calendar size={12} />
                {format(deadline, "d MMM", { locale: ru })}
                {isOverdue && " • Просрочено"}
              </p>
            )}
            {task.priority && task.priority !== "med" && (
              <span
                className={`inline-flex items-center gap-1 mt-1 text-xs ${priorityColors[task.priority]}`}
              >
                <Flag size={12} />
                {task.priority === "high" ? "Высокий" : "Низкий"}
              </span>
            )}
          </div>
        </label>
      </div>
    </div>
  );
}
