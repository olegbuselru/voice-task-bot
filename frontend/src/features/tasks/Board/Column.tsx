import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { ColumnId } from "../../../types";
import TaskCard from "./TaskCard";
import EmptyState from "../../../components/ui/EmptyState";
import type { Task } from "../../../types";
import { CalendarClock, CheckCircle, CircleOff } from "lucide-react";

interface ColumnProps {
  id: ColumnId;
  label: string;
  tasks: Task[];
}

const ICONS: Record<ColumnId, React.ReactNode> = {
  planned: <CalendarClock size={20} />,
  done: <CheckCircle size={20} />,
  canceled: <CircleOff size={20} />,
};

export default function Column({ id, label, tasks }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  const taskIds = tasks.map((t) => t.id);

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-72 rounded-2xl border-2 transition-colors ${
        isOver ? "border-purple-400 bg-purple-50/50" : "border-purple-200 bg-white/60"
      }`}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-purple-100">
        <span className="text-purple-500">{ICONS[id]}</span>
        <h3 className="font-bold text-purple-800">{label}</h3>
        <span className="ml-auto text-sm text-purple-500">{tasks.length}</span>
      </div>
      <div className="p-3 min-h-[120px] max-h-[60vh] overflow-y-auto">
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <EmptyState
            title="Пусто"
            description={
              id === "done"
                ? "Завершенные записи появятся здесь"
                : id === "canceled"
                  ? "Отмененные записи появятся здесь"
                  : "Перетащите запись сюда"
            }
          />
        )}
      </div>
    </div>
  );
}
