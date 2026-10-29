// Що це: доменні помилки. Прості класи без HTTP всередині.
// Чому: сервіс каже "немає такого поста", а не "404". У HTTP-код це перекладає фільтр.
// Хто викликає: сервіси кидають, http-exception.filter.ts ловить і мапить на код.

export class DomainError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

// 404: об'єкта немає (або він м'яко видалений і це не адмін).
export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} ${id} не знайдено`, { entity, id });
  }
}

// 409: конфлікт стану. Email уже зайнятий, пост уже опублікований, баланс недостатній.
export class ConflictError extends DomainError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, details);
  }
}

// 401: немає або невалідний токен.
export class UnauthorizedError extends DomainError {
  constructor(message = 'Потрібна автентифікація') {
    super('UNAUTHORIZED', message);
  }
}

// 403: користувач відомий, але права не ті.
export class ForbiddenError extends DomainError {
  constructor(message = 'Недостатньо прав') {
    super('FORBIDDEN', message);
  }
}

// 422: запит синтаксично правильний, але бізнес-правило не дозволяє.
export class UnprocessableError extends DomainError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, details);
  }
}

// 429: ліміт (rate limit або повна черга).
export class TooManyRequestsError extends DomainError {
  readonly retryAfterSeconds: number;
  constructor(code: string, message: string, retryAfterSeconds: number) {
    super(code, message, { retryAfterSeconds });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// 502: зовнішній сервіс (LLM, GitHub) відповів сміттям або не відповів.
export class UpstreamError extends DomainError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, details);
  }
}
