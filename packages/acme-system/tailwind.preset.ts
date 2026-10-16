/**
 * Compatibility entry point for projects still using tailwind.config.ts.
 * New Tailwind v4 projects should import theme.css instead.
 */
export default {
  theme: {
    extend: {
      colors: { ink: '#111827', canvas: '#F8FAFC', brand: '#4F46E5', accent: '#F97316', muted: '#64748B' },
      fontFamily: { display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], body: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      borderRadius: { card: '24px' },
    },
  },
}
