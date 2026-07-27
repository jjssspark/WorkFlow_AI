import type { MeetingAiResult, MeetingAiTodo } from "../types/meetingAiTypes";
import { apiFetch } from "../../../global/api/apiClient";

interface AnalyzeMeetingParams {
  projectId: string;
  file: File | null;
  title: string;
  meetingDate: string;
  meetingKind: string;
  sourceType: "document" | "audio";
  participants: string[];
  attendeeIds?: number[];
}

export type MeetingAnalysisStatus = "PROCESSING" | "COMPLETED" | "FAILED";

export interface AttendeeSummary {
  id: number;
  name: string | null;
  role: string | null;
}

export interface MeetingAnalysisResponse {
  meetingId: string;
  projectId: string;
  status: MeetingAnalysisStatus;
  sourceType: string;
  fileName: string | null;
  analysisSource: "FASTAPI" | "SPRING_FALLBACK" | null;
  analysis: MeetingAiResult | null;
  errorMessage: string | null;
  attendees: AttendeeSummary[];
  transcript: string | null;
}

export async function analyzeMeeting(params: AnalyzeMeetingParams): Promise<MeetingAnalysisResponse> {
  const formData = new FormData();
  if (params.file) formData.append("file", params.file);
  formData.append("title", params.title);
  formData.append("meetingDate", params.meetingDate);
  formData.append("meetingKind", params.meetingKind);
  formData.append("sourceType", params.sourceType);
  params.participants.forEach(participant => formData.append("participants", participant));
  (params.attendeeIds ?? []).forEach(attendeeId => formData.append("attendeeIds", String(attendeeId)));

  return apiFetch<MeetingAnalysisResponse>(`/projects/${params.projectId}/meetings/analyze`, {
    method: "POST",
    body: formData,
  });
}

export interface MeetingAttendanceSummaryDto {
  userId: number;
  name: string | null;
  meetingsAttended: number;
  totalMeetings: number;
  attendanceRate: number;
}

export async function fetchAttendanceSummary(projectId: string): Promise<MeetingAttendanceSummaryDto[]> {
  return apiFetch<MeetingAttendanceSummaryDto[]>(`/projects/${projectId}/meetings/attendance-summary`);
}

export interface MeetingAttendanceDetailDto {
  meetingId: string;
  title: string;
  meetingDate: string | null;
  attended: boolean;
}

export async function fetchAttendanceDetail(projectId: string, userId: number): Promise<MeetingAttendanceDetailDto[]> {
  return apiFetch<MeetingAttendanceDetailDto[]>(`/projects/${projectId}/meetings/attendance-detail?userId=${userId}`);
}

export async function fetchMeeting(projectId: string, meetingId: string): Promise<MeetingAnalysisResponse> {
  return apiFetch<MeetingAnalysisResponse>(`/projects/${projectId}/meetings/${meetingId}`);
}

export interface MeetingDeleteResponse {
  meetingId: string;
  status: "DELETED";
}

const DELETE_MEETING_TIMEOUT_MS = 10000;

export async function deleteMeeting(projectId: string, meetingId: string, deleteLinkedTasks = false): Promise<MeetingDeleteResponse> {
  const query = new URLSearchParams({ deleteLinkedTasks: String(deleteLinkedTasks) });
  return apiFetch<MeetingDeleteResponse>(
    `/projects/${projectId}/meetings/${meetingId}?${query.toString()}`,
    { method: "DELETE" },
    true,
    DELETE_MEETING_TIMEOUT_MS
  );
}

export async function deleteMeetingAnalysis(projectId: string, meetingId: string, deleteLinkedTasks = false): Promise<MeetingDeleteResponse> {
  const query = new URLSearchParams({ deleteLinkedTasks: String(deleteLinkedTasks) });
  return apiFetch<MeetingDeleteResponse>(
    `/projects/${projectId}/meetings/${meetingId}/analysis?${query.toString()}`,
    { method: "DELETE" },
    true,
    DELETE_MEETING_TIMEOUT_MS
  );
}

export async function retryMeetingAnalysis(projectId: string, meetingId: string): Promise<MeetingAnalysisResponse> {
  return apiFetch<MeetingAnalysisResponse>(`/projects/${projectId}/meetings/${meetingId}/retry`, {
    method: "POST",
  });
}

export interface MeetingSummaryDto {
  meetingId: string;
  title: string;
  meetingDate: string | null;
  meetingType: string | null;
  analysisStatus: string;
  savedAt: string | null;
  originalMeetingId: string | null;
  tasksRegistered: boolean;
  hasGeneratedTodos: boolean;
}

export async function fetchMeetings(projectId: string): Promise<MeetingSummaryDto[]> {
  return apiFetch<MeetingSummaryDto[]>(`/projects/${projectId}/meetings`);
}

export interface TaskRegisterResponseDto {
  meetingId: string;
  registeredCount: number;
  boardStatus: string;
}

export async function registerMeetingTasks(
  projectId: string,
  meetingId: string,
  todos: MeetingAiTodo[]
): Promise<TaskRegisterResponseDto> {
  return apiFetch<TaskRegisterResponseDto>(`/projects/${projectId}/meetings/${meetingId}/tasks/register`, {
    method: "POST",
    body: JSON.stringify({ todos }),
  });
}

export interface MeetingSaveResponseDto {
  meetingId: string;
  status: "SAVED";
}

export async function confirmMeetingSave(projectId: string, meetingId: string): Promise<MeetingSaveResponseDto> {
  return apiFetch<MeetingSaveResponseDto>(`/projects/${projectId}/meetings/${meetingId}/save`, {
    method: "POST",
  });
}

export interface MeetingVersionResponseDto {
  meetingId: string;
  status: "SAVED" | "PROCESSING";
}

export async function createMeetingVersion(
  projectId: string,
  meetingId: string,
  transcript: string,
  triggerAnalysis: boolean
): Promise<MeetingVersionResponseDto> {
  return apiFetch<MeetingVersionResponseDto>(`/projects/${projectId}/meetings/${meetingId}/versions`, {
    method: "POST",
    body: JSON.stringify({ transcript, triggerAnalysis }),
  });
}

export async function reanalyzeMeeting(projectId: string, meetingId: string): Promise<MeetingVersionResponseDto> {
  return apiFetch<MeetingVersionResponseDto>(`/projects/${projectId}/meetings/${meetingId}/reanalyze`, {
    method: "POST",
  });
}
