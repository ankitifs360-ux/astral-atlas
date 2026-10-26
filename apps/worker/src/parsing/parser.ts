import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import Python from 'tree-sitter-python';
import TypeScript from 'tree-sitter-typescript';

import { extractCalls } from './call-extractor.js';

import { extractClasses } from './class-extractor.js';

import { extractFunctions } from './function-extractor.js';

import { extractImports } from './import-extractor.js';

import type { ParseSourceRequest, ParseSourceResult, SupportedLanguage } from './types.js';

function setParserLanguage(parser: Parser, language: SupportedLanguage): void {
  switch (language) {
    case 'javascript': {
      parser.setLanguage(JavaScript);

      return;
    }

    case 'typescript': {
      parser.setLanguage(TypeScript.typescript);

      return;
    }

    case 'tsx': {
      parser.setLanguage(TypeScript.tsx);

      return;
    }

    case 'python': {
      parser.setLanguage(Python);

      return;
    }
  }
}

export function parseSource(request: ParseSourceRequest): ParseSourceResult {
  const parser = new Parser();

  setParserLanguage(parser, request.language);

  const tree = parser.parse(request.source);

  const imports = extractImports(tree.rootNode, request.source, request.language);

  const functions = extractFunctions(tree.rootNode, request.source, request.language);

  const classes = extractClasses(tree.rootNode, request.source, request.language);

  const calls = extractCalls(tree.rootNode, request.source, request.language);

  return {
    filePath: request.filePath,

    language: request.language,

    imports,

    functions,

    classes,

    calls,

    hasSyntaxErrors: tree.rootNode.hasError,
  };
}
