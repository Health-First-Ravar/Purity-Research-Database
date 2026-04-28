import type { Config } from 'tailwindcss';

// Palette: grounded in Purity brand direction — warm neutrals with a
// chlorophyll-green accent and a deep roast background. Additional tokens
// (aqua, ink, shade, paper) support the dark-mode pass without forcing
// component-level conditionals.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        purity: {
          // Light-mode tokens
          bean:   '#2B1F17', // deep roast (primary text on light)
          cream:  '#F7F1E8', // page background (light)
          green:  '#3F6B4A', // chlorophyll accent
          aqua:   '#009F8D', // Purity brand aqua — focus ring + dark accent
          rust:   '#B04A2E',
          slate:  '#2E3A3A',
          muted:  '#8A8279',
          // Dark-mode tokens
          ink:    '#14100C', // deep background (dark)
          shade:  '#221A14', // card/surface background (dark)
          paper:  '#ECE3D4', // primary text on dark (softer than pure cream)
          mist:   '#9A9189', // muted text on dark
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        serif: ['Fraunces', 'ui-serif', 'Georgia'],
      },
    },
  },
  plugins: [],
};
export default config;
