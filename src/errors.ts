export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message = "not found") => new HttpError(404, message);

export function httpErrorResponse(err: unknown): Response | null {
  if (err instanceof HttpError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  return null;
}
