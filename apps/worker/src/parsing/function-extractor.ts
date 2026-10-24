import type Parser from 'tree-sitter';

import type { ParsedFunction, SourceRange, SupportedLanguage } from './types.js';

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

function hasAsyncKeyword(node: Parser.SyntaxNode): boolean {
  return node.children.some((child) => child.type === 'async');
}

function inferAssignedName(node: Parser.SyntaxNode, source: string): string | null {
  const parent = node.parent;

  if (!parent) {
    return null;
  }

  /*
   * const handler = () => {};
   * const handler = function () {};
   */
  if (parent.type === 'variable_declarator') {
    const nameNode = parent.childForFieldName('name');

    return nameNode ? getNodeText(nameNode, source) : null;
  }

  /*
   * handler = () => {};
   */
  if (parent.type === 'assignment_expression') {
    const leftNode = parent.childForFieldName('left');

    /*
     * Only infer a simple identifier.
     *
     * We intentionally avoid turning:
     *
     * object.handler = () => {}
     *
     * into a misleading plain function name.
     */
    if (leftNode?.type === 'identifier') {
      return getNodeText(leftNode, source);
    }

    return null;
  }

  /*
   * const handlers = {
   *   load: () => {}
   * };
   */
  if (parent.type === 'pair') {
    const keyNode = parent.childForFieldName('key');

    if (!keyNode) {
      return null;
    }

    const keyText = getNodeText(keyNode, source);

    if (keyNode.type === 'string') {
      return keyText.slice(1, -1);
    }

    if (keyNode.type === 'property_identifier' || keyNode.type === 'identifier') {
      return keyText;
    }

    return null;
  }

  /*
   * class Service {
   *   handler = () => {};
   * }
   *
   * Grammar naming can vary slightly between
   * JavaScript and TypeScript versions, so we
   * support both common field node names.
   */
  if (parent.type === 'public_field_definition' || parent.type === 'field_definition') {
    const nameNode = parent.childForFieldName('name') ?? parent.childForFieldName('property');

    return nameNode ? getNodeText(nameNode, source) : null;
  }

  return null;
}

function getFunctionName(node: Parser.SyntaxNode, source: string): string | null {
  const nameNode = node.childForFieldName('name');

  if (nameNode) {
    return getNodeText(nameNode, source);
  }

  return inferAssignedName(node, source);
}

function isJavaScriptLikeFunction(node: Parser.SyntaxNode): boolean {
  return (
    node.type === 'function_declaration' ||
    node.type === 'generator_function_declaration' ||
    node.type === 'function_expression' ||
    node.type === 'generator_function' ||
    node.type === 'arrow_function' ||
    node.type === 'method_definition'
  );
}

function isPythonFunction(node: Parser.SyntaxNode): boolean {
  return node.type === 'function_definition' || node.type === 'lambda';
}

function unwrapExpressionParent(node: Parser.SyntaxNode): Parser.SyntaxNode {
  let current = node;

  while (
    current.parent?.type === 'parenthesized_expression' ||
    current.parent?.type === 'as_expression' ||
    current.parent?.type === 'satisfies_expression' ||
    current.parent?.type === 'type_assertion'
  ) {
    current = current.parent;
  }

  return current;
}

/**
 * Detects exports that directly declare the function.
 *
 * Supported examples:
 *
 * export function run() {}
 * export default function run() {}
 * export const run = () => {}
 * export const run = function () {}
 *
 * We intentionally do not walk arbitrary ancestors.
 * Doing so could incorrectly mark a nested callback or
 * class method as exported merely because its containing
 * object/class/function is exported.
 */
function isExplicitlyExportedFunction(
  node: Parser.SyntaxNode,
  language: SupportedLanguage,
): boolean {
  if (language === 'python') {
    return false;
  }

  const expressionNode = unwrapExpressionParent(node);
  const parent = expressionNode.parent;

  if (!parent) {
    return false;
  }

  /*
   * export function run() {}
   * export default function run() {}
   * export default (() => {})
   */
  if (parent.type === 'export_statement') {
    return true;
  }

  /*
   * export const run = () => {};
   * export const run = function () {};
   */
  if (parent.type === 'variable_declarator') {
    const declaration = parent.parent;

    if (
      declaration?.type !== 'lexical_declaration' &&
      declaration?.type !== 'variable_declaration'
    ) {
      return false;
    }

    return declaration.parent?.type === 'export_statement';
  }

  return false;
}

export function extractFunctions(
  root: Parser.SyntaxNode,
  source: string,
  language: SupportedLanguage,
): ParsedFunction[] {
  const functions: ParsedFunction[] = [];

  function visit(node: Parser.SyntaxNode): void {
    const isFunction =
      language === 'python' ? isPythonFunction(node) : isJavaScriptLikeFunction(node);

    if (isFunction) {
      functions.push({
        name: getFunctionName(node, source),

        range: createRange(node),

        async: hasAsyncKeyword(node),

        isExported: isExplicitlyExportedFunction(node, language),
      });
    }

    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(root);

  return functions;
}
