import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useTasksStore } from "../../../store";
import ListTaskRow from "./ListTaskRow";
import EmptyState from "../../../components/ui/EmptyState";
import { List } from "lucide-react";
import { useState } from "react";
import type { Task } from "../../../types";

export default function ListView() {
  const tasks = useTasksStore((s) => s.getFilteredTasks());
  const reorderTasks = useTasksStore((s) => s.reorderTasks);
  const setColumn = useTasksStore((s) => s.setColumn);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = (e: DragStartEvent) => {
    const task = tasks.find((t) => t.id === e.active.id);
    if (task) setActiveTask(task);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const taskId = String(active.id);
    const overId = String(over.id);
    const task = tasks.find((t) => t.id === taskId);
    const overTask = tasks.find((t) => t.id === overId);
    if (!task || !overTask) return;

    const taskCol = task.column ?? "planned";
    const overCol = overTask.column ?? "planned";
    if (taskCol === overCol) {
      const fromIdx = tasks.indexOf(task);
      const toIdx = tasks.indexOf(overTask);
      if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
        reorderTasks(taskCol, fromIdx, toIdx);
      }
    } else {
      setColumn(taskId, overCol);
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="anime-card overflow-hidden">
        {tasks.length === 0 ? (
          <EmptyState
            icon={<List size={48} className="text-purple-300" />}
            title="Нет задач"
            description="Добавьте задачу или измените фильтры"
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-purple-200 bg-purple-50/50">
                <th className="w-10 py-3 pl-4 text-left"></th>
                <th className="py-3 text-left font-semibold text-purple-800">Задача</th>
                <th className="py-3 text-left font-semibold text-purple-800">Колонка</th>
                <th className="py-3 text-left font-semibold text-purple-800">Статус</th>
                <th className="py-3 text-left font-semibold text-purple-800">Срок</th>
                <th className="py-3 text-left font-semibold text-purple-800">Приоритет</th>
              </tr>
            </thead>
            <tbody>
              <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {tasks.map((task) => (
                  <ListTaskRow key={task.id} task={task} />
                ))}
              </SortableContext>
            </tbody>
          </table>
        )}
      </div>

      <DragOverlay>
        {activeTask ? (
          <table className="w-full anime-card">
            <tbody>
              <ListTaskRow task={activeTask} />
            </tbody>
          </table>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
