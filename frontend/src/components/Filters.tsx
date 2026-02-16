import { Filter, X } from "lucide-react";
import Button from "./ui/Button";
import { COLUMNS } from "../types";
import type { Filters } from "../store";

interface FiltersProps {
  filters: Filters;
  onFiltersChange: (f: Partial<Filters>) => void;
}

export default function FiltersBar({ filters, onFiltersChange }: FiltersProps) {
  const hasActive = !!(
    filters.status ||
    filters.priority ||
    filters.overdue ||
    filters.todayOnly
  );

  const clearAll = () => {
    onFiltersChange({
      status: null,
      priority: null,
      overdue: false,
      todayOnly: false,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      <span className="text-sm font-semibold text-purple-700 flex items-center gap-2">
        <Filter size={16} />
        Фильтры:
      </span>
      <select
        value={filters.status ?? ""}
        onChange={(e) =>
          onFiltersChange({
            status: e.target.value || null,
          })
        }
        className="rounded-lg border border-purple-200 px-3 py-2 text-sm focus:border-purple-400 outline-none bg-white/80"
      >
        <option value="">Все колонки</option>
        {COLUMNS.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <select
        value={filters.priority ?? ""}
        onChange={(e) =>
          onFiltersChange({
            priority: e.target.value || null,
          })
        }
        className="rounded-lg border border-purple-200 px-3 py-2 text-sm focus:border-purple-400 outline-none bg-white/80"
      >
        <option value="">Любой приоритет</option>
        <option value="high">Высокий</option>
        <option value="med">Средний</option>
        <option value="low">Низкий</option>
      </select>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={filters.overdue}
          onChange={(e) => onFiltersChange({ overdue: e.target.checked })}
          className="rounded border-purple-300 text-purple-500"
        />
        <span className="text-sm text-purple-700">Просрочено</span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={filters.todayOnly}
          onChange={(e) => onFiltersChange({ todayOnly: e.target.checked })}
          className="rounded border-purple-300 text-purple-500"
        />
        <span className="text-sm text-purple-700">На сегодня</span>
      </label>
      {hasActive && (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X size={16} />
          Сбросить
        </Button>
      )}
    </div>
  );
}
