export interface KanbanCard {
  title: string;
  tags: string[];
  due?: string;
  priority?: "low" | "medium" | "high" | "asap";
  created: string;
  mtime?: number; // file modification time (ms)
  recur?: "daily" | "weekly" | "monthly";
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

export interface RecurringTask {
  id: string;
  boardId: string;
  title: string;
  tags: string[];
  priority?: "low" | "medium" | "high" | "asap";
  content?: string;
  checklist?: string[];    // 체크리스트 항목 텍스트 목록 (생성 시 전부 미체크)
  dueDaysOffset?: number;  // 생성일 기준 N일 후 마감 (0 또는 undefined = 없음)
  recur: "daily" | "weekly" | "monthly";
  dayOfWeek?: number;  // 0=일, 1=월, ..., 6=토 (weekly 전용)
  dayOfMonth?: number; // 1~31 (monthly 전용)
  targetColumnId: string;
  lastCreated?: string; // ISO — 마지막 카드 생성 시각
}

export interface KanbanSettings {
  boards: KanbanBoard[];
  activeBoardId: string;
  upcomingDays: number[];
  recurringTasks: RecurringTask[];
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
  recurringTasks: [],
};
