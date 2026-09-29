export async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/" + path, {
    method,
    headers:
      body instanceof FormData
        ? {}
        : body
          ? { "Content-Type": "application/json" }
          : {},
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data: any = await response.json();
  if (!response.ok)
    throw new Error(data.error || "The request could not finish.");
  return data;
}
export const specLabel = (doc: any) =>
  doc.specLabel || doc.filename.replace(/\.pdf$/i, "");
export const pretty = (text: string) => text.replaceAll("_", " ");
