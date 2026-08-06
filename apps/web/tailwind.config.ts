import type { Config } from "tailwindcss";
import { colors as tokenColors, radius as tokenRadius } from "../../packages/config/src/index";

const config: Config = {
  darkMode: "media",
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
