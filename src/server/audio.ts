import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { audioNormalizedDir } from "./paths.js";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string | null;
const openAISupportedExtensions = new Set([".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm"]);

export async function normalizeAudio(inputPath: string, ideaId: string): Promise<string> {
  const outputPath = path.join(audioNormalizedDir, `${ideaId}.wav`);

  if (ffmpegPath) {
    await runFfmpeg(inputPath, outputPath);
    return outputPath;
  }

  if (openAISupportedExtensions.has(path.extname(inputPath).toLowerCase())) {
    return inputPath;
  }

  throw new Error("Audio normalization requires ffmpeg for this recording format.");
}

function runFfmpeg(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg binary was not found."));
      return;
    }

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
