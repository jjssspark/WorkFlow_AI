import type { Priority } from "../../../board/libs/types/task";

export interface Meeting {
  id: string; title: string; date: string; duration: string; status: "processed" | "processing" | "pending" | "failed";
  summary?: string; decisions?: string[]; todos?: string[]; risks?: string[];
  analysisSource?: "fastapi" | "spring-fallback";
  fileName?: string;
  uploadedAt?: string;
  analyzedAt?: string;
  savedAt?: string | null;
  originalMeetingId?: string | null;
  tasksRegistered?: boolean;
}

export type UploadFlow = null | "modal" | "analyzing" | "results" | "review" | "done";
export type UploadType = null | "document" | "audio";

export interface GenTodo {
  id: string; title: string; desc: string; category: string;
  assignee: string; dueDate: string; priority: Priority; basis: string; assigned: boolean;
  source?: "MEETING_AI" | "MANUAL" | "LEADER_MANUAL";
}

export interface SavedMeetingRecord {
  meetingId: string;
  title: string;
  meetingDate: string;
  meetingKind: string;
  participants: string[];
  originalFileName: string;
  fileType: UploadType;
  summary: string;
  decisions: string[];
  risks: string[];
  actionItems: GenTodo[];
  createdAt: string;
  source: "MEETING_AI";
}

export interface ExportablePdfData {
  title: string;
  date: string;
  kind: string;
  participantNames: string[];
  summary: string;
  decisions: string[];
  todos: { title: string; assigneeName: string; dueDate: string }[];
  risks: string[];
}
