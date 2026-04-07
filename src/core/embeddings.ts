/**
 * Embeddings module - Ollama qwen3-embedding integration
 *
 * API: POST http://localhost:11434/api/embeddings
 * Request: { "model": "qwen3-embedding:latest", "prompt": "text" }
 * Response: { "embedding": number[] }
 */

const OLLAMA_URL = "http://localhost:11434/api/embeddings";
const DEFAULT_MODEL = "qwen3-embedding:latest";

export interface Chunk {
  index: number;
  text: string;
  header: string; // section header if found
}

/**
 * Call Ollama embeddings API
 */
export async function embed(text: string, model = DEFAULT_MODEL): Promise<Float32Array> {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { embedding: number[] };
  return new Float32Array(data.embedding);
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("Vector dimensions must match");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  return dotProduct / denom;
}

/**
 * Split content into chunks by ## section headers
 */
export function splitIntoChunks(content: string): Chunk[] {
  const chunks: Chunk[] = [];

  if (!content || content.trim() === "") {
    return chunks;
  }

  // Split by ## headers (but not ### or deeper)
  // Match ## at start of line or after newline
  const sectionRegex = /(?:^|\n)(## [^#][^\n]*)\n/;
  const parts = content.split(sectionRegex);

  // parts[0] = before first ## (might be empty or intro text)
  // parts[1] = first ## header
  // parts[2] = content until next ##

  let currentIndex = 0;

  // If there's content before the first ##, make it chunk 0
  if (parts[0] && parts[0].trim()) {
    chunks.push({
      index: currentIndex++,
      text: parts[0].trim(),
      header: "",
    });
  }

  // Process pairs: [header, content]
  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i]?.replace(/^## /, "").trim() ?? "";
    const bodyContent = parts[i + 1] ?? "";

    if (bodyContent.trim()) {
      chunks.push({
        index: currentIndex++,
        text: bodyContent.trim(),
        header,
      });
    }
  }

  return chunks;
}

/**
 * Embed a single chunk, returns the Float32Array bytes (for BLOB storage)
 */
export async function embedToBytes(text: string, model = DEFAULT_MODEL): Promise<Uint8Array> {
  const embedding = await embed(text, model);
  // Convert Float32Array to Uint8Array (bytes) for BLOB storage
  const bytes = new Uint8Array(embedding.buffer);
  return bytes;
}
