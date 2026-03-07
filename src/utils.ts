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

export interface ChecklistItem {
  text: string;
  checked: boolean;
}

/** content에서 `- [ ] / - [x]` 줄을 파싱. 나머지 텍스트도 반환. */
export function parseChecklist(content: string): { items: ChecklistItem[]; text: string } {
  const lines = content.split("\n");
  const items: ChecklistItem[] = [];
  const textLines: string[] = [];
  for (const line of lines) {
    const m = line.match(/^- \[([x ])\] (.+)/);
    if (m) {
      items.push({ checked: m[1] === "x", text: m[2] });
    } else {
      textLines.push(line);
    }
  }
  return { items, text: textLines.join("\n").trim() };
}

export function formatChecklist(items: ChecklistItem[]): string {
  return items.map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`).join("\n");
}

export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}달 전`;
  return `${Math.floor(months / 12)}년 전`;
}

export function priorityToNum(p?: string): number {
  const map: Record<string, number> = { asap: 0, high: 1, medium: 2, low: 3 };
  return map[p ?? "medium"] ?? 2;
}
