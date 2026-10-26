import type { ParsedFunction } from '../parsing/types.js';

import type { CallResolutionRequest, ResolvedCall } from './types.js';

function isSimpleIdentifier(callee: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callee);
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

/**
 * Resolves a raw call against functions declared in the
 * same source file.
 *
 * This resolver is deliberately conservative.
 *
 * Supported:
 *
 *   saveUser()
 *   validate()
 *
 * Not yet supported:
 *
 *   userService.save()
 *   this.save()
 *   database.find()
 *
 * Member calls require import/object binding resolution
 * before we can safely identify their target.
 */
export function resolveSameFileFunctionCall(
  request: CallResolutionRequest,
  functions: readonly ParsedFunction[],
): ResolvedCall {
  const callee = request.callee.trim();

  if (!isSimpleIdentifier(callee)) {
    return createUnresolvedCall(request, 'unsupported-callee');
  }

  const matches = functions.filter((functionNode) => {
    const name = functionNode.name?.trim();

    return name !== undefined && name.length > 0 && name === callee;
  });

  if (matches.length === 0) {
    return createUnresolvedCall(request, 'target-not-found');
  }

  if (matches.length > 1) {
    return createUnresolvedCall(request, 'ambiguous-target');
  }

  const targetFunction = matches[0];

  if (!targetFunction) {
    return createUnresolvedCall(request, 'target-not-found');
  }

  return {
    sourceFilePath: request.sourceFilePath,

    sourceLanguage: request.sourceLanguage,

    sourceFunction: request.sourceFunction,

    callee: request.callee,

    range: request.range,

    kind: 'internal',

    targetFilePath: request.sourceFilePath,

    targetFunction,

    reason: null,
  };
}
