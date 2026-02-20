function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "{\"log\":\"json_failed\"}";
  }
}

export function logInfo(tag: string, data: Record<string, unknown> = {}): void {
  console.info(safeJson({ level: "info", tag, ...data }));
}

export function logError(tag: string, err: unknown, data: Record<string, unknown> = {}): void {
  const error = err instanceof Error
    ? { name: err.name, message: err.message, stack: err.stack }
    : { name: "UnknownError", message: String(err) };
  console.error(safeJson({ level: "error", tag, ...data, error }));
}
