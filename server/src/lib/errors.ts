export class HttpError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function badRequest(message: string, details?: unknown): HttpError {
  return new HttpError(400, "bad_request", message, details)
}

export function unauthorized(message = "You need to sign in to continue."): HttpError {
  return new HttpError(401, "unauthorized", message)
}

export function forbidden(message = "You do not have permission to perform this action."): HttpError {
  return new HttpError(403, "forbidden", message)
}

export function notFound(message = "The requested record was not found."): HttpError {
  return new HttpError(404, "not_found", message)
}

export function conflict(message: string, details?: unknown): HttpError {
  return new HttpError(409, "conflict", message, details)
}

export function tooMany(message = "Too many attempts. Please wait a moment and try again."): HttpError {
  return new HttpError(429, "rate_limited", message)
}

export function serverError(message = "Something went wrong on our side."): HttpError {
  return new HttpError(500, "server_error", message)
}
