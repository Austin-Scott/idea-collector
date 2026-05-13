import fs from "node:fs";
import OpenAI from "openai";
import { readOpenAIApiKey } from "./config.js";
import { apiKeyPath } from "./paths.js";

export async function transcribeAudio(filePath: string, model: string): Promise<string> {
  const apiKey = await readOpenAIApiKey();
  if (!apiKey) {
    throw new Error(`Missing OpenAI API key. Put it in ${apiKeyPath}.`);
  }

  const client = new OpenAI({ apiKey });
  const result = await client.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model
  });

  return result.text.trim();
}
