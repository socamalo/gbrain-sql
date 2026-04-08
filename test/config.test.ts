import { describe, test, expect } from "bun:test";

describe("loadConfig", () => {
  test("returns default config when no config file exists", async () => {
    const { loadConfig } = await import("../src/core/config");
    const config = loadConfig();
    expect(config.ollama.url).toBe("http://localhost:11434");
    expect(config.ollama.embedding_model).toBe("qwen3-embedding:latest");
    expect(config.ollama.chat_model).toBe("qwen3:latest");
  });
});