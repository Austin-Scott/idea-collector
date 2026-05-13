import { promises as fs } from "node:fs";
import { apiKeyPath, configPath } from "./paths.js";

export interface LocalConfig {
  port: number;
  transcriptionModel: string;
  projectNameModel: string;
  minRecordingMs: number;
}

const defaultConfig: LocalConfig = {
  port: 3443,
  transcriptionModel: "gpt-4o-transcribe",
  projectNameModel: "gpt-4o-mini",
  minRecordingMs: 650
};

export async function readLocalConfig(): Promise<LocalConfig> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalConfig>;

    return {
      port: numberOrDefault(parsed.port, defaultConfig.port),
      transcriptionModel: stringOrDefault(parsed.transcriptionModel, defaultConfig.transcriptionModel),
      projectNameModel: stringOrDefault(parsed.projectNameModel, defaultConfig.projectNameModel),
      minRecordingMs: numberOrDefault(parsed.minRecordingMs, defaultConfig.minRecordingMs)
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultConfig;
    }

    throw error;
  }
}

export async function readOpenAIApiKey(): Promise<string | null> {
  try {
    const value = await fs.readFile(apiKeyPath, "utf8");
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}
