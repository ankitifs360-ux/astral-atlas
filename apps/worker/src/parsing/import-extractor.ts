import type Parser from 'tree-sitter';

import type { ParsedImport, ParsedImportBinding, SourceRange, SupportedLanguage } from './types.js';

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

function extractStaticString(node: Parser.SyntaxNode | null, source: string): string | null {
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

function findNamedChild(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  return node.namedChildren.find((child) => child.type === type) ?? null;
}

function extractNamedImportBindings(
  namedImportsNode: Parser.SyntaxNode,
  source: string,
): ParsedImportBinding[] {
  const bindings: ParsedImportBinding[] = [];

  for (const specifier of namedImportsNode.namedChildren) {
    if (specifier.type !== 'import_specifier') {
      continue;
    }

    const nameNode = specifier.childForFieldName('name') ?? specifier.namedChildren[0] ?? null;

    if (!nameNode) {
      continue;
    }

    const aliasNode = specifier.childForFieldName('alias') ?? specifier.namedChildren[1] ?? null;

    const importedName = getNodeText(nameNode, source);
    const localName = aliasNode ? getNodeText(aliasNode, source) : importedName;

    if (importedName.length === 0 || localName.length === 0) {
      continue;
    }

    bindings.push({
      kind: 'named',
      importedName,
      localName,
    });
  }

  return bindings;
}

function extractNamespaceImportBinding(
  namespaceNode: Parser.SyntaxNode,
  source: string,
): ParsedImportBinding | null {
  const localNode =
    namespaceNode.childForFieldName('name') ??
    namespaceNode.namedChildren.find((child) => child.type === 'identifier') ??
    null;

  if (!localNode) {
    return null;
  }

  const localName = getNodeText(localNode, source);

  if (localName.length === 0) {
    return null;
  }

  return {
    kind: 'namespace',
    importedName: null,
    localName,
  };
}

function extractJavaScriptLikeImportBindings(
  node: Parser.SyntaxNode,
  source: string,
): ParsedImportBinding[] {
  const importClause = findNamedChild(node, 'import_clause');

  /*
   * Side-effect-only import:
   *
   * import './setup.js';
   */
  if (!importClause) {
    return [];
  }

  const bindings: ParsedImportBinding[] = [];

  /*
   * Direct identifier children of import_clause represent
   * default imports:
   *
   * import express from 'express';
   *
   * For combined imports:
   *
   * import express, { Router } from 'express';
   *
   * `express` remains the direct identifier while the
   * named imports live inside `named_imports`.
   */
  const defaultBindingNode = importClause.namedChildren.find(
    (child) => child.type === 'identifier',
  );

  if (defaultBindingNode) {
    const localName = getNodeText(defaultBindingNode, source);

    if (localName.length > 0) {
      bindings.push({
        kind: 'default',
        importedName: null,
        localName,
      });
    }
  }

  const namedImportsNode = findNamedChild(importClause, 'named_imports');

  if (namedImportsNode) {
    bindings.push(...extractNamedImportBindings(namedImportsNode, source));
  }

  const namespaceNode = findNamedChild(importClause, 'namespace_import');

  if (namespaceNode) {
    const namespaceBinding = extractNamespaceImportBinding(namespaceNode, source);

    if (namespaceBinding) {
      bindings.push(namespaceBinding);
    }
  }

  return bindings;
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

    const bindings = extractJavaScriptLikeImportBindings(node, source);

    return {
      source: importSource,
      range: createRange(node),
      ...(bindings.length > 0 ? { bindings } : {}),
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
   *
   * Re-export bindings are intentionally not treated as
   * local import bindings because they do not introduce
   * callable names into the current module scope.
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

function extractPythonDependencies(node: Parser.SyntaxNode, source: string): ParsedImport[] {
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
