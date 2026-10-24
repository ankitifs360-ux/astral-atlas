import type Parser from 'tree-sitter';

import type { ParsedClass, SourceRange, SupportedLanguage } from './types.js';

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

function inferAssignedName(node: Parser.SyntaxNode, source: string): string | null {
  const parent = node.parent;

  if (!parent) {
    return null;
  }

  /*
   * const UserService =
   *   class {};
   */
  if (parent.type === 'variable_declarator') {
    const nameNode = parent.childForFieldName('name');

    if (nameNode?.type === 'identifier') {
      return getNodeText(nameNode, source);
    }

    return null;
  }

  /*
   * UserService =
   *   class {};
   */
  if (parent.type === 'assignment_expression') {
    const leftNode = parent.childForFieldName('left');

    if (leftNode?.type === 'identifier') {
      return getNodeText(leftNode, source);
    }

    return null;
  }

  /*
   * const services = {
   *   UserService: class {}
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

  return null;
}

function getClassName(node: Parser.SyntaxNode, source: string): string | null {
  const nameNode = node.childForFieldName('name');

  if (nameNode) {
    return getNodeText(nameNode, source);
  }

  return inferAssignedName(node, source);
}

function isJavaScriptLikeClass(node: Parser.SyntaxNode): boolean {
  return (
    node.type === 'class_declaration' ||
    node.type === 'class' ||
    node.type === 'abstract_class_declaration'
  );
}

function isPythonClass(node: Parser.SyntaxNode): boolean {
  return node.type === 'class_definition';
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
 * Detects exports that directly declare the class.
 *
 * Supported examples:
 *
 * export class Service {}
 * export default class Service {}
 * export const Service = class {}
 *
 * We intentionally avoid walking arbitrary ancestors
 * because a nested class inside an exported function or
 * object should not automatically count as exported.
 */
function isExplicitlyExportedClass(node: Parser.SyntaxNode, language: SupportedLanguage): boolean {
  if (language === 'python') {
    return false;
  }

  const expressionNode = unwrapExpressionParent(node);
  const parent = expressionNode.parent;

  if (!parent) {
    return false;
  }

  /*
   * export class Service {}
   * export default class Service {}
   */
  if (parent.type === 'export_statement') {
    return true;
  }

  /*
   * export const Service = class {};
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

export function extractClasses(
  root: Parser.SyntaxNode,
  source: string,
  language: SupportedLanguage,
): ParsedClass[] {
  const classes: ParsedClass[] = [];

  function visit(node: Parser.SyntaxNode): void {
    const isClass = language === 'python' ? isPythonClass(node) : isJavaScriptLikeClass(node);

    if (isClass) {
      classes.push({
        name: getClassName(node, source),

        range: createRange(node),

        isExported: isExplicitlyExportedClass(node, language),
      });
    }

    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(root);

  return classes;
}
