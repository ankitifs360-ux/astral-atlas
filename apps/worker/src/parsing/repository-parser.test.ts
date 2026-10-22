import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseRepositoryFiles } from './repository-parser.js';

import type { ParserThreadPool } from './parser-thread-pool.js';

import type { ParseSourceRequest, ParseSourceResult } from './types.js';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'astral-atlas-parser-'));

  temporaryDirectories.push(directory);

  return directory;
}

function createParseResult(request: ParseSourceRequest): ParseSourceResult {
  return {
    filePath: request.filePath,

    language: request.language,

    imports: [],

    functions: [],

    classes: [],

    hasSyntaxErrors: false,
  };
}

function createFakePool(size = 2) {
  const parseMany = vi.fn(async (requests: readonly ParseSourceRequest[]) =>
    requests.map(createParseResult),
  );

  const pool = {
    size,

    parseMany,
  } as unknown as ParserThreadPool;

  return {
    pool,
    parseMany,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.map(async (directory) => {
      await rm(directory, {
        recursive: true,

        force: true,
      });
    }),
  );

  temporaryDirectories.length = 0;
});

describe('parseRepositoryFiles', () => {
  it('parses supported files in deterministic path order', async () => {
    const root = await createTemporaryDirectory();

    await mkdir(join(root, 'src'), {
      recursive: true,
    });

    await writeFile(join(root, 'src', 'zeta.py'), 'def zeta():\n    return 1\n');

    await writeFile(join(root, 'src', 'alpha.ts'), 'export function alpha() {}\n');

    await writeFile(
      join(root, 'src', 'component.tsx'),
      'export function Component() { return null; }\n',
    );

    await writeFile(join(root, 'README.md'), '# Repository\n');

    const { pool, parseMany } = createFakePool();

    const result = await parseRepositoryFiles(pool, root, [
      {
        relativePath: 'src/zeta.py',
      },

      {
        relativePath: 'README.md',
      },

      {
        relativePath: 'src/component.tsx',
      },

      {
        relativePath: 'src/alpha.ts',
      },
    ]);

    expect(result.parsed.map((item) => item.filePath)).toEqual([
      'src/alpha.ts',
      'src/component.tsx',
      'src/zeta.py',
    ]);

    expect(result.parsed.map((item) => item.language)).toEqual(['typescript', 'tsx', 'python']);

    expect(result.skipped).toEqual([
      {
        filePath: 'README.md',

        reason: 'unsupported-language',
      },
    ]);

    expect(parseMany).toHaveBeenCalledTimes(1);

    const requests = parseMany.mock.calls[0]?.[0];

    expect(requests?.map((request) => request.filePath)).toEqual([
      'src/alpha.ts',
      'src/component.tsx',
      'src/zeta.py',
    ]);

    expect(requests?.[0]?.source).toContain('function alpha');
  });

  it('skips source files larger than the configured limit', async () => {
    const root = await createTemporaryDirectory();

    await writeFile(join(root, 'small.ts'), 'export const small = true;\n');

    await writeFile(join(root, 'large.ts'), 'x'.repeat(200));

    const { pool, parseMany } = createFakePool();

    const result = await parseRepositoryFiles(
      pool,
      root,
      [
        {
          relativePath: 'large.ts',
        },

        {
          relativePath: 'small.ts',
        },
      ],
      {
        maxSourceBytes: 100,
      },
    );

    expect(result.parsed.map((item) => item.filePath)).toEqual(['small.ts']);

    expect(result.skipped).toEqual([
      {
        filePath: 'large.ts',

        reason: 'too-large',
      },
    ]);

    expect(parseMany).toHaveBeenCalledTimes(1);

    const requests = parseMany.mock.calls[0]?.[0];

    expect(requests).toHaveLength(1);

    expect(requests?.[0]?.filePath).toBe('small.ts');
  });

  it('rejects path traversal outside the repository', async () => {
    const parent = await createTemporaryDirectory();

    const repositoryRoot = join(parent, 'repository');

    await mkdir(repositoryRoot, {
      recursive: true,
    });

    await writeFile(join(parent, 'outside.ts'), 'export const secret = true;\n');

    const { pool, parseMany } = createFakePool();

    await expect(
      parseRepositoryFiles(pool, repositoryRoot, [
        {
          relativePath: '../outside.ts',
        },
      ]),
    ).rejects.toThrow('Source file escapes repository root: ../outside.ts');

    expect(parseMany).not.toHaveBeenCalled();
  });

  it('rejects symlinks that resolve outside the repository', async () => {
    const parent = await createTemporaryDirectory();

    const repositoryRoot = join(parent, 'repository');

    await mkdir(repositoryRoot, {
      recursive: true,
    });

    const outsideFile = join(parent, 'outside.ts');

    await writeFile(outsideFile, 'export const secret = true;\n');

    await symlink(outsideFile, join(repositoryRoot, 'link.ts'));

    const { pool, parseMany } = createFakePool();

    await expect(
      parseRepositoryFiles(pool, repositoryRoot, [
        {
          relativePath: 'link.ts',
        },
      ]),
    ).rejects.toThrow('Source file resolves outside repository root: link.ts');

    expect(parseMany).not.toHaveBeenCalled();
  });

  it('uses bounded batches based on parser pool size', async () => {
    const root = await createTemporaryDirectory();

    for (let index = 1; index <= 5; index += 1) {
      await writeFile(join(root, `file-${index}.ts`), `export const value${index} = ${index};\n`);
    }

    /*
     * Pool size = 2
     *
     * Repository parser batch size:
     *
     * 2 × 2 = 4
     *
     * Therefore five files should produce:
     *
     * batch 1 → 4 files
     * batch 2 → 1 file
     */
    const { pool, parseMany } = createFakePool(2);

    const result = await parseRepositoryFiles(pool, root, [
      {
        relativePath: 'file-5.ts',
      },

      {
        relativePath: 'file-1.ts',
      },

      {
        relativePath: 'file-3.ts',
      },

      {
        relativePath: 'file-2.ts',
      },

      {
        relativePath: 'file-4.ts',
      },
    ]);

    expect(parseMany).toHaveBeenCalledTimes(2);

    expect(parseMany.mock.calls[0]?.[0]).toHaveLength(4);

    expect(parseMany.mock.calls[1]?.[0]).toHaveLength(1);

    expect(result.parsed.map((item) => item.filePath)).toEqual([
      'file-1.ts',
      'file-2.ts',
      'file-3.ts',
      'file-4.ts',
      'file-5.ts',
    ]);
  });

  it('rejects an invalid maximum source size', async () => {
    const root = await createTemporaryDirectory();

    const { pool } = createFakePool();

    await expect(
      parseRepositoryFiles(pool, root, [], {
        maxSourceBytes: 0,
      }),
    ).rejects.toThrow('Maximum parser source size must be a positive integer.');
  });
});
