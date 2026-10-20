/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Paleta de marca — los valores vienen de CSS custom properties
        // (ver src/styles/globals.css). Cambiar de tema es cambiar el
        // atributo `data-theme` del <html>, sin recompilar.
        pharma: {
          50:  'var(--p-50)',
          100: 'var(--p-100)',
          200: 'var(--p-200)',
          300: 'var(--p-300)',
          400: 'var(--p-400)',
          500: 'var(--p-500)',
          600: 'var(--p-600)',
          700: 'var(--p-700)',
          800: 'var(--p-800)',
          900: 'var(--p-900)',
        },
      },
      fontFamily: {
        sans: [
          'Inter Variable',
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};