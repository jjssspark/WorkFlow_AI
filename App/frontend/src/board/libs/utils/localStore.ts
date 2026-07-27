import type { Task } from "../types/task";
import type { Meeting, SavedMeetingRecord } from "../../../meetings/libs/types/meeting";
import { TASKS } from "../mock/tasks";
import { MEETINGS } from "../../../meetings/libs/mock/meetings";

export const TASK_STORAGE_KEY = "workflow-ai.tasks";
export const MEETING_STORAGE_KEY = "workflow-ai.meetings";
export const TASKS_UPDATED_EVENT = "workflow-ai:tasks-updated";
export const MEETINGS_UPDATED_EVENT = "workflow-ai:meetings-updated";
export const SAVED_MEETING_STORAGE_KEY = "workflow-ai.saved-meetings";
export const SAVED_MEETINGS_UPDATED_EVENT = "workflow-ai:saved-meetings-updated";
export const DELETED_MEETING_STORAGE_KEY = "workflow-ai.deleted-meetings";

function scopedKey(baseKey: string, projectId?: string | number): string {
  return projectId == null || String(projectId).trim() === "" ? baseKey : `${baseKey}.${projectId}`;
}

function readStoredArray<T>(key: string, fallback: T[]): T[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredArray<T>(key: string, eventName: string, value: T[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(eventName));
}

export const getStoredTasks = () => readStoredArray<Task>(TASK_STORAGE_KEY, TASKS);
export const getStoredMeetings = (projectId?: string | number) =>
  readStoredArray<Meeting>(scopedKey(MEETING_STORAGE_KEY, projectId), projectId == null ? MEETINGS : []);
export const saveStoredTasks = (tasks: Task[]) => writeStoredArray(TASK_STORAGE_KEY, TASKS_UPDATED_EVENT, tasks);
export const saveStoredMeetings = (meetings: Meeting[], projectId?: string | number) =>
  writeStoredArray(scopedKey(MEETING_STORAGE_KEY, projectId), MEETINGS_UPDATED_EVENT, meetings);

export const getSavedMeetings = (projectId?: string | number) =>
  readStoredArray<SavedMeetingRecord>(scopedKey(SAVED_MEETING_STORAGE_KEY, projectId), []);
export const saveSavedMeetings = (records: SavedMeetingRecord[], projectId?: string | number) =>
  writeStoredArray(scopedKey(SAVED_MEETING_STORAGE_KEY, projectId), SAVED_MEETINGS_UPDATED_EVENT, records);

export const getDeletedMeetingIds = (projectId?: string | number) =>
  new Set(readStoredArray<string>(scopedKey(DELETED_MEETING_STORAGE_KEY, projectId), []));

export const markDeletedMeeting = (meetingId: string, projectId?: string | number) => {
  const ids = getDeletedMeetingIds(projectId);
  ids.add(meetingId);
  writeStoredArray(scopedKey(DELETED_MEETING_STORAGE_KEY, projectId), MEETINGS_UPDATED_EVENT, [...ids]);
};

// 낙관적 삭제(서버 응답 전에 화면에서 먼저 제거)가 실패해 되돌릴 때 사용한다.
// 이 묘비를 지우지 않으면 서버 재조회가 해당 회의록을 다시 내려줘도 계속 걸러진다.
export const unmarkDeletedMeeting = (meetingId: string, projectId?: string | number) => {
  const ids = getDeletedMeetingIds(projectId);
  ids.delete(meetingId);
  writeStoredArray(scopedKey(DELETED_MEETING_STORAGE_KEY, projectId), MEETINGS_UPDATED_EVENT, [...ids]);
};
