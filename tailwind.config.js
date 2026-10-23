/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // the guide's drawer (ui/Guide): in decelerating, out accelerating
      keyframes: {
        'guide-in': { from: { transform: 'translateX(100%)', opacity: '0' } },
        'guide-out': { to: { transform: 'translateX(100%)', opacity: '0' } },
      },
      animation: {
        'guide-in': 'guide-in 250ms ease-out',
        'guide-out': 'guide-out 250ms ease-in forwards',
      },
    },
  },
  plugins: [],
}
