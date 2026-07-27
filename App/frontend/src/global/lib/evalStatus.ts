// 심사자 평가 상태의 표기·색상 단일 출처.
// 백엔드가 같은 값을 두 표기로 내보낸다 — ReviewerService는 EvalStatus.toJson()으로
// 소문자("pending"), ProjectResponse는 enum name()으로 대문자("PENDING").
// 화면마다 다른 표기를 받으므로 resolveEvalStatus로 대문자 하나로 정규화해서 쓴다.

export type EvalStatus = "PENDING" | "EVALUATING" | "DONE" | "PUBLISHED";

export const EVAL_STATUS_META: Record<
  EvalStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  PENDING: { label: "평가 전", color: "#64748B", bg: "#F1F5F9", border: "#E2E8F0" },
  EVALUATING: { label: "평가 중", color: "#D97706", bg: "#FEF3C7", border: "#FDE68A" },
  DONE: { label: "평가 완료", color: "#2563EB", bg: "#DBEAFE", border: "#BFDBFE" },
  PUBLISHED: { label: "공개 완료", color: "#059669", bg: "#D1FAE5", border: "#A7F3D0" },
};

const EVAL_STATUSES = Object.keys(EVAL_STATUS_META) as EvalStatus[];

/** 대소문자 어느 표기로 와도 대문자 EvalStatus로 맞춘다. 값이 없거나 모르는 값이면 PENDING. */
export function resolveEvalStatus(value: string | null | undefined): EvalStatus {
  const normalized = (value ?? "").toUpperCase();
  return EVAL_STATUSES.find((status) => status === normalized) ?? "PENDING";
}
