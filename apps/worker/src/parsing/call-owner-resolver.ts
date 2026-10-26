import type {
  OwnedParsedCall,
  ParsedCall,
  ParsedFunction,
  SourcePosition,
  SourceRange,
} from './types.js';

function comparePositions(left: SourcePosition, right: SourcePosition): number {
  if (left.row !== right.row) {
    return left.row - right.row;
  }

  return left.column - right.column;
}

function rangeContains(container: SourceRange, target: SourceRange): boolean {
  return (
    comparePositions(container.start, target.start) <= 0 &&
    comparePositions(container.end, target.end) >= 0
  );
}

/**
 * Finds the function that directly owns a call.
 *
 * For nested functions, the smallest enclosing function
 * is selected so calls are attributed to their nearest
 * function rather than an outer function.
 *
 * Returns null when the call occurs at module/file scope.
 */
export function findCallOwner(
  call: ParsedCall,
  functions: readonly ParsedFunction[],
): ParsedFunction | null {
  let owner: ParsedFunction | null = null;

  for (const candidate of functions) {
    if (!rangeContains(candidate.range, call.range)) {
      continue;
    }

    if (!owner || rangeContains(owner.range, candidate.range)) {
      owner = candidate;
    }
  }

  return owner;
}

/**
 * Associates every parsed call with its nearest
 * enclosing function.
 *
 * Calls made at module/file scope receive a null owner.
 *
 * Input call ordering is preserved.
 */
export function assignCallOwners(
  calls: readonly ParsedCall[],
  functions: readonly ParsedFunction[],
): OwnedParsedCall[] {
  return calls.map((call) => ({
    call,

    owner: findCallOwner(call, functions),
  }));
}
