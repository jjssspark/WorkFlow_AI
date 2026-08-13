# UI 위계 재설계 — 1주차 구현 계획

> **작업자 안내:** 이 계획은 한 작업씩 순서대로 실행한다. 각 단계는 체크박스(`- [ ]`)로 진행을 추적한다.

**목표:** 색 토큰을 단일 출처로 회수하고, 블로커 타임라인·계획선 게이지가 쓸 데이터를 백엔드에 만든다. 화면 재설계(2주차)가 시작될 수 있는 상태를 만드는 것이 1주차의 정의다.

**접근:** 프론트(A트랙)와 백엔드(B트랙)는 파일이 겹치지 않아 2인이 병렬로 진행한다. A트랙은 화면을 바꾸지 않고 색 체계만 정리한다 — 이 주차에 레이아웃을 건드리면 2주차 작업과 충돌한다.

**기술 스택:** React 19 · TypeScript 5.9 · Tailwind 4 · Vite 7 (pnpm) / Spring Boot 3.5 · Java 21 · Gradle · Flyway · PostgreSQL 17

**설계 근거:** [WorkFlow_AI_UI_위계_재설계.md](WorkFlow_AI_UI_위계_재설계.md)

---

## 전역 제약

이 아래 모든 작업에 적용된다.

- **상태색은 5개뿐이다.** 브랜드/완료 `#7048E8` · 진행 중 `#3B5BDB` · 블로커 `#E03131` · 마감 임박 `#F59E0B` · 할 일 무채색. **새 색을 만들지 않는다** — 다섯 값 모두 이미 `theme.css`에 있던 값의 역할 재배치다.
- **사람색은 6개뿐이다.** `#0F6B63` 청록 · `#A6376A` 자주 · `#7A5B2E` 황토 · `#5B6B33` 올리브 · `#5A5470` 회보라 · `#3E6076` 청회색. 채도를 낮춰 상태색과 경쟁하지 않게 한 값이다.
- **다크모드는 이번 범위 밖이다.** `theme.css`의 `.dark` 블록(44~80행)은 **건드리지 않는다.** 앱에 `.dark` 클래스를 켜는 코드가 없어 도달 불가능한 CSS이므로 방치해도 회귀가 없다.
- **레이아웃을 바꾸지 않는다.** 1주차는 색과 데이터만 다룬다.
- **이미 배포된 `V*.sql`은 절대 수정하지 않는다.** CI `migration-guard`가 차단한다. 스키마 변경은 새 파일로만 한다.
- 프론트 명령: `pnpm test`(vitest) · `pnpm typecheck` · `pnpm build` — 모두 `App/frontend`에서 실행
- 백엔드 명령: `./gradlew test` — `App/backend_spring`에서 실행
- 커밋 메시지는 한국어 현재형 한 줄 + 필요 시 본문 (기존 이력과 동일한 형식)

---

## 파일 구조

### A트랙 — 프론트엔드

| 파일 | 책임 | 작업 |
|---|---|---|
| `App/frontend/src/global/styles/theme.css` | 색·반경·폰트 토큰의 **단일 출처** | 수정 — 상태색·사람색 토큰 추가, primary/accent 역할 교체 |
| `App/frontend/src/global/lib/personColor.ts` | 사용자 ID → 사람색 배정 | **신규** |
| `App/frontend/src/global/lib/personColor.test.ts` | 위 테스트 | **신규** |
| `App/frontend/package.json` | 의존성 | 수정 — `@mui/*` 제거 |
| `src/dashboard/**`, `src/meetings/**` 등 52개 `.tsx` | 화면 | 수정 — 하드코딩 hex를 토큰 참조로 |

### B트랙 — 백엔드

| 파일 | 책임 | 작업 |
|---|---|---|
| `.../db/migration/V20260811_1__add_task_status_changed_at.sql` | 컬럼 추가 + 백필 | **신규** |
| `.../task/Task.java` | 업무 엔티티 | 수정 — `statusChangedAt` 필드 |
| `.../task/TaskController.java` | 상태 변경 경로 | 수정 — 상태가 바뀔 때 `statusChangedAt` 갱신 |
| `.../dashboard/DTO/BlockedTaskDto.java` | 막힌 업무 + 경과일 | **신규** |
| `.../dashboard/DTO/ProjectTimelineDto.java` | 계획선 계산 결과 | **신규** |
| `.../dashboard/DTO/DashboardSummaryResponse.java` | 대시보드 응답 | 수정 — 위 두 필드 추가 |
| `.../dashboard/service/DashboardService.java` | 집계 | 수정 |
| `src/test/java/com/workflowai/dashboard/BlockedTaskAgeTest.java` | 경과일 계산 테스트 | **신규** |
| `src/test/java/com/workflowai/dashboard/ProjectTimelineTest.java` | 계획선 계산 테스트 | **신규** |

---

# A트랙 — 프론트엔드

## Task A1: 상태색·사람색 토큰 정의

지금 `--primary`는 `#3B5BDB`(인디고블루), `--accent`는 `#7048E8`(보라)다. 설계에서 **브랜드를 보라로 확정**했으므로 두 값의 역할을 맞바꾸고, 상태색·사람색 토큰을 새로 정의한다.

**Files:**
- Modify: `App/frontend/src/global/styles/theme.css` (`:root` 블록, 3~42행)

**Interfaces:**
- Produces: CSS 변수 `--status-done` `--status-progress` `--status-blocked` `--status-due` `--status-todo`, `--person-1`~`--person-6`, `--person-1-bg`~`--person-6-bg`. 이후 모든 작업이 이 이름을 참조한다.

- [ ] **Step 1: 현재 값을 기록해 둔다**

작업 전 원본 값을 확인한다.

```bash
cd App/frontend
grep -nE '^\s*--(primary|accent|destructive|chart-4):' src/global/styles/theme.css
```

기대 출력:
```
  --primary: #3B5BDB;
  --accent: #7048E8;
  --destructive: #E03131;
  --chart-4: #F59E0B;
```

- [ ] **Step 2: `:root`의 primary/accent를 맞바꾼다**

`src/global/styles/theme.css`에서 아래 두 줄을 찾아 값만 교체한다. 줄 위치는 옮기지 않는다.

```css
/* 변경 전 */
  --primary: #3B5BDB;
  --accent: #7048E8;

/* 변경 후 */
  --primary: #7048E8;
  --accent: #3B5BDB;
```

같은 `:root` 블록의 `--secondary-foreground`와 `--ring`도 `#3B5BDB`를 값으로 갖고 있다. 둘 다 `#7048E8`로 바꾼다 — 이 둘은 브랜드색을 따라가는 파생 토큰이다.

```css
/* 변경 전 */
  --secondary-foreground: #3B5BDB;
  --ring: #3B5BDB;

/* 변경 후 */
  --secondary-foreground: #7048E8;
  --ring: #7048E8;
```

- [ ] **Step 3: 상태색 토큰을 추가한다**

`:root` 블록 안, `--sidebar-ring` 줄 바로 아래에 붙인다.

```css
  /* 상태색 — 의미 전달용. 이 5개 외의 색으로 상태를 표현하지 않는다. */
  --status-done: #7048E8;
  --status-done-bg: #F1ECFD;
  --status-progress: #3B5BDB;
  --status-progress-bg: #E9EDFB;
  --status-blocked: #E03131;
  --status-blocked-bg: #FDECEC;
  --status-due: #F59E0B;
  --status-due-bg: #FEF6E7;
  --status-todo: #C9C7D6;
  --status-todo-bg: #F4F4F8;
```

- [ ] **Step 4: 사람색 토큰을 추가한다**

바로 이어서 붙인다.

```css
  /* 사람색 — 식별용. 상태색보다 채도가 낮아야 하므로 이 6개 외에는 쓰지 않는다. */
  --person-1: #0F6B63;
  --person-1-bg: #E6F2F1;
  --person-2: #A6376A;
  --person-2-bg: #FBEAF1;
  --person-3: #7A5B2E;
  --person-3-bg: #F2EDE4;
  --person-4: #5B6B33;
  --person-4-bg: #EEF0E3;
  --person-5: #5A5470;
  --person-5-bg: #EDEBF3;
  --person-6: #3E6076;
  --person-6-bg: #E7EFF4;
```

- [ ] **Step 5: Tailwind에 토큰을 노출한다**

`@theme inline` 블록(81행부터)에 기존 토큰들이 `--color-*` 형태로 매핑돼 있다. 같은 형식으로 이어 붙인다.

```css
  --color-status-done: var(--status-done);
  --color-status-done-bg: var(--status-done-bg);
  --color-status-progress: var(--status-progress);
  --color-status-progress-bg: var(--status-progress-bg);
  --color-status-blocked: var(--status-blocked);
  --color-status-blocked-bg: var(--status-blocked-bg);
  --color-status-due: var(--status-due);
  --color-status-due-bg: var(--status-due-bg);
  --color-status-todo: var(--status-todo);
  --color-status-todo-bg: var(--status-todo-bg);
  --color-person-1: var(--person-1);
  --color-person-1-bg: var(--person-1-bg);
  --color-person-2: var(--person-2);
  --color-person-2-bg: var(--person-2-bg);
  --color-person-3: var(--person-3);
  --color-person-3-bg: var(--person-3-bg);
  --color-person-4: var(--person-4);
  --color-person-4-bg: var(--person-4-bg);
  --color-person-5: var(--person-5);
  --color-person-5-bg: var(--person-5-bg);
  --color-person-6: var(--person-6);
  --color-person-6-bg: var(--person-6-bg);
```

- [ ] **Step 6: 빌드와 타입 검사를 돌린다**

```bash
cd App/frontend
pnpm typecheck && pnpm build
```

기대: 둘 다 성공. CSS 변수 추가는 타입에 영향이 없으므로 실패하면 오타다.

- [ ] **Step 7: 화면을 눈으로 확인한다**

```bash
cd App/frontend && pnpm dev
```

로그인 화면과 대시보드를 연다. **버튼·활성 메뉴가 파랑에서 보라로 바뀌어 있어야 한다.** 안 바뀐 곳이 있으면 그 파일이 `--primary`가 아니라 hex를 직접 쓰고 있다는 뜻이다 — Task A4에서 처리하므로 지금은 목록만 적어 둔다.

- [ ] **Step 8: 커밋**

```bash
git add App/frontend/src/global/styles/theme.css
git commit -m "style: 브랜드색을 보라로 바꾸고 상태색·사람색 토큰을 정의한다

primary(#3B5BDB)와 accent(#7048E8)의 역할을 맞바꾼다. 설계에서 브랜드를
보라로 확정했고, 파랑은 진행 중 상태색으로 쓰기 때문이다. 같은 이유로
secondary-foreground 와 ring 도 보라로 옮긴다.

상태색 5개와 사람색 6개를 토큰으로 정의한다. 값은 전부 기존 theme.css 에
있던 색이거나 그와 같은 계열이라 새로 만든 색은 없다."
```

---

## Task A2: 미사용 MUI 의존성 제거

`@mui/material`과 `@mui/icons-material`이 `package.json`에 있으나 `.tsx` 어느 파일도 import하지 않는다. 번들과 설치 시간만 먹는다.

**Files:**
- Modify: `App/frontend/package.json`

- [ ] **Step 1: 정말 안 쓰는지 확인한다**

```bash
cd App/frontend
grep -rn "@mui/" src --include='*.tsx' --include='*.ts' | grep -v node_modules
```

기대: **출력 없음.** 한 줄이라도 나오면 이 작업을 중단하고 그 파일부터 확인한다.

- [ ] **Step 2: emotion을 쓰는 다른 코드가 없는지 먼저 확인한다**

```bash
grep -rn "@emotion/" src --include='*.tsx' --include='*.ts' | grep -v node_modules
```

출력이 없으면 emotion도 같이 제거한다. 한 줄이라도 나오면 **MUI 두 개만** 제거하고 emotion은 남긴다.

- [ ] **Step 3: 의존성을 제거한다**

Step 2에서 emotion 사용처가 없던 경우:

```bash
cd App/frontend
pnpm remove @mui/material @mui/icons-material @emotion/react @emotion/styled
```

emotion 사용처가 있던 경우:

```bash
cd App/frontend
pnpm remove @mui/material @mui/icons-material
```

- [ ] **Step 4: 빌드·테스트·타입 검사를 전부 돌린다**

```bash
cd App/frontend
pnpm install && pnpm typecheck && pnpm test && pnpm build
```

기대: 전부 통과. 테스트는 현재 78개다.

- [ ] **Step 5: 커밋**

```bash
git add App/frontend/package.json App/frontend/pnpm-lock.yaml
git commit -m "chore: 쓰지 않는 MUI 의존성을 제거한다

@mui/material 과 @mui/icons-material 을 import 하는 .tsx 가 하나도 없다.
peer 의존성인 @emotion 도 다른 사용처가 없어 같이 지운다."
```

---

## Task A3: 사람색 배정 유틸

같은 사람은 어느 화면에서든 같은 색이어야 한다. 사용자 ID를 6색 중 하나로 안정적으로 매핑한다.

**Files:**
- Create: `App/frontend/src/global/lib/personColor.ts`
- Create: `App/frontend/src/global/lib/personColor.test.ts`

**Interfaces:**
- Produces: `personColorIndex(userId: number): number` (1~6), `personColorClasses(userId: number): { text: string; bg: string }` — 이후 모든 화면이 담당자 칩을 그릴 때 이 함수를 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/global/lib/personColor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { personColorIndex, personColorClasses } from "./personColor";

describe("personColorIndex", () => {
  it("항상 1에서 6 사이를 반환한다", () => {
    for (let id = 1; id <= 100; id += 1) {
      const index = personColorIndex(id);
      expect(index).toBeGreaterThanOrEqual(1);
      expect(index).toBeLessThanOrEqual(6);
    }
  });

  it("같은 ID는 항상 같은 색을 받는다", () => {
    expect(personColorIndex(42)).toBe(personColorIndex(42));
  });

  it("연속한 ID는 서로 다른 색을 받는다", () => {
    expect(personColorIndex(1)).not.toBe(personColorIndex(2));
  });

  it("6명까지는 색이 겹치지 않는다", () => {
    const indexes = [1, 2, 3, 4, 5, 6].map(personColorIndex);
    expect(new Set(indexes).size).toBe(6);
  });
});

describe("personColorClasses", () => {
  it("Tailwind 클래스 문자열을 반환한다", () => {
    const classes = personColorClasses(1);
    expect(classes.text).toMatch(/^text-person-[1-6]$/);
    expect(classes.bg).toMatch(/^bg-person-[1-6]-bg$/);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
cd App/frontend
pnpm vitest run src/global/lib/personColor.test.ts
```

기대: FAIL — `Failed to resolve import "./personColor"`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/global/lib/personColor.ts`:

```ts
const PERSON_COLOR_COUNT = 6;

/**
 * 사용자 ID를 사람색 1~6 중 하나로 매핑한다.
 * 팀원이 6명을 넘으면 순환한다. 색이 겹쳐도 이름이 항상 함께 나오므로 혼동이 없다.
 */
export function personColorIndex(userId: number): number {
  return (Math.abs(userId) % PERSON_COLOR_COUNT) + 1;
}

export function personColorClasses(userId: number): { text: string; bg: string } {
  const index = personColorIndex(userId);
  return {
    text: `text-person-${index}`,
    bg: `bg-person-${index}-bg`,
  };
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
cd App/frontend
pnpm vitest run src/global/lib/personColor.test.ts
```

기대: PASS (5개 테스트)

- [ ] **Step 5: Tailwind가 조립형 클래스명을 못 잡는 문제를 처리한다**

Tailwind는 소스에서 문자열을 스캔하므로 `text-person-${index}` 같은 조립형 클래스는 인식하지 못해 최종 CSS에서 빠진다. `personColor.ts` 맨 아래에 전체 문자열 배열을 넣어 스캐너가 잡게 한다.

```ts
// Tailwind는 조립된 클래스명을 스캔하지 못한다. 아래 배열이 스캔 대상이 되어
// person-1~6 클래스가 최종 CSS에 남는다. 지우면 색이 전부 사라진다.
export const PERSON_COLOR_SAFELIST = [
  "text-person-1", "bg-person-1-bg",
  "text-person-2", "bg-person-2-bg",
  "text-person-3", "bg-person-3-bg",
  "text-person-4", "bg-person-4-bg",
  "text-person-5", "bg-person-5-bg",
  "text-person-6", "bg-person-6-bg",
] as const;
```

- [ ] **Step 6: 전체 테스트와 빌드를 돌린다**

```bash
cd App/frontend
pnpm test && pnpm typecheck && pnpm build
```

기대: 전부 통과. 테스트 수가 78 → 83이 된다.

- [ ] **Step 7: 커밋**

```bash
git add App/frontend/src/global/lib/personColor.ts App/frontend/src/global/lib/personColor.test.ts
git commit -m "feat: 사용자 ID로 사람색을 배정하는 유틸을 추가한다

같은 사람이 어느 화면에서든 같은 색을 갖게 한다. 6색을 순환하며,
색이 겹쳐도 이름이 항상 함께 나오므로 혼동이 없다.
Tailwind 가 조립형 클래스명을 스캔하지 못해 safelist 배열을 같이 둔다."
```

---

## Task A4: 하드코딩 hex를 토큰으로 회수

52개 `.tsx`가 hex를 직접 쓰고 있어 색을 한 번에 못 바꾼다. **한 번에 다 고치지 않는다** — 파일별로 나눠 커밋해야 회귀 지점을 찾을 수 있다.

**Files:**
- Modify: 아래 순서로 배치 처리

**Interfaces:**
- Consumes: Task A1이 만든 `--status-*` / `--person-*` 토큰

- [ ] **Step 1: 대상 목록을 뽑는다**

```bash
cd App/frontend
grep -crE '#[0-9a-fA-F]{6}' src -r --include='*.tsx' | grep -v ':0$' | sort -t: -k2 -rn
```

가장 많은 곳(작업 시점 기준): `landing/components/HeroIllustration.tsx` 52곳, `meetings/screen/MeetingsView.tsx` 34곳, `dashboard/screen/detail/WorkloadPage.tsx` 26곳, `dashboard/screen/DashboardView.tsx` 16곳, `deliverables/screen/DeliverablesView.tsx` 15곳.

- [ ] **Step 2: 배치 1 — 대시보드 계열부터 고친다**

`dashboard/` 아래 파일들을 먼저 한다. 2주차에 대시보드를 재설계하므로 여기가 정리돼 있어야 그 작업이 깨끗하다.

각 hex를 아래 표에 따라 바꾼다. **표에 없는 색이 나오면 임의로 정하지 말고 목록에 적어 둔 뒤 Step 5에서 함께 판단한다.**

| 원래 hex | 바꿀 클래스 |
|---|---|
| `#3B5BDB` / `#4F6EF7` / `#7048E8` | `text-primary` / `bg-primary` |
| `#E03131` / `#EF4444` / `#DC2626` | `text-status-blocked` / `bg-status-blocked` |
| `#F59E0B` / `#B45309` | `text-status-due` / `bg-status-due` |
| `#10B981` / `#16A34A` | `text-chart-3` (기존 지표용 토큰) |
| 회색 계열 (`#8892A4`, `#6B7280` 등) | `text-muted-foreground` |
| `#FFFFFF` | `bg-card` |

- [ ] **Step 3: 배치 1을 검증한다**

```bash
cd App/frontend
pnpm typecheck && pnpm test && pnpm build
grep -crE '#[0-9a-fA-F]{6}' src/dashboard -r --include='*.tsx' | grep -v ':0$'
```

기대: 앞의 세 명령 통과, 마지막 grep은 **출력 없음**.

- [ ] **Step 4: 배치 1을 커밋한다**

```bash
git add App/frontend/src/dashboard
git commit -m "style: 대시보드의 하드코딩 색을 토큰으로 회수한다"
```

- [ ] **Step 5: 배치 2~4를 같은 방식으로 반복한다**

순서: ①`meetings/` ②`board/` + `ai/` ③나머지(`deliverables/`, `mypage/`, `contributors/`, `github/`, `roadmap/`, `admin/`, `leader/`, `auth/`)

**`landing/components/HeroIllustration.tsx`(52곳)는 건드리지 않는다.** 이 파일은 랜딩 히어로의 SVG 일러스트로, 3주차에 새 대시보드 이미지로 통째 교체될 예정이다. 지금 회수하면 버려질 작업이다.

각 배치마다 Step 3의 검증과 Step 4의 커밋을 반복한다.

- [ ] **Step 6: 최종 확인**

```bash
cd App/frontend
grep -crE '#[0-9a-fA-F]{6}' src -r --include='*.tsx' | grep -v ':0$'
```

기대: `landing/components/HeroIllustration.tsx` **한 줄만** 남는다. 다른 파일이 남아 있으면 배치를 빠뜨린 것이다.

---

# B트랙 — 백엔드

## Task B1: `tasks.status_changed_at` 컬럼과 백필

블로커 타임라인이 "며칠째 막혔는지"를 보여주려면 상태가 바뀐 시각이 필요하다. 지금은 `updated_at`뿐인데, 제목만 고쳐도 갱신되므로 막힌 기간이 실제보다 짧게 나온다.

**Files:**
- Create: `App/backend_spring/src/main/resources/db/migration/V20260811_1__add_task_status_changed_at.sql`

**Interfaces:**
- Produces: `tasks.status_changed_at TIMESTAMP NULL` — Task B2 이후가 이 컬럼을 읽고 쓴다.

- [ ] **Step 1: 마이그레이션 파일명이 최신인지 확인한다**

```bash
ls App/backend_spring/src/main/resources/db/migration | tail -3
```

기대: 마지막이 `V20260801_1__drop_document_chunks_ivfflat_index.sql`. 이보다 뒤 날짜 파일이 있으면 새 파일 이름의 날짜를 그에 맞춰 올린다.

- [ ] **Step 2: 마이그레이션을 작성한다**

`V20260811_1__add_task_status_changed_at.sql`:

```sql
-- 업무가 현재 상태로 바뀐 시각. 블로커가 며칠째 막혀 있는지 세는 데 쓴다.
-- updated_at 은 제목 수정 같은 무관한 변경에도 갱신되므로 이 목적에 쓸 수 없다.
ALTER TABLE tasks ADD COLUMN status_changed_at TIMESTAMP;

-- 백필 1단계: 활동 로그에 마지막 상태 변경 기록이 있으면 그 시각을 쓴다.
-- 활동 메시지 형식은 TaskController 가 기록하는
-- "'<제목>' 상태를 '<라벨>'(으)로 변경했습니다." 이다.
UPDATE tasks t
SET status_changed_at = a.created_at
FROM (
    SELECT DISTINCT ON (target_id) target_id, created_at
    FROM activities
    WHERE type = 'STATUS_CHANGED'
    ORDER BY target_id, created_at DESC
) a
WHERE t.id = a.target_id;

-- 백필 2단계: 활동 기록이 없는 행은 updated_at 으로 대체한다.
-- 정확하지 않지만 null 로 두면 경과일 계산에서 전부 빠지므로 근사치를 넣는다.
UPDATE tasks
SET status_changed_at = updated_at
WHERE status_changed_at IS NULL;

-- 블로커 목록을 상태 변경 시각 순으로 정렬하는 쿼리를 위한 인덱스.
CREATE INDEX idx_tasks_status_changed_at ON tasks (project_id, status, status_changed_at);
```

- [ ] **Step 3: 로컬 빈 DB에 적용해 본다**

로컬은 Flyway가 기본 꺼져 있다(`SPRING_FLYWAY_ENABLED` 기본 `false`). **공유 DB에 직접 실행하지 않는다.**

```bash
cd App
docker compose up -d db
docker compose exec db psql -U postgres -d workflow -c "\d tasks" | grep status_changed_at
```

기대: `status_changed_at | timestamp without time zone |` 한 줄.

- [ ] **Step 4: 백필 결과를 확인한다**

```bash
cd App
docker compose exec db psql -U postgres -d workflow -c \
  "SELECT count(*) AS total, count(status_changed_at) AS filled FROM tasks;"
```

기대: `total`과 `filled`가 같다. 다르면 2단계 UPDATE가 안 돈 것이다.

- [ ] **Step 5: 커밋**

```bash
git add App/backend_spring/src/main/resources/db/migration/V20260811_1__add_task_status_changed_at.sql
git commit -m "feat: tasks 에 status_changed_at 컬럼을 추가한다

블로커가 며칠째 막혀 있는지 세려면 상태가 바뀐 시각이 필요하다.
updated_at 은 제목 수정에도 갱신되어 이 목적에 쓸 수 없다.

기존 행은 활동 로그의 마지막 STATUS_CHANGED 시각으로 채우고,
기록이 없으면 updated_at 으로 대체한다."
```

---

## Task B2: 상태 변경 시 `statusChangedAt` 갱신

**Files:**
- Modify: `App/backend_spring/src/main/java/com/workflowai/task/Task.java`
- Modify: `App/backend_spring/src/main/java/com/workflowai/task/TaskController.java` (277행 부근 — `if (!previousStatus.equals(task.getStatus()))` 블록)
- Create: `App/backend_spring/src/test/java/com/workflowai/task/TaskStatusChangedAtTest.java`

**Interfaces:**
- Consumes: `tasks.status_changed_at` (Task B1)
- Produces: `Task.getStatusChangedAt(): LocalDateTime`, `Task.setStatusChangedAt(LocalDateTime)`

- [ ] **Step 1: 엔티티에 필드를 추가한다**

`Task.java`의 `updatedAt` 필드(79행 부근) 바로 아래에 붙인다.

```java
    @Column(name = "status_changed_at")
    private LocalDateTime statusChangedAt;
```

같은 파일의 getter/setter 구역에 추가한다.

```java
    public LocalDateTime getStatusChangedAt() {
        return statusChangedAt;
    }

    public void setStatusChangedAt(LocalDateTime statusChangedAt) {
        this.statusChangedAt = statusChangedAt;
    }
```

- [ ] **Step 2: 상태 변경 지점에서 갱신한다**

`TaskController.java`의 277행 부근, 이미 있는 조건문 안 **맨 앞줄**에 넣는다. 활동 로그를 남기는 조건과 같은 조건이므로 새 분기를 만들지 않는다.

```java
        if (!previousStatus.equals(task.getStatus())) {
            task.setStatusChangedAt(LocalDateTime.now());   // <-- 추가
            String label = STATUS_LABELS.getOrDefault(task.getStatus(), task.getStatus());
            // ... 기존 코드 그대로
```

`LocalDateTime` import가 없으면 추가한다.

- [ ] **Step 3: 회귀 방지 테스트를 쓴다**

`src/test/java/com/workflowai/task/TaskStatusChangedAtTest.java`:

```java
package com.workflowai.task;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

class TaskStatusChangedAtTest {

    @Test
    void 변경_시각을_기록하고_읽을_수_있다() {
        Task task = new Task();
        assertThat(task.getStatusChangedAt()).isNull();

        LocalDateTime now = LocalDateTime.of(2026, 8, 11, 10, 0);
        task.setStatusChangedAt(now);

        assertThat(task.getStatusChangedAt()).isEqualTo(now);
    }
}
```

- [ ] **Step 4: 테스트와 전체 빌드를 돌린다**

```bash
cd App/backend_spring
./gradlew test
```

기대: 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add App/backend_spring/src/main/java/com/workflowai/task/Task.java \
        App/backend_spring/src/main/java/com/workflowai/task/TaskController.java \
        App/backend_spring/src/test/java/com/workflowai/task/TaskStatusChangedAtTest.java
git commit -m "feat: 업무 상태가 바뀔 때 변경 시각을 기록한다

활동 로그를 남기는 것과 같은 조건에서 statusChangedAt 을 갱신한다.
분기를 새로 만들지 않아 두 기록이 어긋날 일이 없다."
```

---

## Task B3: 막힌 업무 경과일 집계

**Files:**
- Create: `App/backend_spring/src/main/java/com/workflowai/dashboard/DTO/BlockedTaskDto.java`
- Create: `App/backend_spring/src/test/java/com/workflowai/dashboard/BlockedTaskAgeTest.java`

**Interfaces:**
- Consumes: `Task.getStatusChangedAt()` (Task B2)
- Produces: `BlockedTaskDto(Long taskId, String title, String category, Long assigneeId, String assigneeName, int blockedDays, String severity)` — `severity`는 `"normal"` / `"warning"` / `"danger"`. 정적 팩토리 `BlockedTaskDto.of(taskId, title, category, assigneeId, assigneeName, statusChangedAt, now)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

경과일과 등급 계산이 핵심이다. **3일부터 주의(`warning`), 4일 이상 위험(`danger`)** 이다.

> 설계 문서 §5-1에 "3일 초과 주의, 4일 이상 위험"으로 적혀 있으나 그대로 읽으면 4일이 주의이면서 위험이라 모순이다.
> 확정 발언("블로커 주의는 3일")과 시안 N의 표시(`3일 · 주의` / `4일 · 위험`)를 기준으로 **3일=주의, 4일 이상=위험**으로 정한다.
> 설계 문서의 해당 문장도 같이 고쳐야 한다.

`src/test/java/com/workflowai/dashboard/BlockedTaskAgeTest.java`:

```java
package com.workflowai.dashboard;

import static org.assertj.core.api.Assertions.assertThat;

import com.workflowai.dashboard.DTO.BlockedTaskDto;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

class BlockedTaskAgeTest {

    private static final LocalDateTime NOW = LocalDateTime.of(2026, 8, 11, 10, 0);

    @Test
    void 막힌_지_하루면_경과일이_1이고_등급은_normal_이다() {
        BlockedTaskDto dto = BlockedTaskDto.of(
            1L, "대시보드 테스트4", "디자인", 7L, "박상준", NOW.minusDays(1), NOW);
        assertThat(dto.blockedDays()).isEqualTo(1);
        assertThat(dto.severity()).isEqualTo("normal");
    }

    @Test
    void 이틀까지는_normal_이다() {
        BlockedTaskDto dto = BlockedTaskDto.of(
            2L, "workload 서빙 구현", "AI/ML", 8L, "고무서", NOW.minusDays(2), NOW);
        assertThat(dto.blockedDays()).isEqualTo(2);
        assertThat(dto.severity()).isEqualTo("normal");
    }

    @Test
    void 사흘이면_warning_이다() {
        BlockedTaskDto dto = BlockedTaskDto.of(
            3L, "노트북 정리", "AI/ML", 9L, "이은주", NOW.minusDays(3), NOW);
        assertThat(dto.blockedDays()).isEqualTo(3);
        assertThat(dto.severity()).isEqualTo("warning");
    }

    @Test
    void 나흘부터는_danger_이다() {
        BlockedTaskDto dto = BlockedTaskDto.of(
            4L, "LLM 분석 구조화", "AI/ML", 10L, "허영주", NOW.minusDays(4), NOW);
        assertThat(dto.blockedDays()).isEqualTo(4);
        assertThat(dto.severity()).isEqualTo("danger");
    }

    @Test
    void 닷새도_danger_이다() {
        BlockedTaskDto dto = BlockedTaskDto.of(
            6L, "ERD 수정본 공유", "DB", 11L, "유소은", NOW.minusDays(5), NOW);
        assertThat(dto.blockedDays()).isEqualTo(5);
        assertThat(dto.severity()).isEqualTo("danger");
    }

    @Test
    void 변경_시각이_없으면_경과일은_0_이다() {
        BlockedTaskDto dto = BlockedTaskDto.of(
            5L, "제목", "기타", null, null, null, NOW);
        assertThat(dto.blockedDays()).isZero();
        assertThat(dto.severity()).isEqualTo("normal");
    }
}
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
cd App/backend_spring
./gradlew test --tests "com.workflowai.dashboard.BlockedTaskAgeTest"
```

기대: 컴파일 실패 — `BlockedTaskDto` 없음.

- [ ] **Step 3: DTO를 구현한다**

`BlockedTaskDto.java`:

```java
package com.workflowai.dashboard.DTO;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Duration;
import java.time.LocalDateTime;

@Schema(description = "막혀 있는 업무와 경과일")
public record BlockedTaskDto(
    @Schema(description = "업무 ID", example = "207") Long taskId,
    @Schema(description = "업무 제목", example = "ERD 수정본 공유") String title,
    @Schema(description = "카테고리", example = "DB") String category,
    @Schema(description = "담당자 ID", example = "10") Long assigneeId,
    @Schema(description = "담당자 이름", example = "유소은") String assigneeName,
    @Schema(description = "막힌 지 며칠", example = "5") int blockedDays,
    @Schema(description = "등급 (normal/warning/danger)", example = "danger") String severity
) {

    /** 이틀까지는 normal, 사흘부터 warning, 나흘부터 danger. 설계 문서 5-1 참고. */
    private static final int WARNING_DAYS = 3;
    private static final int DANGER_DAYS = 4;

    public static BlockedTaskDto of(
        Long taskId, String title, String category,
        Long assigneeId, String assigneeName,
        LocalDateTime statusChangedAt, LocalDateTime now
    ) {
        int days = statusChangedAt == null
            ? 0
            : (int) Duration.between(statusChangedAt, now).toDays();
        return new BlockedTaskDto(taskId, title, category, assigneeId, assigneeName, days, severityOf(days));
    }

    private static String severityOf(int days) {
        if (days >= DANGER_DAYS) {
            return "danger";
        }
        if (days >= WARNING_DAYS) {
            return "warning";
        }
        return "normal";
    }
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
cd App/backend_spring
./gradlew test --tests "com.workflowai.dashboard.BlockedTaskAgeTest"
```

기대: PASS (6개)

- [ ] **Step 5: 커밋**

```bash
git add App/backend_spring/src/main/java/com/workflowai/dashboard/DTO/BlockedTaskDto.java \
        App/backend_spring/src/test/java/com/workflowai/dashboard/BlockedTaskAgeTest.java
git commit -m "feat: 막힌 업무의 경과일과 등급을 계산하는 DTO 를 추가한다

이틀까지는 normal, 사흘부터 warning, 나흘부터 danger 로 나눈다.
상태 변경 시각이 없는 행은 경과일 0 으로 두어 목록에서 빠지지 않게 한다."
```

---

## Task B4: 계획선 계산

게이지의 검은 눈금("오늘 있어야 할 위치")과 중간 점검일 눈금에 쓴다.

**Files:**
- Create: `App/backend_spring/src/main/java/com/workflowai/dashboard/DTO/ProjectTimelineDto.java`
- Create: `App/backend_spring/src/test/java/com/workflowai/dashboard/ProjectTimelineTest.java`

**Interfaces:**
- Consumes: `Project.getStartDate()`, `Project.getDeadline()`, `Project.getMidCheckDate()` — 세 필드 모두 `Project.java`에 이미 있다(35·41·44행)
- Produces: `ProjectTimelineDto(LocalDate startDate, LocalDate deadline, LocalDate midCheckDate, int elapsedPercent, Integer midCheckPercent, String verdict, int daysAhead)`. 정적 팩토리 `ProjectTimelineDto.of(startDate, deadline, midCheckDate, progressPercent, today)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/test/java/com/workflowai/dashboard/ProjectTimelineTest.java`:

```java
package com.workflowai.dashboard;

import static org.assertj.core.api.Assertions.assertThat;

import com.workflowai.dashboard.DTO.ProjectTimelineDto;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class ProjectTimelineTest {

    private static final LocalDate START = LocalDate.of(2026, 7, 13);
    private static final LocalDate DEADLINE = LocalDate.of(2026, 8, 12);   // 30일 기간
    private static final LocalDate MID = LocalDate.of(2026, 7, 28);        // 15일차
    private static final LocalDate HALFWAY = LocalDate.of(2026, 7, 28);

    @Test
    void 기간의_절반이_지나면_경과율은_50_이다() {
        ProjectTimelineDto dto = ProjectTimelineDto.of(START, DEADLINE, MID, 50, HALFWAY);
        assertThat(dto.elapsedPercent()).isEqualTo(50);
    }

    @Test
    void 중간_점검일의_위치를_퍼센트로_준다() {
        ProjectTimelineDto dto = ProjectTimelineDto.of(START, DEADLINE, MID, 50, HALFWAY);
        assertThat(dto.midCheckPercent()).isEqualTo(50);
    }

    @Test
    void 진행률과_경과율이_같으면_순항으로_판정한다() {
        ProjectTimelineDto dto = ProjectTimelineDto.of(START, DEADLINE, MID, 50, HALFWAY);
        assertThat(dto.verdict()).isEqualTo("onTrack");
    }

    @Test
    void 진행률이_경과율보다_높으면_앞선다고_판정한다() {
        ProjectTimelineDto dto = ProjectTimelineDto.of(START, DEADLINE, MID, 75, HALFWAY);
        assertThat(dto.verdict()).isEqualTo("ahead");
        assertThat(dto.daysAhead()).isEqualTo(8);   // (75-50)% x 30일 = 7.5 -> 반올림 8
    }

    @Test
    void 진행률이_경과율보다_낮으면_뒤처진다고_판정한다() {
        ProjectTimelineDto dto = ProjectTimelineDto.of(START, DEADLINE, MID, 30, HALFWAY);
        assertThat(dto.verdict()).isEqualTo("behind");
        assertThat(dto.daysAhead()).isEqualTo(-6);  // (30-50)% x 30일 = -6
    }

    @Test
    void 시작일이_없으면_판정하지_않는다() {
        ProjectTimelineDto dto = ProjectTimelineDto.of(null, DEADLINE, MID, 75, HALFWAY);
        assertThat(dto.verdict()).isEqualTo("unknown");
        assertThat(dto.elapsedPercent()).isZero();
    }

    @Test
    void 마감일이_지나면_경과율은_100_에서_멈춘다() {
        ProjectTimelineDto dto = ProjectTimelineDto.of(
            START, DEADLINE, MID, 90, LocalDate.of(2026, 9, 1));
        assertThat(dto.elapsedPercent()).isEqualTo(100);
    }
}
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
cd App/backend_spring
./gradlew test --tests "com.workflowai.dashboard.ProjectTimelineTest"
```

기대: 컴파일 실패 — `ProjectTimelineDto` 없음.

- [ ] **Step 3: DTO를 구현한다**

`ProjectTimelineDto.java`:

```java
package com.workflowai.dashboard.DTO;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

@Schema(description = "프로젝트 기간과 계획 대비 진척 판정")
public record ProjectTimelineDto(
    @Schema(description = "시작일") LocalDate startDate,
    @Schema(description = "마감일") LocalDate deadline,
    @Schema(description = "중간 점검일") LocalDate midCheckDate,
    @Schema(description = "기간 경과율 (%)", example = "50") int elapsedPercent,
    @Schema(description = "중간 점검일의 기간 내 위치 (%)", example = "50") Integer midCheckPercent,
    @Schema(description = "판정 (ahead/behind/onTrack/unknown)", example = "ahead") String verdict,
    @Schema(description = "며칠 앞섰는지. 음수면 뒤처짐", example = "8") int daysAhead
) {

    /** 진행률과 경과율 차이가 이 값 미만이면 순항으로 본다. */
    private static final int ON_TRACK_TOLERANCE_PERCENT = 3;

    public static ProjectTimelineDto of(
        LocalDate startDate, LocalDate deadline, LocalDate midCheckDate,
        int progressPercent, LocalDate today
    ) {
        if (startDate == null || deadline == null || !deadline.isAfter(startDate)) {
            return new ProjectTimelineDto(startDate, deadline, midCheckDate, 0, null, "unknown", 0);
        }

        long totalDays = ChronoUnit.DAYS.between(startDate, deadline);
        long passedDays = clamp(ChronoUnit.DAYS.between(startDate, today), 0, totalDays);
        int elapsed = (int) Math.round(passedDays * 100.0 / totalDays);

        Integer midPercent = midCheckDate == null
            ? null
            : (int) Math.round(
                clamp(ChronoUnit.DAYS.between(startDate, midCheckDate), 0, totalDays) * 100.0 / totalDays);

        int gap = progressPercent - elapsed;
        int days = (int) Math.round(gap * totalDays / 100.0);
        String verdict = Math.abs(gap) < ON_TRACK_TOLERANCE_PERCENT
            ? "onTrack"
            : (gap > 0 ? "ahead" : "behind");

        return new ProjectTimelineDto(startDate, deadline, midCheckDate, elapsed, midPercent, verdict, days);
    }

    private static long clamp(long value, long min, long max) {
        return Math.max(min, Math.min(max, value));
    }
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
cd App/backend_spring
./gradlew test --tests "com.workflowai.dashboard.ProjectTimelineTest"
```

기대: PASS (7개). 실패하면 반올림 경계다 — 테스트의 기대값과 구현 중 어느 쪽이 맞는지 판단해 고친다. **테스트를 통과시키려고 기대값을 임의로 바꾸지 않는다.**

- [ ] **Step 5: 커밋**

```bash
git add App/backend_spring/src/main/java/com/workflowai/dashboard/DTO/ProjectTimelineDto.java \
        App/backend_spring/src/test/java/com/workflowai/dashboard/ProjectTimelineTest.java
git commit -m "feat: 계획 대비 진척을 판정하는 DTO 를 추가한다

시작일과 마감일로 기간 경과율을 내고, 진행률과 비교해 앞섰는지
뒤처졌는지 판정한다. 중간 점검일의 위치도 퍼센트로 준다.
차이가 3퍼센트 미만이면 순항으로 본다."
```

---

## Task B5: 대시보드 응답에 두 필드 연결

**Files:**
- Modify: `App/backend_spring/src/main/java/com/workflowai/dashboard/DTO/DashboardSummaryResponse.java`
- Modify: `App/backend_spring/src/main/java/com/workflowai/dashboard/service/DashboardService.java`

**Interfaces:**
- Consumes: `BlockedTaskDto.of(...)` (B3), `ProjectTimelineDto.of(...)` (B4)
- Produces: `DashboardSummaryResponse`에 `blockedTaskList`, `timeline` 필드 — 2주차 프론트 대시보드가 이 두 필드를 읽는다

- [ ] **Step 1: 응답 레코드에 필드를 추가한다**

`DashboardSummaryResponse.java`의 `recentActivity` 뒤에 붙인다. **기존 필드 순서와 이름은 건드리지 않는다** — 프론트가 이미 쓰고 있다.

```java
    @Schema(description = "최근 활동 (최대 10건)") List<ActivityItemDto> recentActivity,
    @Schema(description = "막혀 있는 업무 (경과일 내림차순, 최대 8건)") List<BlockedTaskDto> blockedTaskList,
    @Schema(description = "프로젝트 기간과 진척 판정") ProjectTimelineDto timeline
) {
```

- [ ] **Step 2: 컴파일 오류로 고칠 지점을 찾는다**

```bash
cd App/backend_spring
./gradlew compileJava
```

기대: `DashboardService`에서 생성자 인자 수가 안 맞아 **실패한다.** 이 오류가 다음 단계에서 고칠 지점을 정확히 알려준다.

- [ ] **Step 3: 서비스에서 두 값을 채운다**

`DashboardService.java`에서 `new DashboardSummaryResponse(...)`를 호출하는 곳을 찾아, 그 직전에 아래를 계산해 넘긴다.

```java
        LocalDateTime now = LocalDateTime.now();
        List<BlockedTaskDto> blockedTaskList = tasks.stream()
            .filter(task -> "blocked".equals(task.getStatus()))
            .map(task -> BlockedTaskDto.of(
                task.getId(), task.getTitle(), task.getCategory(),
                task.getAssigneeId(), memberNameById.get(task.getAssigneeId()),
                task.getStatusChangedAt(), now))
            .sorted(Comparator.comparingInt(BlockedTaskDto::blockedDays).reversed())
            .limit(8)
            .toList();

        ProjectTimelineDto timeline = ProjectTimelineDto.of(
            project.getStartDate(), project.getDeadline(), project.getMidCheckDate(),
            (int) progressPercent, LocalDate.now());
```

`memberNameById`는 이 서비스가 `WorkloadEntryDto`를 만들 때 이미 조회하는 팀원 목록을 재사용한다. **이름 조회를 위해 쿼리를 새로 추가하지 않는다.** 변수명이 다르면 그 이름에 맞춘다.

`"blocked"`는 `tasks.status`에 실제로 저장되는 값이다 — `TaskController.STATUS_LABELS`(48~53행)가 `"blocked" → "보류/블로커"`로 매핑하는 그 키다. 한글 라벨로 비교하면 안 된다.

- [ ] **Step 4: 빌드와 전체 테스트를 돌린다**

```bash
cd App/backend_spring
./gradlew test
```

기대: 전부 통과.

- [ ] **Step 5: 응답을 실제로 확인한다**

```bash
cd App
docker compose up -d
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/v1/projects/1/dashboard/summary" | jq '.blockedTaskList, .timeline'
```

기대: `blockedTaskList`가 경과일 내림차순 배열이고, `timeline.verdict`가 `ahead`/`behind`/`onTrack` 중 하나다. `unknown`이 나오면 그 프로젝트에 시작일이나 마감일이 없는 것이다 — 데이터 문제이지 코드 문제가 아니다.

- [ ] **Step 6: 커밋**

```bash
git add App/backend_spring/src/main/java/com/workflowai/dashboard
git commit -m "feat: 대시보드 응답에 막힌 업무 목록과 기간 판정을 담는다

막힌 업무는 경과일 내림차순 8건까지 준다. 2주차 대시보드가 이 순서를
그대로 써서 가장 오래 막힌 것이 맨 위에 오게 한다.

기존 필드의 이름과 순서는 건드리지 않는다. 프론트가 이미 쓰고 있다."
```

---

## 1주차 완료 기준

아래가 전부 참이어야 2주차로 넘어간다.

| # | 확인 | 명령 |
|---|---|---|
| 1 | 하드코딩 hex가 `HeroIllustration.tsx` 하나만 남음 | `grep -crE '#[0-9a-fA-F]{6}' src -r --include='*.tsx' \| grep -v ':0$'` |
| 2 | MUI 의존성 없음 | `grep -n "@mui" package.json` → 출력 없음 |
| 3 | 프론트 테스트 통과 (78 → 83개) | `pnpm test` |
| 4 | 타입·빌드 통과 | `pnpm typecheck && pnpm build` |
| 5 | 백엔드 테스트 통과 | `./gradlew test` |
| 6 | 대시보드 응답에 두 필드가 실제로 담김 | Task B5 Step 5의 curl |
| 7 | 브랜드색이 화면에서 보라로 보임 | 로그인·대시보드 육안 확인 |

## 이번 주차에 하지 않는 것

- 화면 레이아웃 변경 — 2주차
- `HeroIllustration.tsx`의 hex 52곳 — 3주차에 통째 교체
- 다크모드 (`theme.css`의 `.dark` 블록) — 범위 밖. `.dark` 클래스를 켜는 코드가 앱에 없어 도달 불가능하므로 방치해도 회귀가 없다
- `jsx-a11y` 도입과 a11y 일괄 수정 — 3주차
- 랜딩의 후기·요금제 삭제 — 3주차
- 어시스턴트 답변의 테스트 데이터 제거 — 이 스펙 범위 밖, 별건
