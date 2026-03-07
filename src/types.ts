export interface KanbanCard {
  title: string;
  tags: string[];
  due?: string;
  priority?: "low" | "medium" | "high";
  created: string;
  content: string;
  filePath: string;
  status: ColumnStatus;
}

export type ColumnStatus = "todo" | "doing" | "done";

export interface KanbanSettings {
  boardFolder: string;
}

export const DEFAULT_SETTINGS: KanbanSettings = {
  boardFolder: "Kanban",
};

export const COLUMN_CONFIG: {
  id: ColumnStatus;
  label: string;
  folderName: string;
}[] = [
  { id: "todo", label: "TO-DO", folderName: "todo" },
  { id: "doing", label: "IN PROGRESS", folderName: "doing" },
  { id: "done", label: "DONE", folderName: "done" },
];
