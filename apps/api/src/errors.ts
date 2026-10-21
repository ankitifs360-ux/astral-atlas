import { Type } from 'typebox';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_SERVER_ERROR';

export interface ErrorDetail {
  field: string;
  message: string;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details: readonly ErrorDetail[] | undefined;

  public constructor(
    code: ErrorCode,
    statusCode: number,
    message: string,
    details?: readonly ErrorDetail[],
  ) {
    super(message);

    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

const ErrorCodeSchema = Type.Union([
  Type.Literal('BAD_REQUEST'),
  Type.Literal('VALIDATION_ERROR'),
  Type.Literal('NOT_FOUND'),
  Type.Literal('PAYLOAD_TOO_LARGE'),
  Type.Literal('UNSUPPORTED_MEDIA_TYPE'),
  Type.Literal('RATE_LIMITED'),
  Type.Literal('SERVICE_UNAVAILABLE'),
  Type.Literal('INTERNAL_SERVER_ERROR'),
]);

export const ErrorResponseSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: ErrorCodeSchema,
        message: Type.String(),

        details: Type.Optional(
          Type.Array(
            Type.Object(
              {
                field: Type.String(),
                message: Type.String(),
              },
              {
                additionalProperties: false,
              },
            ),
          ),
        ),
      },
      {
        additionalProperties: false,
      },
    ),

    requestId: Type.String(),
  },
  {
    additionalProperties: false,
  },
);

export function createErrorResponse(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: readonly ErrorDetail[],
) {
  return {
    error: {
      code,
      message,

      ...(details
        ? {
            details: [...details],
          }
        : {}),
    },

    requestId,
  };
}
