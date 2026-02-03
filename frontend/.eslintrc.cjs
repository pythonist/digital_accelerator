module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  ignorePatterns: ['dist/**', 'node_modules/**'],
  settings: {
    react: { version: 'detect' },
  },
  plugins: ['react', 'react-hooks', 'react-refresh'],
  extends: [],
  rules: {},
};

