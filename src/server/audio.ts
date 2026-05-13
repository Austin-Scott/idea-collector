import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { audioNormalizedDir } from "./paths.js";

const require = createRequire(import.meta.url);
const openAISupportedExtensions = new Set([".flac", ".m4a", ".mp3", ".mp4", ".mpeg", ".mpga", ".oga", ".ogg", ".wav", ".webm"]);
const openAISupportedMimeTypeExtensions = new Map([
  ["audio/flac", ".flac"],
  ["audio/m4a", ".m4a"],
  ["audio/mp3", ".mp3"],
  ["audio/mp4", ".mp4"],
  ["audio/mpeg", ".mp3"],
  ["audio/mpga", ".mpga"],
  ["audio/ogg", ".ogg"],
  ["audio/wav", ".wav"],
  ["audio/webm", ".webm"],
  ["audio/x-flac", ".flac"],
  ["audio/x-m4a", ".m4a"],
  ["audio/x-wav", ".wav"]
]);
let systemFfmpegPathPromise: Promise<string | null> | undefined;

export async function normalizeAudio(inputPath: string, ideaId: string, mimeType?: string): Promise<string> {
  const outputPath = path.join(audioNormalizedDir, `${ideaId}.wav`);
  const ffmpegPath = await resolveFfmpegPath();

  if (ffmpegPath) {
    await runFfmpeg(ffmpegPath, inputPath, outputPath);
    return outputPath;
  }

  if (isOpenAISupportedAudio(inputPath, mimeType)) {
    return inputPath;
  }

  throw new Error("Audio normalization requires ffmpeg for this recording format.");
}

export function extensionForAudioMimeType(mimeType: string | undefined): string {
  return openAISupportedMimeTypeExtensions.get(mediaType(mimeType)) ?? "";
}

export function isOpenAISupportedAudioExtension(extension: string): boolean {
  return openAISupportedExtensions.has(extension.toLowerCase());
}

function isOpenAISupportedAudio(inputPath: string, mimeType: string | undefined): boolean {
  return isOpenAISupportedAudioExtension(path.extname(inputPath)) || extensionForAudioMimeType(mimeType) !== "";
}

async function resolveFfmpegPath(): Promise<string | null> {
  const configuredPath = process.env.FFMPEG_PATH?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const bundledPath = resolveBundledFfmpegPath();
  if (bundledPath) {
    return bundledPath;
  }

  systemFfmpegPathPromise ??= hasSystemFfmpeg().then((available) => available ? "ffmpeg" : null);
  return systemFfmpegPathPromise;
}

function resolveBundledFfmpegPath(): string | null {
  try {
    const bundledPath = require("ffmpeg-static") as string | null;
    return bundledPath && bundledPath.length > 0 ? bundledPath : null;
  } catch {
    return null;
  }
}

function mediaType(mimeType: string | undefined): string {
  return mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function hasSystemFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      settle(false);
    }, 3000);

    function settle(available: boolean): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(available);
    }

    child.on("error", () => settle(false));
    child.on("close", (code) => settle(code === 0));
  });
}

function runFfmpeg(ffmpegPath: string, inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      outputPath
    ]);

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  });
}
