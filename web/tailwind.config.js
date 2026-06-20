/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Semantic tokens -> CSS variables (see src/index.css).
      // Retheme the whole app by editing the :root variables; default is neutral monochrome.
      colors: {
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-2": "rgb(var(--c-surface-2) / <alpha-value>)",
        border: "rgb(var(--c-border) / <alpha-value>)",
        fg: "rgb(var(--c-fg) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        faint: "rgb(var(--c-faint) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        "accent-fg": "rgb(var(--c-accent-fg) / <alpha-value>)",
        positive: "rgb(var(--c-positive) / <alpha-value>)",
        negative: "rgb(var(--c-negative) / <alpha-value>)",
        warning: "rgb(var(--c-warning) / <alpha-value>)",
      },
      fontFamily: {
        // SF Pro leads on macOS/iOS (true San Francisco); Inter is the
        // cross-platform fallback so non-Apple devices render as before.
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "SF Pro Text",
          "Helvetica Neue",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "Segoe UI",
          "Roboto",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // Half-step spacing used by the ported screens (p-4.5, px-5.5, h-4.5, …).
      spacing: {
        4.5: "1.125rem",
        5.5: "1.375rem",
      },
      borderColor: {
        DEFAULT: "rgb(var(--c-border) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
