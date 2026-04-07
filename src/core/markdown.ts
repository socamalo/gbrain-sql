import matter from "gray-matter";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface ParsedPage {
  slug: string;
  type: string;
  title: string;
  compiled_truth: string;
  timeline: string;
  frontmatter: Record<string, any>;
}

export function parseMarkdownFile(content: string, filePath: string): ParsedPage {
  // Parse frontmatter with gray-matter
  const { data, content: body } = matter(content);

  // Determine type from frontmatter or default
  const type = data.type || "concept";

  // Split at horizontal rule (---) to separate compiled_truth from timeline
  const hrIndex = body.search(/\n---\n/);
  let compiledTruth: string;
  let timeline: string;

  if (hrIndex !== -1) {
    compiledTruth = body.substring(0, hrIndex).trim();
    timeline = body.substring(hrIndex + 5).trim(); // skip \n---\n
  } else {
    compiledTruth = body.trim();
    timeline = "";
  }

  // Extract title from first H1 or frontmatter
  const title = data.title || extractTitle(compiledTruth) || filePath.split("/").pop()?.replace(/\.md$/, "") || "Untitled";

  // Build slug from file path
  const slug = filePath.replace(/\.md$/, "");

  return {
    slug,
    type,
    title,
    compiled_truth: compiledTruth,
    timeline,
    frontmatter: data
  };
}

export function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Extract all ## section headings from content, in document order.
 */
export function extractAgenda(content: string): string[] {
  const agenda: string[] = [];
  // Match ## at start of line (but not ### or deeper)
  const regex = /^## ([^#][^\n]*)$/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    agenda.push(match[1].trim());
  }
  return agenda;
}

export function renderPage(
  title: string,
  type: string,
  compiledTruth: string,
  timeline: string,
  frontmatter: Record<string, any>
): string {
  // Build frontmatter
  const fm: Record<string, any> = { ...frontmatter, title, type };
  const fmYaml = stringifyYaml(fm);

  // Strip H1 from compiledTruth only if it matches title (to avoid duplicate)
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const compiledBody = compiledTruth.replace(
    new RegExp(`^#\\s+${escapedTitle}\\s*\\n+`, ''),
    ''
  );
  let body = `# ${title}\n\n${compiledBody}`;
  if (timeline) {
    body += `\n\n---\n\n${timeline}`;
  }

  return `---\n${fmYaml}---\n\n${body}`;
}

export function slugFromPath(filePath: string): string {
  return filePath.replace(/\.md$/, "").replace(/^[/\\]/, "");
}

export function extractLinks(content: string): { text: string; target: string }[] {
  // Extract wiki-style links: [Display Text](../path/to/page.md) or [Display Text](./path/to-page.md)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\.md\)/g;
  const links: { text: string; target: string }[] = [];
  let match;

  while ((match = linkRegex.exec(content)) !== null) {
    const text = match[1];
    let target = match[2];
    // Resolve relative paths
    if (target.startsWith("../")) {
      target = target.substring(3);
    }
    links.push({ text, target });
  }

  return links;
}

export function extractTimelineEntries(timeline: string): { date: string; source: string; summary: string; detail: string }[] {
  const entries: { date: string; source: string; summary: string; detail: string }[] = [];

  // Parse timeline lines: - **YYYY-MM-DD** | Source — Summary. (Detail.)
  const lineRegex = /^- \*\*(\d{4}-\d{2}-\d{2})\*\*\s*\|\s*([^—]+)—\s*(.+)$/gm;
  let match;
  let lastIndex = 0;
  let currentEntry: any = null;

  const lines = timeline.split("\n");
  for (const line of lines) {
    const lineMatch = line.match(/^- \*\*(\d{4}-\d{2}-\d{2})\*\*\s*\|\s*([^—]+)—\s*(.+)$/);
    if (lineMatch) {
      if (currentEntry) {
        entries.push(currentEntry);
      }
      currentEntry = {
        date: lineMatch[1],
        source: lineMatch[2].trim(),
        summary: lineMatch[3].trim(),
        detail: ""
      };
    } else if (currentEntry && line.match(/^\s{2,}/)) {
      // Continuation line (indented)
      currentEntry.detail += (currentEntry.detail ? "\n" : "") + line.trim();
    }
  }
  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries;
}
