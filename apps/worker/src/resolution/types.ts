import type { ParsedFunction, SourceRange, SupportedLanguage } from '../parsing/types.js';

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

/*
 * ---------------------------------------------------------------------------
 * Function-call resolution
 * ---------------------------------------------------------------------------
 */

export type CallResolutionKind = 'internal' | 'unresolved';

export type CallResolutionReason = 'target-not-found' | 'ambiguous-target' | 'unsupported-callee';

/**
 * A raw function call together with its known caller.
 *
 * B15.1 already determines which function owns the call.
 * B15.2 now tries to determine which repository function
 * the raw callee refers to.
 */
export interface CallResolutionRequest {
  sourceFilePath: string;

  sourceLanguage: SupportedLanguage;

  sourceFunction: ParsedFunction;

  /*
   * Raw source-level call name.
   *
   * Examples:
   *
   * saveUser
   * userService.save
   */
  callee: string;

  range: SourceRange;
}

export interface ResolvedCall {
  sourceFilePath: string;

  sourceLanguage: SupportedLanguage;

  sourceFunction: ParsedFunction;

  callee: string;

  range: SourceRange;

  kind: CallResolutionKind;

  /*
   * Populated only when B15.2 can prove which
   * repository function is being called.
   */
  targetFilePath: string | null;

  targetFunction: ParsedFunction | null;

  reason: CallResolutionReason | null;
}
