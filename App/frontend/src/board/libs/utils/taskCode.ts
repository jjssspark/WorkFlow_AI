/**
 * 표시용 업무 코드. DB의 task id에서 파생하며 어디에도 저장하지 않는다.
 *
 * 저장하지 않는 이유: 저장하면 id와 코드가 어긋날 수 있는 상태가 생기지만,
 * 파생이면 어긋날 상태 자체가 없다. 접두사를 바꾸고 싶을 때도 이 파일만 고치면 된다.
 */
export const TASK_CODE_PREFIX = "TASK-";

export function taskCode(id: string): string {
  return id ? `${TASK_CODE_PREFIX}${id}` : "";
}
