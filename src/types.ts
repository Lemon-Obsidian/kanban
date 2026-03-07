export interface KanbanCard {
  title: string;
  tags: string[];
  due?: string;
  priority?: "low" | "medium" | "high" | "asap";
  created: string;
  mtime?: number; // file modification time (ms)
  content: string;
  filePath: string;
  status: string; // column id
}

export interface ArchivedCard extends KanbanCard {
  flushedAt: string;  // ISO timestamp
  flushedFrom: string; // original column id
}

export interface KanbanColumn {
  id: string;        // subfolder name
  label: string;     // display name
  flushable?: boolean;
}

export interface KanbanBoard {
  id: string;
  name: string;
  folder: string;
  columns: KanbanColumn[];
}

export interface KanbanSettings {
  boards: KanbanBoard[];
  activeBoardId: string;
  upcomingDays: number[];
}

export const DEFAULT_BOARD: KanbanBoard = {
  id: "default",
  name: "기본 보드",
  folder: "Kanban",
  columns: [
    { id: "todo",        label: "TO-DO",       flushable: false },
    { id: "in-progress", label: "IN PROGRESS", flushable: false },
    { id: "done",        label: "DONE",        flushable: true  },
  ],
};

export const DEFAULT_SETTINGS: KanbanSettings = {
  boards: [DEFAULT_BOARD],
  activeBoardId: "default",
  upcomingDays: [1, 7, 30],
};
