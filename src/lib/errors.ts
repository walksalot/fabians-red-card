/** Domain error carrying an HTTP status. Services throw these; API routes map them. */
export class AppError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}
