import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', 'probes/results'] },
  ...tseslint.configs.recommended,
  {
    // The layering rule. core/ is pure TypeScript: no React, no DOM, no storage,
    // and no ambient clock — time arrives through the injected now().
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['react', 'react-*', '**/storage/*', '**/app/*'], message: 'core/ must stay pure — no React, no storage, no app.' },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'core/ must not touch the DOM.' },
        { name: 'document', message: 'core/ must not touch the DOM.' },
        { name: 'indexedDB', message: 'core/ must not touch storage.' },
        { name: 'localStorage', message: 'core/ must not touch storage.' },
        { name: 'navigator', message: 'core/ must not touch the DOM.' },
      ],
      'no-restricted-syntax': ['error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'core/ takes time through the injected now() — see spec §5.1.' },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'core/ takes time through the injected now() — see spec §5.1.' },
      ],
    },
  },
  {
    // Tests construct fixed dates deliberately and assert against a frozen clock.
    files: ['src/**/__tests__/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': 'off', 'no-restricted-globals': 'off' },
  },
)
