import { randomUUID } from 'node:crypto';

import { Worker } from 'node:worker_threads';

import type { ParserThreadRequest, ParserThreadResponse } from './thread-protocol.js';

import type { ParseSourceRequest, ParseSourceResult } from './types.js';

interface PendingParseRequest {
  resolve: (result: ParseSourceResult) => void;

  reject: (error: Error) => void;
}

function createParserWorker(): Worker {
  /*
   * Development:
   *
   * parser-thread-client.ts
   * parser-thread.ts
   *
   * Production build:
   *
   * parser-thread-client.js
   * parser-thread.js
   */
  const runningFromTypeScript = import.meta.url.endsWith('.ts');

  const threadUrl = new URL(
    runningFromTypeScript ? './parser-thread.ts' : './parser-thread.js',
    import.meta.url,
  );

  /*
   * Development needs tsx so the worker thread
   * can execute the TypeScript entrypoint.
   */
  if (runningFromTypeScript) {
    return new Worker(threadUrl, {
      execArgv: ['--import', 'tsx'],
    });
  }

  return new Worker(threadUrl);
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function createRemoteError(
  response: Extract<
    ParserThreadResponse,
    {
      type: 'error';
    }
  >,
): Error {
  const error = new Error(response.error.message);

  error.name = response.error.name;

  if (response.error.stack !== undefined) {
    error.stack = response.error.stack;
  }

  return error;
}

export class ParserThreadClient {
  private readonly worker: Worker;

  private readonly pending = new Map<string, PendingParseRequest>();

  private closed = false;

  private terminateStarted = false;

  public constructor(worker: Worker = createParserWorker()) {
    this.worker = worker;

    this.worker.on('message', (response: ParserThreadResponse) => {
      this.handleResponse(response);
    });

    this.worker.on('error', (error) => {
      this.handleWorkerFailure(error);
    });

    this.worker.on('exit', (exitCode) => {
      if (this.closed) {
        return;
      }

      this.handleWorkerFailure(
        new Error(`Parser worker thread exited unexpectedly with code ${exitCode}.`),
      );
    });
  }

  public parse(request: ParseSourceRequest): Promise<ParseSourceResult> {
    if (this.closed) {
      return Promise.reject(new Error('Parser thread client is closed.'));
    }

    const id = randomUUID();

    const message: ParserThreadRequest = {
      id,

      type: 'parse',

      payload: request,
    };

    return new Promise<ParseSourceResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject,
      });

      try {
        this.worker.postMessage(message);
      } catch (error: unknown) {
        this.pending.delete(id);

        reject(toError(error));
      }
    });
  }

  public async close(): Promise<void> {
    /*
     * close() should be safe to call more than
     * once.
     */
    if (this.terminateStarted) {
      return;
    }

    this.terminateStarted = true;

    this.closed = true;

    this.rejectPending(new Error('Parser thread client was closed.'));

    await this.worker.terminate();
  }

  private handleResponse(response: ParserThreadResponse): void {
    /*
     * Ignore late responses after shutdown or
     * after a worker failure.
     */
    if (this.closed) {
      return;
    }

    const pendingRequest = this.pending.get(response.id);

    if (!pendingRequest) {
      /*
       * Unknown/old response.
       *
       * This can happen if the request was
       * already rejected during shutdown.
       */
      return;
    }

    this.pending.delete(response.id);

    if (response.type === 'result') {
      pendingRequest.resolve(response.result);

      return;
    }

    pendingRequest.reject(createRemoteError(response));
  }

  private handleWorkerFailure(error: Error): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const pendingRequest of this.pending.values()) {
      pendingRequest.reject(error);
    }

    this.pending.clear();
  }
}
