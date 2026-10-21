import { access, writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { createTempWorkspace, withTempWorkspace } from './temp-workspace.js';

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('temporary ingestion workspace', () => {
  it('creates an isolated temporary repository directory', async () => {
    const workspace = await createTempWorkspace();

    try {
      expect(await pathExists(workspace.rootDir)).toBe(true);

      expect(await pathExists(workspace.repositoryDir)).toBe(true);

      expect(workspace.repositoryDir).toContain(workspace.rootDir);
    } finally {
      await workspace.cleanup();
    }

    expect(await pathExists(workspace.rootDir)).toBe(false);
  });

  it('allows cleanup to be called more than once', async () => {
    const workspace = await createTempWorkspace();

    await workspace.cleanup();

    await expect(workspace.cleanup()).resolves.toBeUndefined();

    expect(await pathExists(workspace.rootDir)).toBe(false);
  });

  it('cleans up after a successful operation', async () => {
    let workspaceRoot = '';

    const result = await withTempWorkspace(async (workspace) => {
      workspaceRoot = workspace.rootDir;

      const markerFile = `${workspace.repositoryDir}/marker.txt`;

      await writeFile(markerFile, 'temporary repository data', 'utf8');

      expect(await pathExists(markerFile)).toBe(true);

      return 'completed';
    });

    expect(result).toBe('completed');

    expect(await pathExists(workspaceRoot)).toBe(false);
  });

  it('cleans up even when the operation fails', async () => {
    let workspaceRoot = '';

    await expect(
      withTempWorkspace(async (workspace) => {
        workspaceRoot = workspace.rootDir;

        throw new Error('Simulated ingestion failure');
      }),
    ).rejects.toThrow('Simulated ingestion failure');

    expect(await pathExists(workspaceRoot)).toBe(false);
  });
});
