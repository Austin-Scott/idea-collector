import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  AppSnapshot,
  DeleteIdeaResult,
  DeleteProjectResult,
  ExportResult,
  IdeaRecord,
  IdeaStatus,
  ProjectRecord
} from "../shared/types.js";
import { dataDir, exportDir } from "./paths.js";

interface StoreFile {
  projects: ProjectRecord[];
  ideas: IdeaRecord[];
}

interface IdeaInput {
  projectId: string;
  originalAudioPath: string;
  originalMimeType: string;
  durationMs: number;
}

const storeFileName = "store.json";

export class IdeaStore {
  private readonly storePath: string;
  private readonly rootAudioOriginalDir: string;
  private readonly rootAudioNormalizedDir: string;

  constructor(private readonly rootDataDir = dataDir, private readonly rootExportDir = exportDir) {
    this.storePath = path.join(rootDataDir, storeFileName);
    this.rootAudioOriginalDir = path.join(rootDataDir, "audio", "original");
    this.rootAudioNormalizedDir = path.join(rootDataDir, "audio", "normalized");
  }

  async init(): Promise<void> {
    await Promise.all([
      fs.mkdir(this.rootDataDir, { recursive: true }),
      fs.mkdir(this.rootExportDir, { recursive: true }),
      fs.mkdir(this.rootAudioOriginalDir, { recursive: true }),
      fs.mkdir(this.rootAudioNormalizedDir, { recursive: true })
    ]);

    try {
      await fs.access(this.storePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      await this.writeStore({
        projects: Array.from({ length: 5 }, (_, index) => ({
          id: randomUUID(),
          name: `Project ${index + 1}`,
          createdAt: new Date().toISOString(),
          sortOrder: index,
          nameLocked: false
        })),
        ideas: []
      });
    }
  }

  async snapshot(): Promise<AppSnapshot> {
    const store = await this.readStore();
    return normalizeStore(store);
  }

  async createProject(name?: string): Promise<ProjectRecord> {
    return this.mutate((store) => {
      const project: ProjectRecord = {
        id: randomUUID(),
        name: cleanProjectName(name) || nextUntitledProjectName(store.projects),
        createdAt: new Date().toISOString(),
        sortOrder: nextSortOrder(store.projects),
        nameLocked: Boolean(cleanProjectName(name))
      };
      store.projects.push(project);
      return project;
    });
  }

  async renameProject(projectId: string, name: string): Promise<ProjectRecord> {
    return this.mutate((store) => {
      const project = findProject(store, projectId);
      project.name = cleanProjectName(name) || project.name;
      project.nameLocked = true;
      return project;
    });
  }

  async deleteProject(projectId: string): Promise<DeleteProjectResult> {
    const filesToDelete = new Set<string>();
    const result = await this.mutate((store) => {
      findProject(store, projectId);

      const deletedThoughts = store.ideas.filter((idea) => idea.projectId === projectId);
      for (const idea of deletedThoughts) {
        addIdeaFiles(filesToDelete, idea);
      }

      store.projects = store.projects.filter((project) => project.id !== projectId);
      store.ideas = store.ideas.filter((idea) => idea.projectId !== projectId);

      return {
        deletedProjectId: projectId,
        deletedThoughtIds: deletedThoughts.map((idea) => idea.id)
      };
    });

    await Promise.all(Array.from(filesToDelete).map((filePath) => this.deleteOwnedDataFile(filePath)));
    return result;
  }

  async deleteIdea(ideaId: string): Promise<DeleteIdeaResult> {
    const filesToDelete = new Set<string>();
    const result = await this.mutate((store) => {
      const idea = findIdea(store, ideaId);
      addIdeaFiles(filesToDelete, idea);
      store.ideas = store.ideas.filter((candidate) => candidate.id !== ideaId);

      return {
        deletedThoughtId: ideaId
      };
    });

    await Promise.all(Array.from(filesToDelete).map((filePath) => this.deleteOwnedDataFile(filePath)));
    return result;
  }

  private async deleteOwnedDataFile(filePath: string): Promise<void> {
    if (!filePath) {
      return;
    }

    const resolvedDataDir = path.resolve(this.rootDataDir);
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(`${resolvedDataDir}${path.sep}`)) {
      return;
    }

    await fs.rm(resolvedFilePath, { force: true });
  }

  async autoRenameProject(projectId: string, name: string, thoughtKey?: string): Promise<ProjectRecord> {
    return this.mutate((store) => {
      const project = findProject(store, projectId);
      if (project.nameLocked || (thoughtKey && project.autoNameThoughtKey === thoughtKey)) {
        return project;
      }

      const cleanedName = cleanProjectName(name);
      if (cleanedName) {
        project.name = cleanedName;
        project.autoNamedAt = new Date().toISOString();
        project.autoNameThoughtKey = thoughtKey;
      }
      return project;
    });
  }

  async getReadyThoughtNamingInput(projectId: string): Promise<{ transcripts: string[]; thoughtKey: string }> {
    const store = await this.readStore();
    findProject(store, projectId);
    const readyThoughts = store.ideas
      .filter((idea) => idea.projectId === projectId && idea.status === "ready" && idea.transcript?.trim())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return {
      transcripts: readyThoughts.map((idea) => idea.transcript?.trim() ?? ""),
      thoughtKey: readyThoughtKey(readyThoughts)
    };
  }

  async createIdea(input: IdeaInput): Promise<IdeaRecord> {
    return this.mutate((store) => {
      findProject(store, input.projectId);

      const idea: IdeaRecord = {
        id: randomUUID(),
        projectId: input.projectId,
        createdAt: new Date().toISOString(),
        durationMs: input.durationMs,
        status: "pending",
        originalAudioPath: input.originalAudioPath,
        originalMimeType: input.originalMimeType
      };

      store.ideas.push(idea);
      return idea;
    });
  }

  async getIdea(ideaId: string): Promise<IdeaRecord> {
    const store = await this.readStore();
    return findIdea(store, ideaId);
  }

  async updateIdea(ideaId: string, patch: Partial<Omit<IdeaRecord, "id">>): Promise<IdeaRecord> {
    return this.mutate((store) => {
      const idea = findIdea(store, ideaId);
      Object.assign(idea, patch);
      return idea;
    });
  }

  async setIdeaStatus(ideaId: string, status: IdeaStatus, error?: string): Promise<IdeaRecord> {
    return this.updateIdea(ideaId, {
      status,
      error: status === "failed" ? error : undefined
    });
  }

  async exportIdeas(options: { projectId?: string; includeExported?: boolean } = {}): Promise<ExportResult> {
    return this.mutate(async (store) => {
      const snapshot = normalizeStore(store);
      const projectsById = new Map(snapshot.projects.map((project) => [project.id, project]));
      const readyThoughts = snapshot.ideas.filter((idea) => {
        if (idea.status !== "ready" || !idea.transcript?.trim()) {
          return false;
        }
        if (options.projectId && idea.projectId !== options.projectId) {
          return false;
        }
        return options.includeExported || !idea.exportedAt;
      });

      const exportedAt = new Date().toISOString();
      const markdown = buildMarkdownExport(readyThoughts, projectsById, exportedAt);
      const jsonl = readyThoughts
        .map((idea) =>
          JSON.stringify({
            id: idea.id,
            projectId: idea.projectId,
            projectName: projectsById.get(idea.projectId)?.name ?? "Unknown Project",
            createdAt: idea.createdAt,
            durationMs: idea.durationMs,
            transcript: idea.transcript
          })
        )
        .join("\n");

      await fs.mkdir(this.rootExportDir, { recursive: true });
      const markdownPath = path.join(this.rootExportDir, "codex-thoughts.md");
      const jsonlPath = path.join(this.rootExportDir, "codex-thoughts.jsonl");
      await Promise.all([
        fs.writeFile(markdownPath, markdown, "utf8"),
        fs.writeFile(jsonlPath, jsonl ? `${jsonl}\n` : "", "utf8")
      ]);

      const exportedIds = new Set(readyThoughts.map((idea) => idea.id));
      for (const idea of store.ideas) {
        if (exportedIds.has(idea.id)) {
          idea.exportedAt = exportedAt;
        }
      }

      return {
        markdownPath,
        jsonlPath,
        markdown,
        jsonl,
        exportedThoughtIds: Array.from(exportedIds)
      };
    });
  }

  private async readStore(): Promise<StoreFile> {
    const raw = await fs.readFile(this.storePath, "utf8");
    return JSON.parse(raw) as StoreFile;
  }

  private async writeStore(store: StoreFile): Promise<void> {
    const tempPath = `${this.storePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(normalizeStore(store), null, 2), "utf8");
    await fs.rename(tempPath, this.storePath);
  }

  private async mutate<T>(fn: (store: StoreFile) => T | Promise<T>): Promise<T> {
    const store = await this.readStore();
    const result = await fn(store);
    await this.writeStore(store);
    return result;
  }
}

function normalizeStore(store: StoreFile): StoreFile {
  return {
    projects: [...store.projects].sort((a, b) => a.sortOrder - b.sortOrder),
    ideas: [...store.ideas].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  };
}

function cleanProjectName(name: string | undefined): string {
  return name?.trim().replace(/\s+/g, " ") ?? "";
}

function nextUntitledProjectName(projects: ProjectRecord[]): string {
  const names = new Set(projects.map((project) => project.name));
  let index = 1;
  while (names.has(`Untitled Project ${index}`)) {
    index += 1;
  }
  return `Untitled Project ${index}`;
}

function nextSortOrder(projects: ProjectRecord[]): number {
  return projects.reduce((max, project) => Math.max(max, project.sortOrder), -1) + 1;
}

function findProject(store: StoreFile, projectId: string): ProjectRecord {
  const project = store.projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    throw Object.assign(new Error("Project not found"), { statusCode: 404 });
  }
  return project;
}

function findIdea(store: StoreFile, ideaId: string): IdeaRecord {
  const idea = store.ideas.find((candidate) => candidate.id === ideaId);
  if (!idea) {
    throw Object.assign(new Error("Idea not found"), { statusCode: 404 });
  }
  return idea;
}

function addIdeaFiles(files: Set<string>, idea: IdeaRecord): void {
  files.add(idea.originalAudioPath);
  if (idea.normalizedAudioPath) {
    files.add(idea.normalizedAudioPath);
  }
}

function readyThoughtKey(ideas: IdeaRecord[]): string {
  const hash = createHash("sha256");
  for (const idea of ideas) {
    hash.update(idea.id);
    hash.update("\0");
    hash.update(idea.transcript ?? "");
    hash.update("\0");
  }
  return hash.digest("hex");
}

function buildMarkdownExport(
  ideas: IdeaRecord[],
  projectsById: Map<string, ProjectRecord>,
  exportedAt: string
): string {
  const lines = [`# Codex Thoughts`, "", `Exported: ${exportedAt}`, ""];
  const thoughtsByProject = new Map<string, IdeaRecord[]>();

  for (const idea of ideas) {
    const projectIdeas = thoughtsByProject.get(idea.projectId) ?? [];
    projectIdeas.push(idea);
    thoughtsByProject.set(idea.projectId, projectIdeas);
  }

  for (const [projectId, projectIdeas] of thoughtsByProject) {
    lines.push(`## ${projectsById.get(projectId)?.name ?? "Unknown Project"}`, "");
    for (const idea of projectIdeas) {
      lines.push(`- ${idea.transcript?.trim() ?? ""}`);
    }
    lines.push("");
  }

  if (ideas.length === 0) {
    lines.push("_No ready, unexported thoughts matched this export._", "");
  }

  return lines.join("\n");
}
