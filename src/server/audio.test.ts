import { describe, expect, it } from "vitest";
import { extensionForAudioMimeType, isOpenAISupportedAudioExtension } from "./audio";

describe("audio helpers", () => {
  it("maps recorder mime types to OpenAI-supported extensions", () => {
    expect(extensionForAudioMimeType("audio/webm;codecs=opus")).toBe(".webm");
    expect(extensionForAudioMimeType("audio/ogg")).toBe(".ogg");
    expect(extensionForAudioMimeType("audio/mp4")).toBe(".mp4");
    expect(extensionForAudioMimeType("audio/wav")).toBe(".wav");
  });

  it("recognizes supported audio filename extensions", () => {
    expect(isOpenAISupportedAudioExtension(".webm")).toBe(true);
    expect(isOpenAISupportedAudioExtension(".OGG")).toBe(true);
    expect(isOpenAISupportedAudioExtension(".audio")).toBe(false);
  });
});
