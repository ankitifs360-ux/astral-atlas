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
      });
    }

    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(root);

  return classes;
}
