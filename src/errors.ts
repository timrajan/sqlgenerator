/**
 * An error whose message is safe and useful to show to the MCP client or CLI
 * user (e.g. "unknown table", "malformed manifest"). Other errors are reported
 * generically to avoid leaking internals.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export class NotFoundError extends UserFacingError {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ContextError extends UserFacingError {
  constructor(message: string) {
    super(message);
    this.name = 'ContextError';
  }
}

export class DuplicateExampleError extends UserFacingError {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateExampleError';
  }
}
