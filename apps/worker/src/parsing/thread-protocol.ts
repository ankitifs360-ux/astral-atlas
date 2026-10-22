import type { ParseSourceRequest, ParseSourceResult } from './types.js';

export interface ParserThreadRequest {
  id: string;

  type: 'parse';

  payload: ParseSourceRequest;
}

export interface ParserThreadSuccessResponse {
  id: string;

  type: 'result';

  result: ParseSourceResult;
}

export interface ParserThreadErrorResponse {
  id: string;

  type: 'error';

  error: {
    name: string;

    message: string;

    stack?: string;
  };
}

export type ParserThreadResponse = ParserThreadSuccessResponse | ParserThreadErrorResponse;
