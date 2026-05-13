module.exports = {
  root: true,
  extends: ['@react-native'],
  parser: '@typescript-eslint/parser',
  parserOptions: { sourceType: 'module', ecmaVersion: 2020 },
  ignorePatterns: ['lib/', 'node_modules/', 'example/'],
  rules: {
    'prettier/prettier': 'off',
    'react-native/no-inline-styles': 'off',
  },
};
