import { useEffect, useState, useCallback } from "react";
import { Toaster } from "sonner";
import { useTasksStore } from "./store";
import Header from "./components/Header";
import FiltersBar from "./components/Filters";
import AddTaskModal from "./components/AddTaskModal";
import BoardView from "./features/tasks/Board/BoardView";
import ListView from "./features/tasks/List/ListView";
import CalendarView from "./features/tasks/Calendar/CalendarView";
import Skeleton from "./components/ui/Skeleton";

const AUTO_REFRESH_MS = 90_000; // 90 sec

function App() {
  const {
    fetchTasks,
    viewMode,
    setViewMode,
    setFilters,
    filters,
    loading,
    error,
    lastFetched,
  } = useTasksStore();
  const [addModalOpen, setAddModalOpen] = useState(false);

  // Initial fetch + visibility refetch
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

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
        onViewModeChange={setViewMode}
        onAddTask={() => setAddModalOpen(true)}
        search={filters.search}
        onSearchChange={handleSearchChange}
        onRefresh={fetchTasks}
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

export default App;
