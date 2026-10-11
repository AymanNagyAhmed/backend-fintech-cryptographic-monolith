export interface ApiMeta {
  requestId: string;
}

export interface ApiErrorDetail {
  field: string;
  issue: string;
}

export interface ApiSuccess<T> {
  success: true;
  statusCode: number;
  message: string;
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  success: false;
  // 4xx = client fault, 5xx = server fault
  statusCode: number;
  error: {
    // Stable UPPER_SNAKE_CASE, clients branch on this
    code: string;
    message: string;
    details?: ApiErrorDetail[];
  };
  meta: ApiMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred. Our team has been notified.';
