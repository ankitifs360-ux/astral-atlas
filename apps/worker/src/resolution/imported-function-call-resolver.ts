import type { ParseSourceResult, ParsedFunction, SourceRange } from '../parsing/types.js';

import type { CallResolutionRequest, ResolvedCall, ResolvedImport } from './types.js';

function isSimpleIdentifier(callee: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callee);
}

function rangesEqual(left: SourceRange, right: SourceRange): boolean {
  return (
    left.start.row === right.start.row &&
    left.start.column === right.start.column &&
    left.end.row === right.end.row &&
    left.end.column === right.end.column
  );
}

function createUnresolvedCall(
  request: CallResolutionRequest,
  reason: NonNullable<ResolvedCall['reason']>,
): ResolvedCall {
  return {
    sourceFilePath: request.sourceFilePath,

    sourceLanguage: request.sourceLanguage,

    sourceFunction: request.sourceFunction,

    callee: request.callee,

    range: request.range,

    kind: 'unresolved',

    targetFilePath: null,

    targetFunction: null,

    reason,
  };
}

interface ImportedFunctionCandidate {
  filePath: string;
  functionNode: ParsedFunction;
}

function createCandidateKey(candidate: ImportedFunctionCandidate): string {
  return JSON.stringify([
    candidate.filePath,
    candidate.functionNode.name,
    candidate.functionNode.range.start.row,
    candidate.functionNode.range.start.column,
    candidate.functionNode.range.end.row,
    candidate.functionNode.range.end.column,
  ]);
}

export function resolveNamedImportedFunctionCall(
  request: CallResolutionRequest,
  sourceFile: ParseSourceResult,
  resolvedImports: readonly ResolvedImport[],
  parsedFileByPath: ReadonlyMap<string, ParseSourceResult>,
): ResolvedCall {
  const callee = request.callee.trim();

  if (!isSimpleIdentifier(callee)) {
    return createUnresolvedCall(request, 'unsupported-callee');
  }

  const candidates = new Map<string, ImportedFunctionCandidate>();

  for (const parsedImport of sourceFile.imports) {
    const matchingBindings = (parsedImport.bindings ?? []).filter(
      (binding) =>
        binding.kind === 'named' && binding.localName === callee && binding.importedName !== null,
    );

    if (matchingBindings.length === 0) {
      continue;
    }

    const resolvedImport = resolvedImports.find(
      (candidate) =>
        candidate.sourceFilePath === sourceFile.filePath &&
        candidate.specifier === parsedImport.source &&
        rangesEqual(candidate.range, parsedImport.range),
    );

    if (
      !resolvedImport ||
      resolvedImport.kind !== 'internal' ||
      resolvedImport.targetFilePath === null
    ) {
      continue;
    }

    const targetFile = parsedFileByPath.get(resolvedImport.targetFilePath);

    if (!targetFile) {
      continue;
    }

    for (const binding of matchingBindings) {
      const importedName = binding.importedName;

      if (importedName === null) {
        continue;
      }

      for (const targetFunction of targetFile.functions) {
        if (!targetFunction.isExported || targetFunction.name !== importedName) {
          continue;
        }

        const candidate = {
          filePath: targetFile.filePath,
          functionNode: targetFunction,
        };

        candidates.set(createCandidateKey(candidate), candidate);
      }
    }
  }

  const resolvedCandidates = [...candidates.values()];

  if (resolvedCandidates.length === 0) {
    return createUnresolvedCall(request, 'target-not-found');
  }

  if (resolvedCandidates.length > 1) {
    return createUnresolvedCall(request, 'ambiguous-target');
  }

  const target = resolvedCandidates[0];

  if (!target) {
    return createUnresolvedCall(request, 'target-not-found');
  }

  return {
    sourceFilePath: request.sourceFilePath,

    sourceLanguage: request.sourceLanguage,

    sourceFunction: request.sourceFunction,

    callee: request.callee,

    range: request.range,

    kind: 'internal',

    targetFilePath: target.filePath,

    targetFunction: target.functionNode,

    reason: null,
  };
}
