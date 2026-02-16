import { useEffect, useState, useCallback } from "react";
import { Toaster } from "sonner";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useTasksStore } from "./store";
import Header from "./components/Header";
import FiltersBar from "./components/Filters";
import AddTaskModal from "./components/AddTaskModal";
import BoardView from "./features/tasks/Board/BoardView";
import ListView from "./features/tasks/List/ListView";
import CalendarView from "./features/tasks/Calendar/CalendarView";
import TodayAgenda from "./features/tasks/Today/TodayAgenda";
import Skeleton from "./components/ui/Skeleton";
import type { ViewMode } from "./store";

const AUTO_REFRESH_MS = 90_000; // 90 sec
const VIEW_TO_PATH: Record<ViewMode, string> = {
  today: "/today",
  board: "/board",
  list: "/list",
  calendar: "/calendar",
};

function pathToViewMode(pathname: string): ViewMode {
  if (pathname === "/today") return "today";
  if (pathname === "/list") return "list";
  if (pathname === "/calendar") return "calendar";
  return "board";
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    fetchTasks,
    fetchClients,
    viewMode,
    setViewMode,
    setFilters,
    filters,
    loading,
    error,
    lastFetched,
    clients,
    selectedClientId,
    setSelectedClientId,
  } = useTasksStore();
  const [addModalOpen, setAddModalOpen] = useState(false);

  // Initial clients fetch
  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    fetchTasks(selectedClientId);
  }, [fetchTasks, selectedClientId]);

  useEffect(() => {
    setViewMode(pathToViewMode(location.pathname));
  }, [location.pathname, setViewMode]);

  useEffect(() => {
    const onFocus = () => {
      const elapsed = lastFetched ? Date.now() - lastFetched : Infinity;
      if (elapsed > 60_000) {
        fetchTasks();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchTasks, lastFetched]);

  // Auto-refresh every 90 sec when tab is visible
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchTasks();
      }
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchTasks]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (!target.matches("input, textarea, select")) {
          e.preventDefault();
          setAddModalOpen(true);
        }
      }
      if (e.key === "Escape") {
        setAddModalOpen(false);
      }
    },
    []
  );
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleSearchChange = useCallback(
    (v: string) => setFilters({ search: v }),
    [setFilters]
  );

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      const nextPath = VIEW_TO_PATH[mode];
      if (location.pathname !== nextPath) {
        navigate(nextPath);
      }
      setViewMode(mode);
    },
    [location.pathname, navigate, setViewMode]
  );

  if (error) {
    return (
      <div className="min-h-screen p-6 anime-pattern">
        <Toaster position="top-right" richColors />
        <div className="anime-card p-8 max-w-md mx-auto text-center">
          <p className="text-red-600 font-semibold mb-4">{error}</p>
          <button
            onClick={() => fetchTasks()}
            className="text-purple-600 hover:underline font-medium"
          >
            Повторить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 anime-pattern">
      <Toaster position="top-right" richColors />
      <Header
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onAddTask={() => setAddModalOpen(true)}
        search={filters.search}
        onSearchChange={handleSearchChange}
        onRefresh={fetchTasks}
        clients={clients}
        selectedClientId={selectedClientId}
        onClientChange={setSelectedClientId}
      />

      <FiltersBar filters={filters} onFiltersChange={setFilters} />

      {loading && !lastFetched ? (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <div className="flex gap-6">
            <Skeleton className="h-96 w-72" />
            <Skeleton className="h-96 w-72" />
            <Skeleton className="h-96 w-72" />
          </div>
        </div>
      ) : (
        <>
          {viewMode === "today" && <TodayAgenda />}
          {viewMode === "board" && <BoardView />}
          {viewMode === "list" && <ListView />}
          {viewMode === "calendar" && <CalendarView />}
        </>
      )}

      <AddTaskModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
      />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/board" replace />} />
        <Route path="/today" element={<AppShell />} />
        <Route path="/board" element={<AppShell />} />
        <Route path="/list" element={<AppShell />} />
        <Route path="/calendar" element={<AppShell />} />
        <Route path="*" element={<Navigate to="/board" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
