import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg:     'rgb(var(--color-bg) / <alpha-value>)',
          accent: 'rgb(var(--color-accent) / <alpha-value>)',
          text:   'rgb(var(--color-text) / <alpha-value>)',
          card:   '#FFFFFF',
          danger: '#C0392B',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
