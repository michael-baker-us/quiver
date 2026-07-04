import { useCallback, useState } from "react";

export type Theme = "light" | "dark";

/** index.html sets data-theme before first paint; this hook just reads/toggles it. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme) ?? "light",
  );
  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("quiver-theme", next);
      return next;
    });
  }, []);
  return [theme, toggle];
}
