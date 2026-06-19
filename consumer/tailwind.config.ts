import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          // Driven by CSS variables set at runtime from /api/config (same vars as admin)
          bg:     'rgb(var(--color-bg)     / <alpha-value>)',
          accent: 'rgb(var(--color-accent) / <alpha-value>)',
          text:   'rgb(var(--color-text)   / <alpha-value>)',
          // Fixed values not driven by DB
          card:   '#FFFFFF',
          danger: '#C0392B',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
