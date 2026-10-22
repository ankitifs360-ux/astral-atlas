import type { SourceRange, SupportedLanguage } from '../parsing/types.js';

export type ImportResolutionKind = 'internal' | 'external' | 'unresolved';

export type ImportResolutionReason =
  'external-package' | 'target-not-found' | 'unsupported-specifier';

export interface ImportResolutionRequest {
  /*
   * Repository-relative path of the file
   * containing the import.
   *
   * Example:
   *
   * src/app.ts
   */
  sourceFilePath: string;

  sourceLanguage: SupportedLanguage;

  /*
   * Raw dependency string extracted by B5.
   *
   * Examples:
   *
   * ./user-service.js
   * react
   * services.user
   */
  specifier: string;

  range: SourceRange;
}

export interface ResolvedImport {
  sourceFilePath: string;

  sourceLanguage: SupportedLanguage;

  specifier: string;

  range: SourceRange;

  /*
   * internal
   *   → another file in this repository
   *
   * external
   *   → package/module outside this repository
   *
   * unresolved
   *   → probably internal, but no file matched
   */
  kind: ImportResolutionKind;

  /*
   * Repository-relative target file.
   *
   * Example:
   *
   * src/user-service.ts
   *
   * null for external/unresolved imports.
   */
  targetFilePath: string | null;

  reason: ImportResolutionReason | null;
}
