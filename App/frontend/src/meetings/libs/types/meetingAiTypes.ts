export type MeetingAiPriority = "HIGH" | "MEDIUM" | "LOW";

export interface MeetingAiTodo {
  title: string;
  description: string;
  assignee_candidate: string;
  assignee_id: string | null;
  start_date?: string | null;
  due_date: string | null;
  priority: MeetingAiPriority;
  category: string;
  needs_leader_review: boolean;
  evidence_text?: string;
}

export interface MeetingAiResult {
  summary: string;
  decisions: string[];
  todos: MeetingAiTodo[];
  risks: string[];
  keywords: string[];
  meeting_meta: {
    title: string;
    meeting_date: string;
    participants: string[];
  };
}
