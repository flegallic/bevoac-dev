class AppError extends Error {
  constructor(message, { code = 'APP_ERROR', statusCode = 500, details = null } = {}) {
    super(message); this.name = 'AppError'; this.code = code; this.statusCode = statusCode; this.details = details;
  }
}
class UnauthorizedError extends AppError { constructor(message = 'Unauthorized') { super(message, { code: 'UNAUTHORIZED', statusCode: 401 }); } }
class ForbiddenError extends AppError { constructor(message = 'Forbidden', details = null) { super(message, { code: 'FORBIDDEN', statusCode: 403, details }); } }
class NotFoundError extends AppError { constructor(message = 'Not found') { super(message, { code: 'NOT_FOUND', statusCode: 404 }); } }
class ConflictError extends AppError { constructor(message = 'Conflict', details = null) { super(message, { code: 'CONFLICT', statusCode: 409, details }); } }
class ValidationError extends AppError { constructor(message = 'Validation error', details = null) { super(message, { code: 'VALIDATION_ERROR', statusCode: 400, details }); } }
module.exports = { AppError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError, ValidationError };
