import type Parser from 'tree-sitter';

import type { ParsedCall, SourceRange, SupportedLanguage } from './types.js';

function createRange(node: Parser.SyntaxNode): SourceRange {
  return {
    start: {
      row: node.startPosition.row,

      column: node.startPosition.column,
    },

    end: {
      row: node.endPosition.row,

      column: node.endPosition.column,
    },
  };
}

function getNodeText(node: Parser.SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function isJavaScriptLikeLanguage(language: SupportedLanguage): boolean {
  return language === 'javascript' || language === 'typescript' || language === 'tsx';
}

function extractJavaScriptLikeCall(
  node: Parser.SyntaxNode,

  source: string,
): ParsedCall | null {
  if (node.type !== 'call_expression') {
    return null;
  }

  const functionNode = node.childForFieldName('function');

  if (!functionNode) {
    return null;
  }

  const callee = getNodeText(functionNode, source).trim();

  if (callee.length === 0) {
    return null;
  }

  /*
   * `require()` and dynamic `import()` are already handled
   * by the import/dependency extractor.
   *
   * Treating them as normal function calls would add noise
   * to the future function-level call graph.
   */
  if (callee === 'require' || callee === 'import') {
    return null;
  }

  /*
   * Keep calls whose target can later be reasonably resolved
   * to a symbol.
   *
   * Examples:
   *
   *   saveUser()
   *   userService.save()
   *   this.validate()
   *   console.log()
   *   super()
   *
   * We intentionally ignore highly dynamic callees such as:
   *
   *   (factory())()
   *   (() => doWork())()
   *
   * because they cannot be reliably connected to one symbol
   * during static call resolution.
   */
  if (
    functionNode.type !== 'identifier' &&
    functionNode.type !== 'member_expression' &&
    functionNode.type !== 'super'
  ) {
    return null;
  }

  return {
    callee,

    range: createRange(node),
  };
}

function extractPythonCall(
  node: Parser.SyntaxNode,

  source: string,
): ParsedCall | null {
  if (node.type !== 'call') {
    return null;
  }

  const functionNode = node.childForFieldName('function');

  if (!functionNode) {
    return null;
  }

  /*
   * Python examples:
   *
   *   save_user()
   *   service.save()
   *   self.validate()
   *
   * As with JavaScript/TypeScript, complex dynamic call
   * targets are intentionally skipped until we have enough
   * information to resolve them safely.
   */
  if (functionNode.type !== 'identifier' && functionNode.type !== 'attribute') {
    return null;
  }

  const callee = getNodeText(functionNode, source).trim();

  if (callee.length === 0) {
    return null;
  }

  return {
    callee,

    range: createRange(node),
  };
}

export function extractCalls(
  root: Parser.SyntaxNode,

  source: string,

  language: SupportedLanguage,
): ParsedCall[] {
  const calls: ParsedCall[] = [];

  function visit(node: Parser.SyntaxNode): void {
    const call = isJavaScriptLikeLanguage(language)
      ? extractJavaScriptLikeCall(node, source)
      : extractPythonCall(node, source);

    if (call) {
      calls.push(call);
    }

    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(root);

  return calls;
}
