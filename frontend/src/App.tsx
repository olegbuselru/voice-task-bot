import { useEffect } from "react";
import { useTasksStore } from "./store";
import TaskList from "./components/TaskList";

const POLL_INTERVAL_MS = 15000;

function App() {
  const fetchTasks = useTasksStore((s) => s.fetchTasks);

  useEffect(() => {
    let intervalId: number | undefined;

    const start = () => {
      if (intervalId) return;
      fetchTasks(); // immediate refresh
      intervalId = window.setInterval(fetchTasks, POLL_INTERVAL_MS);
    };

    const stop = () => {
      if (!intervalId) return;
      window.clearInterval(intervalId);
      intervalId = undefined;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    onVisibilityChange();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchTasks]);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-800">Голосовые задачи</h1>
      </header>
      <TaskList />
    </div>
  );
}

export default App;
