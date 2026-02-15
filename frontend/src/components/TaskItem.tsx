import type { Task } from "../api";
import { useTasksStore } from "../store";

interface TaskItemProps {
  task: Task;
  deadlineFormatted: string;
}

export default function TaskItem({ task, deadlineFormatted }: TaskItemProps) {
  const toggleTask = useTasksStore((s) => s.toggleTask);
  const isActive = task.status === "active";

  const handleToggle = () => {
    toggleTask(task.id);
  };

  return (
    <li
      className={`rounded-lg border px-4 py-3 transition-all duration-200 ${
        task.important
          ? "border-red-300 bg-red-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={!isActive}
          onChange={handleToggle}
          className="mt-1 h-4 w-4 rounded border-slate-300"
        />
        <div className="min-w-0 flex-1">
          <span className={isActive ? "text-slate-800" : "text-slate-500 line-through"}>
            {task.text}
          </span>
          {deadlineFormatted && (
            <p className="mt-1 text-sm text-slate-500">
              Дедлайн: {deadlineFormatted}
            </p>
          )}
        </div>
      </label>
    </li>
  );
}
