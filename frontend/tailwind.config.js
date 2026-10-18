/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Paleta "Pharmacy Fresh" — 5 colores base dados:
        //   #F9FFFB #DFF7E8 #9BE7B1 #2CB67D #1F3D2C
        // Los tonos intermedios (300/500/600/800/900) son interpolaciones
        // coherentes para poder usar la escala completa de Tailwind sin
        // introducir colores fuera de la paleta.
        pharma: {
          50:  '#F9FFFB',  // fondo
          100: '#DFF7E8',  // superficie
          200: '#9BE7B1',  // border / divider
          300: '#73DBA1',  // interpolado
          400: '#2CB67D',  // primary
          500: '#25A06B',  // hover del primary
          600: '#1E8A5C',  // interpolado
          700: '#1F3D2C',  // sidebar / texto principal
          800: '#182E22',  // interpolado
          900: '#112218',  // borde del sidebar
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