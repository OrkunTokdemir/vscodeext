/* eslint-env node */
module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
  ],
  plugins: ['@typescript-eslint'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: true,
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  root: true,
  ignorePatterns: ['out'],
};
