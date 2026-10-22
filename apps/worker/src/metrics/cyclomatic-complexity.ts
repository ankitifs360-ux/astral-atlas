import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';

import type { SupportedLanguage } from '../parsing/types.js';

interface ComplexityRequest {
  language: SupportedLanguage;

  source: string;
}

const JAVASCRIPT_DECISION_NODES = new Set([
  'if_statement',
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  'catch_clause',
  'switch_case',
  'ternary_expression',
]);

const PYTHON_DECISION_NODES = new Set([
  'if_statement',
  'for_statement',
  'while_statement',
  'except_clause',
  'conditional_expression',
  'case_clause',
]);

const FUNCTION_NODES = new Set([
  /*
   * JavaScript / TypeScript.
   */
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
  'generator_function_declaration',
  'generator_function',

  /*
   * Python.
   */
  'function_definition',
]);

const JAVASCRIPT_LOGICAL_OPERATORS = new Set(['&&', '||', '??']);

const PYTHON_LOGICAL_OPERATORS = new Set(['and', 'or']);

function createParser(language: SupportedLanguage): Parser {
  const parser = new Parser();

  switch (language) {
    case 'javascript': {
      parser.setLanguage(JavaScript);

      break;
    }

    case 'typescript': {
      parser.setLanguage(TypeScript.typescript);

      break;
    }

    case 'tsx': {
      parser.setLanguage(TypeScript.tsx);

      break;
    }

    case 'python': {
      parser.setLanguage(Python);

      break;
    }
  }

  return parser;
}

function countOperatorChildren(
  node: Parser.SyntaxNode,

  operators: ReadonlySet<string>,
): number {
  let count = 0;

  for (const child of node.children) {
    if (operators.has(child.type)) {
      count += 1;
    }
  }

  return count;
}

function getDecisionContribution(
  node: Parser.SyntaxNode,

  language: SupportedLanguage,
): number {
  if (language === 'python') {
    if (PYTHON_DECISION_NODES.has(node.type)) {
      return 1;
    }

    /*
     * Python:
     *
     * a and b or c
     *
     * Each logical operator introduces another
     * possible control-flow path.
     */
    if (node.type === 'boolean_operator') {
      return countOperatorChildren(node, PYTHON_LOGICAL_OPERATORS);
    }

    return 0;
  }

  if (JAVASCRIPT_DECISION_NODES.has(node.type)) {
    return 1;
  }

  /*
   * JavaScript / TypeScript:
   *
   * a && b
   * a || b
   * a ?? b
   *
   * Tree-sitter represents these using
   * binary_expression nodes.
   */
  if (node.type === 'binary_expression') {
    return countOperatorChildren(node, JAVASCRIPT_LOGICAL_OPERATORS);
  }

  return 0;
}

export function calculateCyclomaticComplexity(request: ComplexityRequest): number {
  const parser = createParser(request.language);

  const tree = parser.parse(request.source);

  let functionCount = 0;

  let decisionCount = 0;

  /*
   * Iterative traversal avoids recursive
   * JavaScript call stacks on unusually deep
   * source files.
   */
  const stack: Parser.SyntaxNode[] = [tree.rootNode];

  while (stack.length > 0) {
    const node = stack.pop();

    if (!node) {
      continue;
    }

    if (FUNCTION_NODES.has(node.type)) {
      functionCount += 1;
    }

    decisionCount += getDecisionContribution(node, request.language);

    /*
     * Reverse push keeps normal source order
     * during depth-first traversal.
     */
    for (let index = node.namedChildCount - 1; index >= 0; index -= 1) {
      const child = node.namedChild(index);

      if (child) {
        stack.push(child);
      }
    }
  }

  /*
   * Every function has at least complexity 1.
   *
   * For files without functions, treat the file
   * itself as one executable scope.
   *
   * Examples:
   *
   * const x = 1;
   * complexity = 1
   *
   * function a() {}
   * function b() {}
   * complexity = 2
   *
   * function a() {
   *   if (x) {}
   * }
   *
   * complexity = 2
   */
  const baseComplexity = Math.max(1, functionCount);

  return baseComplexity + decisionCount;
}
