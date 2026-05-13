import type { AppSnapshot, DeleteProjectResult, ExportResult, ProjectRecord } from "../shared/types";

const tokenStorageKey = "idea-collector-session-token";

export interface AppSettings {
  transcriptionModel: string;
  projectNameModel: string;
  minRecordingMs: number;
}

export interface ConnectInfo {
  phoneUrl: string;
  qrPath: string;
}

export function getSessionToken(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (token) {
    window.localStorage.setItem(tokenStorageKey, token);
    url.searchParams.delete("token");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    return token;
  }

  return window.localStorage.getItem(tokenStorageKey);
}

export async function fetchSnapshot(): Promise<AppSnapshot> {
  return apiGet<AppSnapshot>("/api/snapshot");
}

export async function fetchSettings(): Promise<AppSettings> {
  return apiGet<AppSettings>("/api/settings");
}

export async function fetchConnectInfo(): Promise<ConnectInfo> {
  return apiGet<ConnectInfo>("/api/connect-info");
}

export async function createProject(name?: string): Promise<ProjectRecord> {
  return apiJson<ProjectRecord>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name })
  });
}

export async function renameProject(projectId: string, name: string): Promise<ProjectRecord> {
  return apiJson<ProjectRecord>(`/api/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify({ name })
  });
}

export async function deleteProject(projectId: string): Promise<DeleteProjectResult> {
  return api<DeleteProjectResult>(`/api/projects/${projectId}`, { method: "DELETE" });
}

export async function autoNameProject(projectId: string): Promise<ProjectRecord> {
  return apiJson<ProjectRecord>(`/api/projects/${projectId}/auto-name`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function uploadIdeaAudio(input: {
  projectId: string;
  blob: Blob;
  durationMs: number;
  mimeType: string;
}): Promise<void> {
  const form = new FormData();
  form.append("projectId", input.projectId);
  form.append("durationMs", String(Math.round(input.durationMs)));
  form.append("mimeType", input.mimeType);
  form.append("audio", input.blob, fileNameForMimeType(input.mimeType));

  await api<void>("/api/ideas/audio", {
    method: "POST",
    body: form
  });
}

export async function retryIdea(ideaId: string): Promise<void> {
  await api<void>(`/api/ideas/${ideaId}/retry`, { method: "POST" });
}

export async function exportIdeas(options: { projectId?: string; includeExported?: boolean }): Promise<ExportResult> {
  return apiJson<ExportResult>("/api/export", {
    method: "POST",
    body: JSON.stringify(options)
  });
}

async function apiGet<T>(path: string): Promise<T> {
  return api<T>(path, { method: "GET" });
}

async function apiJson<T>(path: string, init: RequestInit): Promise<T> {
  return api<T>(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
}

async function api<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getSessionToken();
  if (token) {
    headers.set("x-session-token", token);
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

function fileNameForMimeType(mimeType: string): string {
  if (mimeType.includes("webm")) {
    return "thought.webm";
  }
  if (mimeType.includes("ogg")) {
    return "thought.ogg";
  }
  if (mimeType.includes("mp4")) {
    return "thought.mp4";
  }
  if (mimeType.includes("wav")) {
    return "thought.wav";
  }
  return "thought.audio";
}
