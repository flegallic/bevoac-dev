import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      colors: {
        ink: {
          950: "#070b12",
          900: "#0b111c",
          850: "#101826",
          800: "#141f30",
          700: "#1c2b40"
        },
        signal: {
          400: "#3ce7c4",
          500: "#10bfa6",
          600: "#0b8f83"
        }
      },
      boxShadow: {
        glow: "0 0 36px rgba(60, 231, 196, 0.16)"
      }
    }
  },
  plugins: []
};

export default config;
