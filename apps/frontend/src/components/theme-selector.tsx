import { useState } from "react";

export function ThemeSelector() {
  const [theme, setTheme] = useState(() => {
    const scheme = document.documentElement.style.colorScheme;
    return scheme === "light" || scheme === "dark" ? scheme : "system";
  });

  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Theme
      <select
        value={theme}
        onChange={(event) => {
          const value = event.target.value;
          document.documentElement.style.colorScheme =
            value === "system" ? "light dark" : value;
          setTheme(value);
          try {
            localStorage.setItem("protocol-visualizer-theme", value);
          } catch {
            // Theme selection still works when storage is unavailable.
          }
        }}
        className="rounded-md border border-ui-border bg-surface px-3 py-2 text-foreground"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
