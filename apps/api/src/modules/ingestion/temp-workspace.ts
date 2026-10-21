import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TempWorkspace {
  rootDir: string;
  repositoryDir: string;
  cleanup: () => Promise<void>;
}

export async function createTempWorkspace(): Promise<TempWorkspace> {
  const rootDir = await mkdtemp(join(tmpdir(), 'astral-atlas-'));

  const repositoryDir = join(rootDir, 'repository');

  await mkdir(repositoryDir, {
    recursive: true,
  });

  let cleanedUp = false;

  return {
    rootDir,
    repositoryDir,

    async cleanup(): Promise<void> {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;

      await rm(rootDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    },
  };
}

export async function withTempWorkspace<T>(
  operation: (workspace: TempWorkspace) => Promise<T>,
): Promise<T> {
  const workspace = await createTempWorkspace();

  try {
    return await operation(workspace);
  } finally {
    await workspace.cleanup();
  }
}
