/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#00529B',
          light: '#2F80ED',
          gold: '#F4B400',
        },
        surface: '#F8FAFC',
      },
    },
  },
  plugins: [],
};
