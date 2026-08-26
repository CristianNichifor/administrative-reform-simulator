import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The model is a hot path over typed arrays; non-null assertions on indices that
      // have already been bounds-checked are deliberate, not sloppy.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  { ignores: ['dist', 'node_modules'] },
);
