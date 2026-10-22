import { parentPort } from 'node:worker_threads';

import { parseSource } from './parser.js';

import type {
  ParserThreadErrorResponse,
  ParserThreadRequest,
  ParserThreadResponse,
} from './thread-protocol.js';

if (!parentPort) {
  throw new Error('Parser thread must run inside a Node.js worker thread.');
}

/*
 * Capture the checked MessagePort in a local const.
 *
 * TypeScript knows parserPort can never be null,
 * even inside nested callbacks.
 */
const parserPort = parentPort;

function serializeError(error: unknown): ParserThreadErrorResponse['error'] {
  if (error instanceof Error) {
    return {
      name: error.name,

      message: error.message,

      ...(error.stack !== undefined
        ? {
            stack: error.stack,
          }
        : {}),
    };
  }

  return {
    name: 'Error',

    message: String(error),
  };
}

function processRequest(request: ParserThreadRequest): ParserThreadResponse {
  try {
    const result = parseSource(request.payload);

    return {
      id: request.id,

      type: 'result',

      result,
    };
  } catch (error: unknown) {
    return {
      id: request.id,

      type: 'error',

      error: serializeError(error),
    };
  }
}

/*
 * This listener lives inside the parser thread.
 *
 * Parent/BullMQ worker:
 *
 *   postMessage(request)
 *
 *          ↓
 *
 * Parser thread:
 *
 *   parseSource(...)
 *
 *          ↓
 *
 *   postMessage(result)
 */
parserPort.on('message', (request: ParserThreadRequest) => {
  const response = processRequest(request);

  parserPort.postMessage(response);
});
