import { authHeaders } from "./api";
import { refreshSession } from "./session";

export interface UploadResult {
  url: string;
  kind: "image" | "video";
  name: string;
  size: number;
  mime: string;
}

const MB = 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/ogg", "video/quicktime"];
export const MAX_IMAGE = 20 * MB;
export const MAX_VIDEO = 200 * MB;

/** Returns a user-facing error, or null if the server will accept the file. */
export function validateFile(file: File): string | null {
  if (IMAGE_TYPES.includes(file.type)) return file.size > MAX_IMAGE ? `${file.name} is larger than 20 MB` : null;
  if (VIDEO_TYPES.includes(file.type)) return file.size > MAX_VIDEO ? `${file.name} is larger than 200 MB` : null;
  return `${file.name || "This file"} isn't a supported image or video`;
}

export const isMedia = (file: File) => IMAGE_TYPES.includes(file.type) || VIDEO_TYPES.includes(file.type);

/** XHR (not fetch) so we can report upload progress. Retries once after refreshing an expired token. */
export async function uploadFile(file: File, onProgress?: (fraction: number) => void): Promise<UploadResult> {
  try {
    return await send(file, onProgress);
  } catch (err) {
    if ((err as { status?: number }).status === 401 && (await refreshSession())) return send(file, onProgress);
    throw err;
  }
}

function send(file: File, onProgress?: (fraction: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body: { error?: string } & Partial<UploadResult> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadResult);
      else reject(Object.assign(new Error(body.error ?? `Upload failed (${xhr.status})`), { status: xhr.status }));
    };
    xhr.onerror = () => reject(new Error("Upload failed — is the server running?"));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
