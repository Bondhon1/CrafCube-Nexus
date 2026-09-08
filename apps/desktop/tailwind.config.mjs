/**
 * Palette sampled directly from the brand artwork in src/assets:
 * near-black teal ground (#000f16), mint accent (#0df8d0).
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#00080d',
          900: '#000f16',
          850: '#04141c',
          800: '#081d26',
          700: '#0d2a34',
          600: '#153845',
        },
        line: {
          DEFAULT: '#12303a',
          bright: '#1b4a56',
        },
        mint: {
          DEFAULT: '#0df8d0',
          500: '#11e0bb',
          600: '#0eb18d',
          700: '#0a7d64',
          glow: 'rgba(13, 248, 208, 0.14)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      letterSpacing: {
        brand: '0.28em',
      },
      backgroundImage: {
        'mint-sheen':
          'linear-gradient(135deg, rgba(13,248,208,0.16) 0%, rgba(13,248,208,0) 60%)',
      },
      boxShadow: {
        panel: '0 24px 60px -20px rgba(0, 0, 0, 0.8)',
        'mint-ring': '0 0 0 1px rgba(13,248,208,0.35), 0 0 32px -6px rgba(13,248,208,0.35)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
      },
    },
  },
  plugins: [],
};
