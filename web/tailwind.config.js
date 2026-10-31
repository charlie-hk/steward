/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 900: '#0a0e14', 800: '#0d1117', 700: '#11161d', 600: '#161c24' },
        edge: '#2d3744',
        good: '#3fb950',
        warn: '#d29922',
        bad: '#f85149',
        info: '#1f6feb',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
