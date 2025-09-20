const API = process.env.NEXT_PUBLIC_MODAL_API!;

export async function apiJson<T>(
  path: string,
  token?: string,
  method: 'GET'|'POST' = 'GET',
  body?: any
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function apiCsv(path: string, file: File, token: string): Promise<Blob> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.blob();
}
