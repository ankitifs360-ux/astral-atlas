import { availableParallelism } from 'node:os';

import { ParserThreadClient } from './parser-thread-client.js';

import type { ParseSourceRequest, ParseSourceResult } from './types.js';

interface PendingParseTask {
  request: ParseSourceRequest;

  resolve: (result: ParseSourceResult) => void;

  reject: (error: Error) => void;
}

interface ParserThreadSlot {
  client: ParserThreadClient;

  busy: boolean;

  activeTask: PendingParseTask | null;
}

export type ParserThreadClientFactory = () => ParserThreadClient;

export function getDefaultParserPoolSize(): number {
  /*
   * Leave one logical CPU available for the
   * BullMQ worker/event loop when possible.
   *
   * Cap the initial parser pool at four threads
   * so large machines do not create an excessive
   * number of native parser workers.
   */
  const parallelism = availableParallelism();

  const availableForParsing = parallelism > 1 ? parallelism - 1 : 1;

  return Math.max(1, Math.min(4, availableForParsing));
}

export class ParserThreadPool {
  private readonly slots: ParserThreadSlot[];

  private readonly waitingTasks: PendingParseTask[] = [];

  private closed = false;

  public constructor(
    size: number = getDefaultParserPoolSize(),

    clientFactory: ParserThreadClientFactory = () => new ParserThreadClient(),
  ) {
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error('Parser thread pool size must be a positive integer.');
    }

    this.slots = Array.from(
      {
        length: size,
      },
      () => ({
        client: clientFactory(),

        busy: false,

        activeTask: null,
      }),
    );
  }

  public get size(): number {
    return this.slots.length;
  }

  public parse(request: ParseSourceRequest): Promise<ParseSourceResult> {
    if (this.closed) {
      return Promise.reject(new Error('Parser thread pool is closed.'));
    }

    return new Promise<ParseSourceResult>((resolve, reject) => {
      this.waitingTasks.push({
        request,
        resolve,
        reject,
      });

      this.dispatch();
    });
  }

  public parseMany(requests: readonly ParseSourceRequest[]): Promise<ParseSourceResult[]> {
    /*
     * Promise.all preserves the order of the
     * input array even when worker threads
     * finish in a different order.
     */
    return Promise.all(requests.map((request) => this.parse(request)));
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    const closeError = new Error('Parser thread pool was closed.');

    /*
     * Reject tasks still waiting for a thread.
     */
    while (this.waitingTasks.length > 0) {
      const task = this.waitingTasks.shift();

      task?.reject(closeError);
    }

    /*
     * Reject tasks already running on a thread.
     *
     * The pool owns these outer Promises,
     * therefore the pool should also guarantee
     * that they settle during shutdown.
     */
    for (const slot of this.slots) {
      if (slot.activeTask !== null) {
        slot.activeTask.reject(closeError);

        slot.activeTask = null;
      }

      slot.busy = false;
    }

    /*
     * Finally terminate the underlying
     * parser worker threads.
     */
    await Promise.allSettled(this.slots.map((slot) => slot.client.close()));
  }

  private dispatch(): void {
    if (this.closed) {
      return;
    }

    for (const slot of this.slots) {
      if (slot.busy) {
        continue;
      }

      const task = this.waitingTasks.shift();

      if (!task) {
        return;
      }

      this.startTask(slot, task);
    }
  }

  private startTask(
    slot: ParserThreadSlot,

    task: PendingParseTask,
  ): void {
    slot.busy = true;

    slot.activeTask = task;

    void slot.client.parse(task.request).then(
      (result) => {
        /*
         * Release the thread BEFORE resolving
         * the caller's Promise.
         *
         * This means the next queued file can
         * start immediately.
         */
        this.releaseSlot(slot, task);

        task.resolve(result);
      },
      (error: unknown) => {
        /*
         * A failed parse also releases the
         * thread for another waiting file.
         */
        this.releaseSlot(slot, task);

        task.reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  }

  private releaseSlot(
    slot: ParserThreadSlot,

    task: PendingParseTask,
  ): void {
    /*
     * close() may already have cleared this
     * active task.
     */
    if (slot.activeTask !== task) {
      return;
    }

    slot.activeTask = null;

    slot.busy = false;

    /*
     * Give the newly free thread another file
     * immediately.
     */
    this.dispatch();
  }
}
