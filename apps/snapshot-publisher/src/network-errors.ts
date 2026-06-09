export const safeUrlForLog = (value: string): string => {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
};

export const describeFetchError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause =
    error.cause instanceof Error && error.cause.message !== error.message
      ? `: ${error.cause.message}`
      : "";
  return `${error.message}${cause}`;
};
