// Core types for GBrain

export interface Page {
  id: number;
  slug: string;
  type: string;
  title: string;
  compiled_truth: string;
  timeline: string;
  frontmatter: string; // JSON string
  created_at: string;
  updated_at: string;
}

export interface PageEmbedding {
  id: number;
  page_id: number;
  chunk_index: number;
  chunk_text: string;
  embedding: Blob;
  model: string;
  created_at: string;
}

export interface Link {
  id: number;
  from_page_id: number;
  to_page_id: number;
  context: string;
  created_at: string;
}

export interface Tag {
  id: number;
  page_id: number;
  tag: string;
}

export interface RawData {
  id: number;
  page_id: number;
  source: string;
  data: string; // JSON string
  fetched_at: string;
}

export interface TimelineEntry {
  id: number;
  page_id: number;
  date: string;
  source: string;
  summary: string;
  detail: string;
  created_at: string;
}

export interface IngestLog {
  id: number;
  source_type: string;
  source_ref: string;
  pages_updated: string; // JSON array
  summary: string;
  timestamp: string;
}

export interface Config {
  key: string;
  value: string;
}

export interface SearchResult {
  slug: string;
  title: string;
  type: string;
  compiled_truth: string;
  timeline: string;
  score: number;
}

export interface Stats {
  total_pages: number;
  pages_by_type: Record<string, number>;
  total_links: number;
  total_tags: number;
  total_embeddings: number;
  db_size_bytes: number;
}
