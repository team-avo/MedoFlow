import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: '#1E3A5F',
          foreground: '#FFFFFF',
          50: '#f0f3f8',
          100: '#dde5f0',
          200: '#bed0e4',
          300: '#90b2d3',
          400: '#5c8cbe',
          500: '#3c6ea7',
          600: '#2b568a',
          700: '#234571',
          800: '#1E3A5F',
          900: '#1c3251',
          950: '#122238',
        },
        accent: {
          DEFAULT: '#0D9488',
          foreground: '#FFFFFF',
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0D9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
          950: '#042f2e',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        danger: 'hsl(var(--destructive))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        subtle: 'hsl(var(--subtle))',
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        // MedoFlow semantic tokens — used by landing design system
        navy: {
          DEFAULT: '#1E3A5F',
          soft: 'rgba(255, 255, 255, 0.72)',
        },
        ink: {
          DEFAULT: '#111827',
          muted: '#6B7280',
          faint: '#9CA3AF',
        },
        hairline: '#E5E7EB',
        teal: {
          DEFAULT: '#0D9488',
          hover: '#0F766E',
          wash: '#F0FDFA',
          bright: '#5EEAD4',
        },
        canvas: '#FAFAFA',
      },
      borderRadius: {
        lg: '0.75rem',
        md: 'calc(0.75rem - 2px)',
        sm: 'calc(0.75rem - 4px)',
      },
      boxShadow: {
        card: '0 8px 30px rgb(0 0 0 / 0.04)',
        'card-hover': '0 16px 40px rgb(0 0 0 / 0.08)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.08)',
        glow: '0 0 40px -10px rgba(13, 148, 136, 0.3)',
        'glow-lg': '0 0 60px -15px rgba(28, 139, 129, 0.4)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-dm-sans)', 'DM Sans', 'system-ui', 'sans-serif'],
      },
      transitionTimingFunction: {
        medoflow: 'cubic-bezier(0.4, 0, 0.6, 1)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
