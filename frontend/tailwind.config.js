/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        arena: {
          ink: "#05060b",
          panel: "#0b0f1a",
          line: "#1e2740",
          cyan: "#37e6ff",
          green: "#38f5a3",
          amber: "#ffb43a",
          red: "#ff5d73",
          magenta: "#ff40b2",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
