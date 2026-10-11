export const API_BASE = import.meta.env.VITE_API_URL || "";

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API error: ${status}`);
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status);
  }
  return response.json();
}
