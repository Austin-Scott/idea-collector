import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdeaStore } from "./storage";

const testRoot = path.join(process.cwd(), ".test-data");
let dataDir: string;
let exportDir: string;

beforeEach(async () => {
  await fs.mkdir(testRoot, { recursive: true });
  dataDir = await fs.mkdtemp(path.join(testRoot, "data-"));
  exportDir = await fs.mkdtemp(path.join(testRoot, "exports-"));
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe("IdeaStore", () => {
  it("seeds five projects", async () => {
    const store = new IdeaStore(dataDir, exportDir);
    await store.init();

    const snapshot = await store.snapshot();

    expect(snapshot.projects.map((project) => project.name)).toEqual([
      "Project 1",
      "Project 2",
      "Project 3",
      "Project 4",
      "Project 5"
    ]);
  });

  it("creates a new untitled project and stores an idea", async () => {
    const store = new IdeaStore(dataDir, exportDir);
    await store.init();

    const project = await store.createProject();
    const idea = await store.createIdea({
      projectId: project.id,
      durationMs: 1200,
      originalAudioPath: "data/audio/original/test.webm",
      originalMimeType: "audio/webm"
    });

    expect(project.name).toBe("Untitled Project 1");
    expect(idea.status).toBe("pending");
    expect((await store.snapshot()).ideas).toHaveLength(1);
  });

  it("exports ready thoughts and marks them exported", async () => {
    const store = new IdeaStore(dataDir, exportDir);
    await store.init();
    const project = (await store.snapshot()).projects[0];
    const idea = await store.createIdea({
      projectId: project.id,
      durationMs: 1500,
      originalAudioPath: "data/audio/original/test.webm",
      originalMimeType: "audio/webm"
    });
    await store.updateIdea(idea.id, {
      status: "ready",
      transcript: "Build a tiny app that collects field notes."
    });

    const result = await store.exportIdeas();
    const exportedIdea = (await store.getIdea(idea.id));

    expect(result.markdown).toContain("Build a tiny app");
    expect(result.exportedThoughtIds).toEqual([idea.id]);
    expect(exportedIdea.exportedAt).toBeTruthy();
    await expect(fs.readFile(result.markdownPath, "utf8")).resolves.toContain("# Codex Thoughts");
  });

  it("locks manually renamed projects but not automatic names", async () => {
    const store = new IdeaStore(dataDir, exportDir);
    await store.init();
    const project = (await store.snapshot()).projects[0];

    const autoNamed = await store.autoRenameProject(project.id, "Chore Capture", "thought-key-1");
    const manuallyNamed = await store.renameProject(project.id, "Kitchen Notes");
    const ignoredAutoName = await store.autoRenameProject(project.id, "Dish Ideas", "thought-key-2");

    expect(autoNamed.name).toBe("Chore Capture");
    expect(autoNamed.nameLocked).toBeFalsy();
    expect(autoNamed.autoNameThoughtKey).toBe("thought-key-1");
    expect(manuallyNamed.nameLocked).toBe(true);
    expect(ignoredAutoName.name).toBe("Kitchen Notes");
  });

  it("skips automatic renames when the thought key is unchanged", async () => {
    const store = new IdeaStore(dataDir, exportDir);
    await store.init();
    const project = (await store.snapshot()).projects[0];

    await store.autoRenameProject(project.id, "First Name", "same-thoughts");
    const unchanged = await store.autoRenameProject(project.id, "Second Name", "same-thoughts");

    expect(unchanged.name).toBe("First Name");
  });

  it("deletes a project and its thoughts", async () => {
    const store = new IdeaStore(dataDir, exportDir);
    await store.init();
    const project = (await store.snapshot()).projects[0];
    const idea = await store.createIdea({
      projectId: project.id,
      durationMs: 1200,
      originalAudioPath: path.join(dataDir, "audio", "original", "test.webm"),
      originalMimeType: "audio/webm"
    });

    const result = await store.deleteProject(project.id);
    const snapshot = await store.snapshot();

    expect(result.deletedProjectId).toBe(project.id);
    expect(result.deletedThoughtIds).toEqual([idea.id]);
    expect(snapshot.projects.some((candidate) => candidate.id === project.id)).toBe(false);
    expect(snapshot.ideas.some((candidate) => candidate.projectId === project.id)).toBe(false);
  });

  it("deletes one thought and leaves the project in place", async () => {
    const store = new IdeaStore(dataDir, exportDir);
    await store.init();
    const project = (await store.snapshot()).projects[0];
    const originalAudioPath = path.join(dataDir, "audio", "original", "delete-me.webm");
    const normalizedAudioPath = path.join(dataDir, "audio", "normalized", "delete-me.wav");
    await fs.writeFile(originalAudioPath, "original");
    await fs.writeFile(normalizedAudioPath, "normalized");
    const idea = await store.createIdea({
      projectId: project.id,
      durationMs: 1200,
      originalAudioPath,
      originalMimeType: "audio/webm"
    });
    await store.updateIdea(idea.id, { normalizedAudioPath });

    const result = await store.deleteIdea(idea.id);
    const snapshot = await store.snapshot();

    expect(result.deletedThoughtId).toBe(idea.id);
    expect(snapshot.projects.some((candidate) => candidate.id === project.id)).toBe(true);
    expect(snapshot.ideas.some((candidate) => candidate.id === idea.id)).toBe(false);
    await expect(fs.access(originalAudioPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(normalizedAudioPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
