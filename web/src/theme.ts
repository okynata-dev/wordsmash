// Theme: light is the default; dark is opt-in via the `.dark` class on <html>.
// The choice persists in localStorage and is applied pre-paint by an inline
// script in index.html (so a dark-mode user never sees a light flash).
export type Theme = "light" | "dark";

const KEY = "keepney.theme";
const META_COLOR: Record<Theme, string> = { light: "#fafafa", dark: "#09090b" };

export function storedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // private mode etc. — theme still applies for this page view
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLOR[t]);
}
