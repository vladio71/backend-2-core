// Що це: єдиний глобальний фільтр помилок. Будь-який throw у контролері чи сервісі
// перетворюється на одну JSON-форму: { statusCode, code, message, details?, requestId }.
// Чому: фронтенду потрібна одна форма помилки, а не десять різних.
// Хто викликає: Nest, через app.useGlobalFilters() у main.ts.
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  UnprocessableError,
  UpstreamError,
} from './domain-errors';
import { getRequestId } from '../logging/request-context';
import { AppLogger } from '../logging/app-logger';

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

interface ValidationResponse {
  message?: string | string[];
  error?: string;
}

function statusForDomainError(error: DomainError): number {
  if (error instanceof NotFoundError) return HttpStatus.NOT_FOUND;
  if (error instanceof ConflictError) return HttpStatus.CONFLICT;
  if (error instanceof UnauthorizedError) return HttpStatus.UNAUTHORIZED;
  if (error instanceof ForbiddenError) return HttpStatus.FORBIDDEN;
  if (error instanceof UnprocessableError) return HttpStatus.UNPROCESSABLE_ENTITY;
  if (error instanceof TooManyRequestsError) return HttpStatus.TOO_MANY_REQUESTS;
  if (error instanceof UpstreamError) return HttpStatus.BAD_GATEWAY;
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new AppLogger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = getRequestId() ?? String(request.headers['x-request-id'] ?? '');

    const body = this.toBody(exception, requestId);

    if (exception instanceof TooManyRequestsError) {
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }
    if (body.statusCode >= 500) {
      // 5xx логуємо повністю: це наша помилка і її треба побачити.
      this.logger.error(`${request.method} ${request.url} -> ${body.statusCode} ${body.code}`, exception);
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${body.statusCode} ${body.code}: ${body.message}`);
    }

    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, requestId: string): ErrorBody {
    // 1. Наші доменні помилки.
    if (exception instanceof DomainError) {
      return {
        statusCode: statusForDomainError(exception),
        code: exception.code,
        message: exception.message,
        details: exception.details,
        requestId,
      };
    }
    // 2. HttpException від Nest (ValidationPipe, guards, 404 роутера).
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const parsed: ValidationResponse = typeof raw === 'string' ? { message: raw } : (raw as ValidationResponse);
      const messages = Array.isArray(parsed.message) ? parsed.message : [parsed.message ?? exception.message];
      return {
        statusCode: status,
        code: status === HttpStatus.BAD_REQUEST ? 'VALIDATION_ERROR' : codeFromStatus(status),
        message: status === HttpStatus.BAD_REQUEST ? 'Невалідний запит' : messages[0],
        details: status === HttpStatus.BAD_REQUEST ? messages : undefined,
        requestId,
      };
    }
    // 3. Усе інше: баг. Текст помилки назовні не віддаємо.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Внутрішня помилка сервера',
      requestId,
    };
  }
}

function codeFromStatus(status: number): string {
  switch (status) {
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'HTTP_ERROR';
  }
}
