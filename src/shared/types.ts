export const NEW_PROJECT_ID = "__new_project__";

export type PedalAction = "left" | "center" | "right";

export interface PedalBindings {
  left: string;
  center: string;
  right: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: string;
  sortOrder: number;
  nameLocked?: boolean;
  autoNamedAt?: string;
  autoNameThoughtKey?: string;
}

export type IdeaStatus = "pending" | "transcribing" | "ready" | "failed";

export interface IdeaRecord {
  id: string;
  projectId: string;
  createdAt: string;
  durationMs: number;
  status: IdeaStatus;
  originalAudioPath: string;
  originalMimeType: string;
  normalizedAudioPath?: string;
  transcript?: string;
  error?: string;
  exportedAt?: string;
}

export interface AppSnapshot {
  projects: ProjectRecord[];
  ideas: IdeaRecord[];
}

export interface ExportResult {
  markdownPath: string;
  jsonlPath: string;
  markdown: string;
  jsonl: string;
  exportedThoughtIds: string[];
}

export interface DeleteProjectResult {
  deletedProjectId: string;
  deletedThoughtIds: string[];
}

export interface DeleteIdeaResult {
  deletedThoughtId: string;
}
