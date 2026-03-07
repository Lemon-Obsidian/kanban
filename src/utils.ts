export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF가-힣-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function parseTags(input: string): string[] {
  const matches = input.match(/#[\w\u00C0-\u024F\u1E00-\u1EFF가-힣-]+/g) || [];
  return [...new Set(matches.map((tag) => tag.slice(1)))];
}

export function formatTags(tags: string[]): string {
  return tags.map((tag) => `#${tag}`).join(" ");
}
