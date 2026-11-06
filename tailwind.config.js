/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        orange: {
          50: '#fdf4ff',  // Rose très très clair (fonds légers)
          100: '#fae8ff',
          200: '#f5d0fe',
          300: '#f0abfc',  // Rose bonbon
          400: '#e879f9',  // Transition Rose-Violet
          500: '#d946ef',  // Couleur principale (Rose/Fuchsia vibrant)
          600: '#c026d3',  // Violet lumineux (Boutons au survol)
          700: '#a21caf',
          800: '#86198f',  // Violet profond
          900: '#701a75',  // Violet très sombre (Textes foncés)
        },
      },
    },
  },
  plugins: [],
};
