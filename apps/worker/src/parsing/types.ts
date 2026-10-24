export type SupportedLanguage = 'javascript' | 'typescript' | 'tsx' | 'python';

export interface SourcePosition {
  row: number;

  column: number;
}

export interface SourceRange {
  start: SourcePosition;

  end: SourcePosition;
}

export interface ParsedImport {
  source: string;

  range: SourceRange;
}

export interface ParsedFunction {
  name: string | null;

  range: SourceRange;

  async: boolean;

  /**
   * Whether this symbol is explicitly exported from
   * the JavaScript/TypeScript module.
   *
   * Python functions currently report false because
   * Python does not use an equivalent export keyword.
   */
  isExported: boolean;
}

export interface ParsedClass {
  name: string | null;

  range: SourceRange;

  /**
   * Whether this symbol is explicitly exported from
   * the JavaScript/TypeScript module.
   *
   * Python classes currently report false because
   * Python does not use an equivalent export keyword.
   */
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

  hasSyntaxErrors: boolean;
}
