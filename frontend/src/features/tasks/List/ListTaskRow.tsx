import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Flag } from "lucide-react";
import { format, parseISO, isPast, isToday } from "date-fns";
import { ru } from "date-fns/locale";
import type { Task } from "../../../types";
import { useTasksStore } from "../../../store";
import { COLUMNS } from "../../../types";

interface ListTaskRowProps {
  task: Task;
}

export default function ListTaskRow({ task }: ListTaskRowProps) {
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
  const columnLabel = COLUMNS.find((c) => c.id === task.column)?.label ?? task.column;

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-b border-purple-100 hover:bg-purple-50/50 transition-colors ${
        isDragging ? "bg-white shadow-lg" : ""
      }`}
    >
      <td className="py-3 pl-4">
        <button
          {...attributes}
          {...listeners}
          className="rounded p-1 text-purple-400 hover:bg-purple-100 cursor-grab active:cursor-grabbing touch-none"
          aria-label="Перетащить"
        >
          <GripVertical size={16} />
        </button>
      </td>
      <td className="py-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!isActive}
            onChange={() => toggleTask(task.id)}
            className="h-4 w-4 rounded border-purple-300 text-purple-500"
          />
          <span
            className={
              isActive ? "font-medium text-purple-900" : "text-purple-500 line-through"
            }
          >
            {task.text}
          </span>
          {task.client?.displayName && (
            <span className="text-xs text-indigo-500">[{task.client.displayName}]</span>
          )}
        </label>
      </td>
      <td className="py-3 text-sm text-purple-600">{columnLabel}</td>
      <td className="py-3">
        {deadline ? (
          <span className={isOverdue ? "text-rose-500 text-sm" : "text-purple-500 text-sm"}>
            {format(deadline, "d MMM yyyy", { locale: ru })}
            {isOverdue && " • Просрочено"}
          </span>
        ) : (
          <span className="text-slate-400 text-sm">—</span>
        )}
      </td>
      <td className="py-3 text-sm">
        {task.priority === "high" && (
          <span className="text-rose-500 flex items-center gap-1">
            <Flag size={14} /> Высокий
          </span>
        )}
        {task.priority === "low" && (
          <span className="text-slate-500 flex items-center gap-1">
            <Flag size={14} /> Низкий
          </span>
        )}
        {(!task.priority || task.priority === "med") && (
          <span className="text-slate-400">—</span>
        )}
      </td>
    </tr>
  );
}
