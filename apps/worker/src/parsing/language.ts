import { extname } from 'node:path';

import type { SupportedLanguage } from './types.js';

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, SupportedLanguage>> = {
  '.js': 'javascript',

  '.jsx': 'javascript',

  '.mjs': 'javascript',

  '.cjs': 'javascript',

  '.ts': 'typescript',

  '.mts': 'typescript',

  '.cts': 'typescript',

  '.tsx': 'tsx',

  '.py': 'python',
};

export function detectLanguage(filePath: string): SupportedLanguage | null {
  const extension = extname(filePath).toLowerCase();

  return LANGUAGE_BY_EXTENSION[extension] ?? null;
}
