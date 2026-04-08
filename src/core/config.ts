import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface OllamaConfig {
  url: string;
  embedding_model: string;
  chat_model: string;
}

export interface Config {
  ollama: OllamaConfig;
}

const DEFAULT_CONFIG: Config = {
  ollama: {
    url: "http://localhost:11434",
    embedding_model: "qwen3-embedding:latest",
    chat_model: "qwen3:latest",
  },
};

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const configPath = join(homedir(), ".gbrain", "config.toml");
  if (!existsSync(configPath)) {
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }

  // Simple TOML parse — read, extract [ollama] section
  const content = Bun.file(configPath).text();
  const config: Config = { ...DEFAULT_CONFIG };

  const urlMatch = content.match(/^\s*url\s*=\s*["']([^"']+)["']/m);
  if (urlMatch) config.ollama.url = urlMatch[1];

  const embedMatch = content.match(/^\s*embedding_model\s*=\s*["']([^"']+)["']/m);
  if (embedMatch) config.ollama.embedding_model = embedMatch[1];

  const chatMatch = content.match(/^\s*chat_model\s*=\s*["']([^"']+)["']/m);
  if (chatMatch) config.ollama.chat_model = chatMatch[1];

  cachedConfig = config;
  return config;
}

export function getConfig(): Config {
  return loadConfig();
}