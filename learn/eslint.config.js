import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'scripts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly', fetch: 'readonly', EventSource: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', performance: 'readonly', atob: 'readonly', navigator: 'readonly', console: 'readonly', requestAnimationFrame: 'readonly', HTMLCanvasElement: 'readonly', CanvasRenderingContext2D: 'readonly', MouseEvent: 'readonly', PointerEvent: 'readonly', Response: 'readonly', Headers: 'readonly', RequestInit: 'readonly', AbortController: 'readonly' } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
