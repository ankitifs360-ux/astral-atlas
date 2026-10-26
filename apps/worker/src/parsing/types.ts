export type SupportedLanguage = 'javascript' | 'typescript' | 'tsx' | 'python';

export interface SourcePosition {
  row: number;
  column: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export type ParsedImportBindingKind = 'default' | 'named' | 'namespace';

export interface ParsedImportBinding {
  /*
   * How the symbol entered the current file.
   *
   * Examples:
   *
   * import UserService from './user-service.js';
   *        ^ default
   *
   * import { saveUser } from './users.js';
   *          ^ named
   *
   * import * as users from './users.js';
   *        ^ namespace
   */
  kind: ParsedImportBindingKind;

  /*
   * Name exported by the target module.
   *
   * Examples:
   *
   * import { saveUser } ...
   *          => "saveUser"
   *
   * import { saveUser as persistUser } ...
   *          => "saveUser"
   *
   * null for default and namespace imports because
   * they do not identify one named exported symbol.
   */
  importedName: string | null;

  /*
   * Name visible inside the importing file.
   *
   * Examples:
   *
   * import { saveUser } ...
   *          => "saveUser"
   *
   * import { saveUser as persistUser } ...
   *                      => "persistUser"
   *
   * import UserService ...
   *        => "UserService"
   *
   * import * as users ...
   *             => "users"
   */
  localName: string;
}

export interface ParsedImport {
  source: string;

  range: SourceRange;

  /*
   * Optional for backward compatibility with existing
   * parser fixtures and dependency-only consumers.
   *
   * The import extractor will populate this for import
   * forms whose bindings can be determined statically.
   */
  bindings?: ParsedImportBinding[];
}

export interface ParsedCall {
  callee: string;
  range: SourceRange;
}

export interface OwnedParsedCall {
  call: ParsedCall;
  owner: ParsedFunction | null;
}

export interface ParsedFunction {
  name: string | null;
  range: SourceRange;
  async: boolean;
  isExported: boolean;
}

export interface ParsedClass {
  name: string | null;
  range: SourceRange;
  isExported: boolean;
}

export interface ParseSourceRequest {
  filePath: string;
  language: SupportedLanguage;
  source: string;
}

export interface ParseSourceResult {
  filePath: string;
  language: SupportedLanguage;
  imports: ParsedImport[];
  functions: ParsedFunction[];
  classes: ParsedClass[];
  calls: ParsedCall[];
  hasSyntaxErrors: boolean;
}
