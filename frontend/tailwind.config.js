/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070C16',
          900: '#0B1220',
          800: '#111A2B',
          700: '#1B2740',
          600: '#26344F',
          500: '#3A4A69',
        },
        brand: {
          50: '#FFF4EF',
          100: '#FFE4D9',
          200: '#FFC5AE',
          300: '#FFA07C',
          400: '#F97D4F',
          500: '#E8582A',
          600: '#C7461D',
          700: '#9C3615',
        },
        paper: '#FAFAF8',
        hairline: '#E6E8EC',
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      letterSpacing: {
        tightest: '-0.035em',
      },
      boxShadow: {
        card: '0 1px 2px rgba(11, 18, 32, 0.05), 0 1px 3px rgba(11, 18, 32, 0.04)',
        lift: '0 10px 30px -12px rgba(11, 18, 32, 0.18)',
        panel: '0 24px 60px -30px rgba(11, 18, 32, 0.35)',
      },
      keyframes: {
        'fade-in-row': {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'fade-in-row': 'fade-in-row 220ms ease-out',
        'pulse-dot': 'pulseDot 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
