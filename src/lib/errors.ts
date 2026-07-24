export function readableError(
  error: unknown,
  fallback = "데이터를 처리하지 못했습니다."
): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; details?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.details === "string") return candidate.details;
  }
  return fallback;
}
