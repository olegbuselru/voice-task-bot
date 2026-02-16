import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useTasksStore } from "../../../store";
import { COLUMNS } from "../../../types";
import type { ColumnId } from "../../../types";
import Column from "./Column";
import TaskCard from "./TaskCard";
import { useState } from "react";
import type { Task } from "../../../types";

function getColumnTasks(tasks: Task[], columnId: ColumnId): Task[] {
  return tasks
    .filter((t) => t.column === columnId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export default function BoardView() {
  const { setColumn, reorderTasks, getFilteredTasks } = useTasksStore();
  const filtered = getFilteredTasks();
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handleDragStart = (e: DragStartEvent) => {
    const task = filtered.find((t) => t.id === e.active.id);
    if (task) setActiveTask(task);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = e;
    if (!over) return;

    const taskId = String(active.id);
    const task = filtered.find((t) => t.id === taskId);
    if (!task) return;

    const overId = String(over.id);

    // Dropped on another task
    const overTask = filtered.find((t) => t.id === overId);
    const taskColumn = task.column ?? "planned";
    if (overTask) {
      const overColumn = overTask.column ?? "planned";
      if (overColumn !== taskColumn) {
        setColumn(taskId, overColumn);
      } else {
        const colTasks = getColumnTasks(filtered, taskColumn);
        const fromIdx = colTasks.findIndex((t) => t.id === taskId);
        const toIdx = colTasks.findIndex((t) => t.id === overId);
        if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
          reorderTasks(taskColumn, fromIdx, toIdx);
        }
      }
      return;
    }

    // Dropped on column empty area (droppable)
    const droppedOnColumn = COLUMNS.find((c) => c.id === overId);
    if (droppedOnColumn && droppedOnColumn.id !== taskColumn) {
      setColumn(taskId, droppedOnColumn.id);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-6 overflow-x-auto pb-4">
        {COLUMNS.map((col) => (
          <Column
            key={col.id}
            id={col.id}
            label={col.label}
            tasks={getColumnTasks(filtered, col.id)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="opacity-90 rotate-2 scale-105">
            <TaskCard task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
