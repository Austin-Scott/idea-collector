import OpenAI from "openai";
import { readOpenAIApiKey } from "./config.js";
import { apiKeyPath } from "./paths.js";

export async function generateProjectName(transcripts: string[], model: string): Promise<string> {
  const apiKey = await readOpenAIApiKey();
  if (!apiKey) {
    throw new Error(`Missing OpenAI API key. Put it in ${apiKeyPath}.`);
  }

  const client = new OpenAI({ apiKey });
  const input = transcripts
    .slice(-12)
    .map((transcript, index) => `${index + 1}. ${transcript.trim()}`)
    .join("\n");

  const response = await client.responses.create({
    model,
    instructions: [
      "Name a software project from a short list of captured thoughts.",
      "Return only a concise title, 2 to 5 words.",
      "Use title case. Do not include punctuation, quotation marks, or explanations."
    ].join(" "),
    input,
    max_output_tokens: 24
  });

  return cleanGeneratedName(response.output_text);
}

function cleanGeneratedName(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`.]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 64);
}
