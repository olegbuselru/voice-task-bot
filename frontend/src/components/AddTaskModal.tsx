import { useEffect } from "react";
import { toast } from "sonner";
import { X, Calendar, Tag, Flag } from "lucide-react";
import { format } from "date-fns";
import Button from "./ui/Button";
import { useTasksStore } from "../store";
import { setOverride } from "../lib/overrides";
import type { ColumnId } from "../types";

interface AddTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialText?: string;
  initialColumn?: ColumnId;
}

const PRIORITIES = [
  { value: "low", label: "Low", color: "text-slate-500" },
  { value: "med", label: "Medium", color: "text-amber-600" },
  { value: "high", label: "High", color: "text-red-500" },
] as const;

export default function AddTaskModal({
  isOpen,
  onClose,
  initialText = "",
  initialColumn = "planned",
}: AddTaskModalProps) {
  const createTask = useTasksStore((s) => s.createTask);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const title = (form.elements.namedItem("title") as HTMLInputElement).value.trim();
    const dueDate = (form.elements.namedItem("dueDate") as HTMLInputElement)?.value || undefined;
    const priority = (form.elements.namedItem("priority") as HTMLSelectElement)?.value as "low" | "med" | "high";
    const column = (form.elements.namedItem("column") as HTMLSelectElement)?.value as ColumnId;

    if (!title) return;

    createTask({
      text: title,
      originalText: title,
      important: priority === "high",
      deadline: dueDate ? new Date(dueDate).toISOString() : null,
    }).then((task) => {
      if (task) {
        setOverride(task.id, { column, priority });
        onClose();
        toast.success("Задача создана");
      }
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!isOpen) return null;

  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="anime-card w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-purple-800">Новая задача</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-purple-500 hover:bg-purple-100 transition-colors"
            aria-label="Закрыть"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="title" className="block text-sm font-semibold text-purple-700 mb-1">
              Название *
            </label>
            <input
              id="title"
              name="title"
              type="text"
              defaultValue={initialText}
              placeholder="Что нужно сделать?"
              className="w-full rounded-xl border border-purple-200 px-4 py-2.5 focus:border-purple-400 focus:ring-2 focus:ring-purple-200 outline-none transition"
              autoFocus
              required
            />
          </div>

          <div>
            <label htmlFor="notes" className="block text-sm font-semibold text-purple-700 mb-1 flex items-center gap-2">
              <Tag size={14} /> Заметки
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              placeholder="Дополнительные детали..."
              className="w-full rounded-xl border border-purple-200 px-4 py-2.5 focus:border-purple-400 focus:ring-2 focus:ring-purple-200 outline-none transition resize-none"
            />
          </div>

          <div>
            <label htmlFor="dueDate" className="block text-sm font-semibold text-purple-700 mb-1 flex items-center gap-2">
              <Calendar size={14} /> Срок
            </label>
            <input
              id="dueDate"
              name="dueDate"
              type="date"
              min={today}
              className="w-full rounded-xl border border-purple-200 px-4 py-2.5 focus:border-purple-400 focus:ring-2 focus:ring-purple-200 outline-none transition"
            />
          </div>

          <div>
            <label htmlFor="priority" className="block text-sm font-semibold text-purple-700 mb-1 flex items-center gap-2">
              <Flag size={14} /> Приоритет
            </label>
            <select
              id="priority"
              name="priority"
              className="w-full rounded-xl border border-purple-200 px-4 py-2.5 focus:border-purple-400 focus:ring-2 focus:ring-purple-200 outline-none transition bg-white"
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="column" className="block text-sm font-semibold text-purple-700 mb-1">
              Колонка
            </label>
            <select
              id="column"
              name="column"
              defaultValue={initialColumn}
              className="w-full rounded-xl border border-purple-200 px-4 py-2.5 focus:border-purple-400 focus:ring-2 focus:ring-purple-200 outline-none transition bg-white"
            >
              <option value="planned">Planned</option>
              <option value="done">Done</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="submit" className="flex-1">
              Создать
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Отмена
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
