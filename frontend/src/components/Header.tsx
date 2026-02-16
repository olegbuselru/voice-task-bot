import { LayoutGrid, List, Calendar } from "lucide-react";
import Button from "./ui/Button";
import VoiceAdd from "../features/voice/VoiceAdd";
import type { ViewMode } from "../store";
import type { Client } from "../types";

interface HeaderProps {
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  onAddTask: () => void;
  search: string;
  onSearchChange: (v: string) => void;
  onRefresh: () => void;
  clients: Client[];
  selectedClientId: string | null;
  onClientChange: (clientId: string | null) => void;
}

export default function Header({
  viewMode,
  onViewModeChange,
  onAddTask,
  search,
  onSearchChange,
  onRefresh,
  clients,
  selectedClientId,
  onClientChange,
}: HeaderProps) {
  return (
    <header className="mb-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 anime-glow-text">
          Voice Task
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="primary" size="sm" onClick={onAddTask}>
            + Задача
          </Button>
          <VoiceAdd />
          <Button variant="ghost" size="sm" onClick={onRefresh} title="Обновить">
            ↻
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedClientId ?? ""}
          onChange={(e) => onClientChange(e.target.value || null)}
          className="rounded-xl border border-purple-200 px-4 py-2.5 w-64 focus:border-purple-400 focus:ring-2 focus:ring-purple-200 outline-none bg-white/80"
          aria-label="Клиент"
        >
          <option value="">Все клиенты</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.displayName}
            </option>
          ))}
        </select>

        <div className="flex rounded-xl overflow-hidden border border-purple-200 bg-white/80">
          <button
            onClick={() => onViewModeChange("board")}
            className={`flex items-center gap-2 px-4 py-2.5 font-semibold transition-colors ${
              viewMode === "board"
                ? "bg-purple-500 text-white"
                : "text-purple-600 hover:bg-purple-50"
            }`}
          >
            <LayoutGrid size={18} />
            Board
          </button>
          <button
            onClick={() => onViewModeChange("list")}
            className={`flex items-center gap-2 px-4 py-2.5 font-semibold transition-colors border-l border-purple-200 ${
              viewMode === "list"
                ? "bg-purple-500 text-white"
                : "text-purple-600 hover:bg-purple-50"
            }`}
          >
            <List size={18} />
            List
          </button>
          <button
            onClick={() => onViewModeChange("calendar")}
            className={`flex items-center gap-2 px-4 py-2.5 font-semibold transition-colors border-l border-purple-200 ${
              viewMode === "calendar"
                ? "bg-purple-500 text-white"
                : "text-purple-600 hover:bg-purple-50"
            }`}
          >
            <Calendar size={18} />
            Calendar
          </button>
        </div>

        <input
          type="search"
          placeholder="Поиск..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="rounded-xl border border-purple-200 px-4 py-2.5 w-64 focus:border-purple-400 focus:ring-2 focus:ring-purple-200 outline-none bg-white/80"
        />
      </div>
    </header>
  );
}
