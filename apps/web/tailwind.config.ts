import type { Config } from "tailwindcss";
import { colors as tokenColors, radius as tokenRadius } from "../../packages/config/src/index";

const config: Config = {
  // "class" instead of "media" -- the site should default to light mode for
  // every visitor regardless of their OS/browser dark-mode preference until
  // there's an explicit theme toggle that adds a `dark` class. All the
  // dark: variants throughout the app stay in the codebase, ready for that
  // toggle, but are inert until then.
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: tokenColors.brand,
        success: tokenColors.success,
        warning: tokenColors.warning,
        danger: tokenColors.danger,
      },
      borderRadius: {
        sm: `${tokenRadius.sm}px`,
        md: `${tokenRadius.md}px`,
        lg: `${tokenRadius.lg}px`,
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
