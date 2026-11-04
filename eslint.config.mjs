import globals from 'globals';

// Start with correctness rules that do not require reformatting or refactoring
// existing product code. This is not a formatting or HTML/CSS lint policy.
const correctness = {
  'constructor-super': 'error',
  'no-constant-binary-expression': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-this-before-super': 'error',
  'no-undef': 'error',
  'no-unexpected-multiline': 'error',
  'no-unreachable': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'valid-typeof': 'error',
};

export default [
  {ignores: ['node_modules/**']},
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {ecmaVersion: 2022},
    rules: correctness,
  },
  {
    files: ['*.mjs'],
    ignores: ['*.test.mjs', 'eslint.config.mjs', 'app.mjs', 'media.mjs', 'recording.mjs'],
    languageOptions: {globals: globals.worker},
  },
  {
    files: ['app.mjs', 'media.mjs', 'recording.mjs'],
    languageOptions: {globals: globals.browser},
  },
  {
    files: ['**/*.test.mjs', 'scripts/**', 'eslint.config.mjs'],
    languageOptions: {globals: globals.node},
  },
];
