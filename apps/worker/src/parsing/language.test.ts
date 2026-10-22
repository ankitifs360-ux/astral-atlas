import { describe, expect, it } from 'vitest';

import { detectLanguage } from './language.js';

describe('detectLanguage', () => {
  it.each([
    ['src/index.js', 'javascript'],

    ['src/component.jsx', 'javascript'],

    ['src/server.mjs', 'javascript'],

    ['src/config.cjs', 'javascript'],

    ['src/index.ts', 'typescript'],

    ['src/module.mts', 'typescript'],

    ['src/module.cts', 'typescript'],

    ['src/App.tsx', 'tsx'],

    ['scripts/main.py', 'python'],
  ])('detects %s as %s', (filePath, expectedLanguage) => {
    expect(detectLanguage(filePath)).toBe(expectedLanguage);
  });

  it('handles uppercase extensions', () => {
    expect(detectLanguage('src/App.TSX')).toBe('tsx');

    expect(detectLanguage('scripts/main.PY')).toBe('python');
  });

  it.each([
    'README.md',
    'styles/main.css',
    'public/logo.png',
    'package.json',
    'src/component.vue',
    'src/component.svelte',
    'Dockerfile',
  ])('returns null for unsupported file %s', (filePath) => {
    expect(detectLanguage(filePath)).toBeNull();
  });

  it('returns null when the file has no extension', () => {
    expect(detectLanguage('src/Makefile')).toBeNull();
  });
});
