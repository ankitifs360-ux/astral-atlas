import type Parser from 'tree-sitter';

import type { ParsedImport, SourceRange, SupportedLanguage } from './types.js';

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

function removeQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];

    const last = value[value.length - 1];

    if (
      (first === "'" && last === "'") ||
      (first === '"' && last === '"') ||
      (first === '`' && last === '`')
    ) {
      return value.slice(1, -1);
    }
  }

  return value;
}

function extractStaticString(
  node: Parser.SyntaxNode | null,

  source: string,
): string | null {
  if (!node) {
    return null;
  }

  if (node.type === 'string') {
    return removeQuotes(getNodeText(node, source));
  }

  /*
   * Static template literals are resolvable:
   *
   * import(`./user.js`)
   *
   * But expressions are not:
   *
   * import(`./${name}.js`)
   */
  if (node.type === 'template_string') {
    const text = getNodeText(node, source);

    if (text.includes('${')) {
      return null;
    }

    return removeQuotes(text);
  }

  return null;
}

function getCallArgument(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  const argumentsNode = node.childForFieldName('arguments');

  if (!argumentsNode) {
    return null;
  }

  /*
   * Normal calls:
   *
   * require('./user')
   *
   * argumentsNode = arguments
   */
  if (argumentsNode.type === 'arguments') {
    return argumentsNode.namedChildren[0] ?? null;
  }

  /*
   * Tree-sitter can expose a template string
   * directly as the arguments field for some
   * import-call forms.
   */
  return argumentsNode;
}

function extractJavaScriptLikeDependency(
  node: Parser.SyntaxNode,

  source: string,
): ParsedImport | null {
  /*
   * Standard ESM import:
   *
   * import express from 'express';
   * import './setup.js';
   */
  if (node.type === 'import_statement') {
    const sourceNode = node.childForFieldName('source');

    const importSource = extractStaticString(sourceNode, source);

    if (!importSource) {
      return null;
    }

    return {
      source: importSource,

      range: createRange(node),
    };
  }

  /*
   * Re-export:
   *
   * export {
   *   UserService
   * } from './user-service.js';
   *
   * export * from './types.js';
   *
   * These are dependency edges too.
   */
  if (node.type === 'export_statement') {
    const sourceNode = node.childForFieldName('source');

    const importSource = extractStaticString(sourceNode, source);

    if (!importSource) {
      return null;
    }

    return {
      source: importSource,

      range: createRange(node),
    };
  }

  if (node.type !== 'call_expression') {
    return null;
  }

  const functionNode = node.childForFieldName('function');

  if (!functionNode) {
    return null;
  }

  const functionText = getNodeText(functionNode, source);

  /*
   * CommonJS:
   *
   * const express =
   *   require('express');
   */
  const isRequire = functionText === 'require';

  /*
   * Dynamic ESM:
   *
   * const module =
   *   await import('./module.js');
   *
   * In Tree-sitter's JavaScript grammar,
   * dynamic import is represented as a
   * call_expression whose function is import.
   */
  const isDynamicImport = functionNode.type === 'import' || functionText === 'import';

  if (!isRequire && !isDynamicImport) {
    return null;
  }

  const argument = getCallArgument(node);

  const importSource = extractStaticString(argument, source);

  /*
   * We intentionally ignore dynamic paths:
   *
   * require(variable)
   * import(`./${name}.js`)
   *
   * B6 cannot reliably resolve those to one
   * concrete file.
   */
  if (!importSource) {
    return null;
  }

  return {
    source: importSource,

    range: createRange(node),
  };
}

function extractPythonDependencies(
  node: Parser.SyntaxNode,

  source: string,
): ParsedImport[] {
  if (node.type === 'import_statement') {
    const imports: ParsedImport[] = [];

    for (const child of node.namedChildren) {
      let importNode = child;

      if (child.type === 'aliased_import') {
        const nameNode = child.childForFieldName('name');

        if (nameNode) {
          importNode = nameNode;
        }
      }

      if (importNode.type !== 'dotted_name' && importNode.type !== 'identifier') {
        continue;
      }

      imports.push({
        source: getNodeText(importNode, source),

        range: createRange(importNode),
      });
    }

    return imports;
  }

  if (node.type === 'import_from_statement') {
    const moduleNode = node.childForFieldName('module_name');

    if (!moduleNode) {
      return [];
    }

    return [
      {
        source: getNodeText(moduleNode, source),

        range: createRange(node),
      },
    ];
  }

  return [];
}

export function extractImports(
  root: Parser.SyntaxNode,

  source: string,

  language: SupportedLanguage,
): ParsedImport[] {
  const imports: ParsedImport[] = [];

  function visit(node: Parser.SyntaxNode): void {
    if (language === 'javascript' || language === 'typescript' || language === 'tsx') {
      const dependency = extractJavaScriptLikeDependency(node, source);

      if (dependency) {
        imports.push(dependency);
      }
    } else if (language === 'python') {
      imports.push(...extractPythonDependencies(node, source));
    }

    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(root);

  return imports;
}
