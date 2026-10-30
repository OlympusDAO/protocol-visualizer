import { ContractVisualizer } from "./components/contract-visualizer";
import { BridgeLanes } from "./components/bridge-lanes";
import { useEffect, useState } from "react";
import { ThemeSelector } from "./components/theme-selector";

function App() {
  const [view, setView] = useState(() =>
    new URL(window.location.href).searchParams.get("view") === "bridges"
      ? "bridges"
      : "architecture"
  );
  useEffect(() => {
    const restore = () =>
      setView(
        new URL(window.location.href).searchParams.get("view") === "bridges"
          ? "bridges"
          : "architecture"
      );
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  return (
    <div className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">Protocol Visualizer</h1>
          <ThemeSelector />
        </header>
        <nav aria-label="Visualizer views" className="mb-6 flex gap-2">
          {[
            ["architecture", "Architecture"],
            ["bridges", "Bridge lanes"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => {
                const url = new URL(window.location.href);
                if (value === "bridges")
                  url.searchParams.set("view", "bridges");
                else url.searchParams.delete("view");
                window.history.pushState(null, "", url);
                setView(value);
              }}
              className={`rounded-md px-4 py-2 text-sm font-medium ${view === value ? "bg-foreground text-surface" : "bg-surface text-muted hover:bg-surface-muted"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        {view === "bridges" ? <BridgeLanes /> : <ContractVisualizer />}
      </div>
    </div>
  );
}

export default App;
