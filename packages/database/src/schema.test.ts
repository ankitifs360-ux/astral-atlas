import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  analyses,
  edges,
  files,
  issueFileMatches,
  issues,
  metrics,
  repositories,
  symbols,
} from './schema.js';

describe('database schema', () => {
  it('defines the expected Astral Atlas tables', () => {
    const tableNames = [
      repositories,
      analyses,
      files,
      symbols,
      metrics,
      edges,
      issues,
      issueFileMatches,
    ].map((table) => getTableName(table));

    expect(tableNames).toEqual([
      'repositories',
      'analyses',
      'files',
      'symbols',
      'metrics',
      'edges',
      'issues',
      'issue_file_matches',
    ]);
  });
});
