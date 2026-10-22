import { posix } from 'node:path';

function normalizeRepositoryPath(filePath: string): string {
  /*
   * Repository paths should behave like Git paths:
   *
   * src/app.ts
   * src/services/user.ts
   *
   * Always normalize Windows-style separators too,
   * even though our worker runs inside Linux/WSL.
   */
  const withForwardSlashes = filePath.replaceAll('\\', '/');

  /*
   * Reject absolute paths.
   *
   * Examples:
   *
   * /etc/passwd
   * C:/Users/file.ts
   */
  if (withForwardSlashes.startsWith('/') || /^[A-Za-z]:\//.test(withForwardSlashes)) {
    throw new Error(`Repository file path must be relative: ${filePath}`);
  }

  if (withForwardSlashes.includes('\0')) {
    throw new Error('Repository file path contains a null byte.');
  }

  const normalized = posix.normalize(withForwardSlashes);

  /*
   * Remove harmless leading "./".
   *
   * ./src/app.ts
   *
   * becomes:
   *
   * src/app.ts
   */
  const withoutDotPrefix = normalized.startsWith('./') ? normalized.slice(2) : normalized;

  /*
   * Never allow a repository path to escape
   * above the repository root.
   */
  if (withoutDotPrefix === '..' || withoutDotPrefix.startsWith('../')) {
    throw new Error(`Repository file path escapes root: ${filePath}`);
  }

  if (withoutDotPrefix === '.' || withoutDotPrefix.length === 0) {
    throw new Error('Repository file path cannot be empty.');
  }

  return withoutDotPrefix;
}

export class RepositoryFileIndex {
  private readonly files = new Set<string>();

  public constructor(filePaths: readonly string[]) {
    for (const filePath of filePaths) {
      this.files.add(normalizeRepositoryPath(filePath));
    }
  }

  public get size(): number {
    return this.files.size;
  }

  public has(filePath: string): boolean {
    return this.files.has(normalizeRepositoryPath(filePath));
  }

  public findFirst(candidates: readonly string[]): string | null {
    for (const candidate of candidates) {
      const normalized = normalizeRepositoryPath(candidate);

      if (this.files.has(normalized)) {
        return normalized;
      }
    }

    return null;
  }

  public toArray(): string[] {
    return [...this.files].sort();
  }
}

export { normalizeRepositoryPath };
