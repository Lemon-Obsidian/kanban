export interface KanbanCard {
  title: string;
  tags: string[];
  due?: string;
  priority?: "low" | "medium" | "high";
  created: string;
  content: string;
  filePath: string;
  status: string; // column id
}

export interface KanbanColumn {
  id: string;    // subfolder name
  label: string; // display name
}

export interface KanbanSettings {
  boardFolder: string;
  columns: KanbanColumn[];
}

export const DEFAULT_SETTINGS: KanbanSettings = {
  boardFolder: "Kanban",
  columns: [
    { id: "todo", label: "TO-DO" },
    { id: "doing", label: "IN PROGRESS" },
    { id: "done", label: "DONE" },
  ],
};
