/**
 * API Response Envelope utilities for Platform API.
 * Provides a consistent response structure for all platform endpoints.
 *
 * @module apiEnvelope
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ApiMeta {
  timestamp: number;
  requestId?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorEnvelope {
  success: false;
  error: ApiError;
  meta: ApiMeta;
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Creates a success envelope wrapping the provided data.
 */
export function successEnvelope<T>(
  data: T,
  meta?: Partial<ApiMeta>,
): ApiSuccessEnvelope<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: Date.now(),
      ...meta,
    },
  };
}

/**
 * Creates an error envelope with structured error information.
 */
export function errorEnvelope(
  code: string,
  message: string,
  details?: unknown,
  meta?: Partial<ApiMeta>,
): ApiErrorEnvelope {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
    meta: {
      timestamp: Date.now(),
      ...meta,
    },
  };
}
