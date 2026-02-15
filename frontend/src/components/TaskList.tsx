import { useTasksStore } from "../store";
import TaskItem from "./TaskItem";

function formatDeadlineMoscow(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  } catch {
    return "";
  }
}

export default function TaskList() {
  const { tasks, loading, error } = useTasksStore();
  const active = tasks.filter((t) => t.status === "active");
  const completed = tasks.filter((t) => t.status === "completed");

  if (loading) {
    return <p className="text-slate-500">Загрузка...</p>;
  }

  if (error) {
    return <p className="text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-lg font-medium text-slate-700">Активные задачи</h2>
        <ul className="space-y-2 transition-all duration-200">
          {active.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              deadlineFormatted={formatDeadlineMoscow(task.deadline)}
            />
          ))}
          {active.length === 0 && (
            <li className="rounded border border-dashed border-slate-300 bg-white px-4 py-3 text-slate-500">
              Нет активных задач
            </li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-slate-600">Выполненные</h2>
        <ul className="space-y-2 transition-all duration-200">
          {completed.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              deadlineFormatted={formatDeadlineMoscow(task.deadline)}
            />
          ))}
          {completed.length === 0 && (
            <li className="rounded border border-dashed border-slate-200 bg-white px-4 py-3 text-slate-400">
              Нет выполненных задач
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
