import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTempWorkspace } from './temp-workspace.js';
import { scanRepositorySourceFiles } from './source-files.js';

describe('scanRepositorySourceFiles', () => {
  it('finds supported JavaScript, TypeScript, and Python files', async () => {
    await withTempWorkspace(async (workspace) => {
      const srcDir = join(workspace.repositoryDir, 'src');

      await mkdir(srcDir, {
        recursive: true,
      });

      await writeFile(join(srcDir, 'app.ts'), 'export const app = true;', 'utf8');

      await writeFile(join(srcDir, 'helper.js'), 'export function helper() {}', 'utf8');

      await writeFile(join(srcDir, 'parser.py'), 'def parse():\n    pass\n', 'utf8');

      const result = await scanRepositorySourceFiles(workspace.repositoryDir);

      expect(
        result.sourceFiles.map((file) => ({
          path: file.relativePath,
          language: file.language,
        })),
      ).toEqual([
        {
          path: 'src/app.ts',
          language: 'typescript',
        },
        {
          path: 'src/helper.js',
          language: 'javascript',
        },
        {
          path: 'src/parser.py',
          language: 'python',
        },
      ]);
    });
  });

  it('ignores unsupported files', async () => {
    await withTempWorkspace(async (workspace) => {
      await writeFile(join(workspace.repositoryDir, 'README.md'), '# Test', 'utf8');

      await writeFile(join(workspace.repositoryDir, 'package.json'), '{}', 'utf8');

      const result = await scanRepositorySourceFiles(workspace.repositoryDir);

      expect(result.sourceFiles).toHaveLength(0);
      expect(result.skipped.unsupported).toBe(2);
      expect(result.totalFileCount).toBe(2);
    });
  });

  it('ignores generated minified JavaScript files', async () => {
    await withTempWorkspace(async (workspace) => {
      await writeFile(join(workspace.repositoryDir, 'app.min.js'), 'var a=1;', 'utf8');

      await writeFile(join(workspace.repositoryDir, 'normal.js'), 'const value = 1;', 'utf8');

      const result = await scanRepositorySourceFiles(workspace.repositoryDir);

      expect(result.sourceFiles.map((file) => file.relativePath)).toEqual(['normal.js']);

      expect(result.skipped.unsupported).toBe(1);
    });
  });

  it('ignores known generated and dependency directories', async () => {
    await withTempWorkspace(async (workspace) => {
      const nodeModulesDir = join(workspace.repositoryDir, 'node_modules');

      const distDir = join(workspace.repositoryDir, 'dist');

      await mkdir(nodeModulesDir, {
        recursive: true,
      });

      await mkdir(distDir, {
        recursive: true,
      });

      await writeFile(join(nodeModulesDir, 'dependency.js'), 'const dependency = true;', 'utf8');

      await writeFile(join(distDir, 'bundle.js'), 'const bundle = true;', 'utf8');

      await writeFile(
        join(workspace.repositoryDir, 'index.ts'),
        'export const index = true;',
        'utf8',
      );

      const result = await scanRepositorySourceFiles(workspace.repositoryDir);

      expect(result.sourceFiles.map((file) => file.relativePath)).toEqual(['index.ts']);

      expect(result.skipped.ignoredDirectory).toBe(2);
    });
  });

  it('does not follow symbolic links', async () => {
    await withTempWorkspace(async (workspace) => {
      const outsideDirectory = join(workspace.rootDir, 'outside');

      await mkdir(outsideDirectory, {
        recursive: true,
      });

      await writeFile(join(outsideDirectory, 'secret.ts'), 'export const secret = true;', 'utf8');

      await symlink(outsideDirectory, join(workspace.repositoryDir, 'linked-outside'));

      const result = await scanRepositorySourceFiles(workspace.repositoryDir);

      expect(result.sourceFiles).toHaveLength(0);

      expect(result.skipped.symbolicLink).toBe(1);
    });
  });

  it('returns source files in deterministic path order', async () => {
    await withTempWorkspace(async (workspace) => {
      await writeFile(join(workspace.repositoryDir, 'z.ts'), 'export const z = true;', 'utf8');

      await writeFile(join(workspace.repositoryDir, 'a.ts'), 'export const a = true;', 'utf8');

      await writeFile(join(workspace.repositoryDir, 'm.py'), 'value = 1\n', 'utf8');

      const result = await scanRepositorySourceFiles(workspace.repositoryDir);

      expect(result.sourceFiles.map((file) => file.relativePath)).toEqual(['a.ts', 'm.py', 'z.ts']);
    });
  });
});
