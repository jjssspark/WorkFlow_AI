import { addDays, differenceInCalendarDays, formatISO, parseISO } from "date-fns";
import type { MilestoneInput } from "./roadmapApi";

export const CAPSTONE_STAGE_TITLES = [
  "요구사항 분석",
  "기획 및 설계",
  "핵심 기능 개발",
  "통합 및 테스트",
  "결과물 및 발표 준비",
] as const;

export function buildCapstoneMilestones(startDate: string, dueDate: string): MilestoneInput[] {
  const start = parseISO(startDate);
  const due = parseISO(dueDate);
  const totalDays = Math.max(1, differenceInCalendarDays(due, start) + 1);

  return CAPSTONE_STAGE_TITLES.map((title, index) => {
    const startOffset = Math.min(totalDays - 1, Math.floor(index * totalDays / CAPSTONE_STAGE_TITLES.length));
    const nextOffset = Math.floor((index + 1) * totalDays / CAPSTONE_STAGE_TITLES.length);
    const dueOffset = Math.min(totalDays - 1, Math.max(startOffset, nextOffset - 1));
    return {
      title,
      startDate: formatISO(addDays(start, startOffset), { representation: "date" }),
      dueDate: formatISO(addDays(start, dueOffset), { representation: "date" }),
    };
  });
}
