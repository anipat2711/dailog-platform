/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#7c3aed',
        secondary: '#06b6d4',
        success: '#10b981',
        dark: {
          bg: '#0a0a0f',
          card: '#12121a',
          border: '#1e1e2e',
        },
        text: {
          primary: '#f8fafc',
          secondary: '#94a3b8',
        },
      },
    },
  },
  plugins: [],
};
