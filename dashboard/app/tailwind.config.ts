import type { Config } from 'tailwindcss';

// Palette: Brian's Lab Testing tracker, adopted as the Research Hub look
// (decision 2026-10-03) so the two tools read as one product. Existing token
// names are kept and remapped, so every current page restyles without edits:
//   bean  -> ink text        cream -> page ground     green -> primary teal
//   rust  -> over-limit red  muted -> secondary text
// Dark-mode tokens (ink, shade, paper, mist) are dark variants of the same palette.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        purity: {
          // Light
          bean:     '#1D2B2A', // ink: primary text
          cream:    '#F3F5F5', // page ground
          green:    '#00665E', // primary teal
          teal:     '#00665E',
          tealdark: '#004D47',
          aqua:     '#009F8D',
          gold:     '#F1B434',
          beige:    '#D5CCBA',
          brown:    '#3D290D',
          rust:     '#C0392B',
          slate:    '#2E3A3A',
          muted:    '#5F6F6D',
          line:     '#DFE5E4',
          soft:     '#EEF4F3',
          card:     '#FFFFFF',
          // Dark
          ink:      '#0F1716', // page ground (dark)
          shade:    '#16201F', // card surface (dark)
          paper:    '#E3ECEA', // primary text (dark)
          mist:     '#9FB1AE', // secondary text (dark)
          night:    '#1C2A28', // soft surface (dark)
          rule:     '#2A3836', // borders (dark)
          glow:     '#3FC1B0', // teal on dark
        },
      },
      fontFamily: {
        // Brian's system stack; no web fonts to load.
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        serif: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      borderRadius: { hub: '10px' },
    },
  },
  plugins: [],
};
export default config;
