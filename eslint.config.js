import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The shared package must stay deterministic and environment-free (GAME.md 3.2).
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Pass an RNG in (shared/rng).' },
        { object: 'Date', property: 'now', message: 'Pass time in.' },
        { object: 'performance', property: 'now', message: 'Pass time in.' },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'process', 'require', 'Buffer', 'navigator'],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly' } },
  },
);
