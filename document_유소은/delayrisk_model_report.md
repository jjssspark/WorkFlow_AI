# 업무 지연 위험도(정상/주의/위험) 분류 모델 보고서

`App/backend_fastapi/ml_delay_risk/models/delay_model.ipynb` 기준.

이 보고서의 모든 수치는 **2026-07-28 학습 파이프라인 재실행 결과**다(`python -m ml_delay_risk.train --limit 4500 --test-size 0.2`).
헤드라인 검증 지표는 **macro F1 0.7399 / macro F2 0.7425** (LightGBM, MLflow 튜닝 최적 구성).

> **개정 이력**: 이전 판(2026-07-20 이전)은 Jira/MongoDB 데이터셋 기준으로 작성되어 있었다.
> 학습 데이터가 `mock_issue_dataset.py`(가짜 Supabase 데이터셋)로 전환된 이후 내용을 반영해 전면 개정했다.
> 자세한 전환 배경은 [2026-07-20_delay_model_가짜_Supabase_데이터셋_전환.md](2026-07-20_delay_model_가짜_Supabase_데이터셋_전환.md) 참고.

---

## 1. 목적과 종류

- **목적(예측)**: 아직 완료되지 않은 업무(`status != 'done'`) 하나를 **지금 이 순간** 관찰했을 때, 그 업무가
  "정상적으로 마무리될 것인지 / 관리자의 관심이 필요한지 / 이미 위험한 상태인지"를 판정한다.
  관리자가 **어느 업무에 언제 개입해야 하는지** 알려주는 대시보드 신호를 제공하는 것이 최종 목표다.
- **종류**: 지도학습 **다중 분류(Multiclass Classification)**. 회귀가 아니라 아래 3개 범주 중 하나를 예측한다.

| 클래스 인덱스 | 이름 | API 값 | 의미 |
|---|---|---|---|
| 0 | 정상 | `NORMAL` | 마감일 이내에서 순항 중 |
| 1 | 주의 | `CAUTION` | 마감일 이내지만 진행률이 저조하거나 블로커 상태에 짧게 머묾 |
| 2 | 위험 | `DANGER` | 마감일을 초과했거나, 블로커 상태에 장기간 머물러 활동이 정지(Silent) |

- **핵심 특징 — 단일 시점(스냅샷 1개) 학습**: 업무 하나당 학습 행을 **1개**만 만든다.
  실제 서비스가 항상 "완료되지 않은 업무를 현재 시각(now)에서" 평가하므로, 학습도 정확히 그 형태만 재현하면 된다.
  (Jira로 학습하던 시절에는 이슈 하나를 생성 후 1/3/7/14/30일 시점으로 여러 번 잘라 다중 스냅샷을 만들었지만,
  데이터셋 전환과 함께 폐지했다.)

---

## 2. 사용한 모델

**LightGBM** (Gradient Boosting Decision Tree), `objective="multiclass"`, `num_class=3`.

**모델 선정 방식**: LightGBM / CatBoost / XGBoost / RandomForest **4개 후보를 동일한 피처·동일한
train/valid 분할**로 각각 학습해 비교한 뒤, **MLflow**로 모델별 하이퍼파라미터 3구성씩(총 12 trial)을
탐색하고 검증 `macro avg f1-score`가 가장 높은 구성을 최종 채택했다.
`f2-score`(recall 가중)도 함께 기록해 '위험/주의를 놓치는 비용'을 같이 본다.

LightGBM을 쓰는 이유:
- 범주형 피처(`status_at_cutoff` 등)를 원-핫 인코딩 없이 네이티브로 처리 가능
- 결측치(체크리스트가 0개인 업무의 `progress_ratio_at_cutoff` = `NaN`)에 강건 — 별도 대치(imputation) 불필요
- 학습 대상이 수천 행 규모의 정형 데이터라 트리 기반 모델이 신경망보다 적은 데이터로도 안정적

---

## 3. 데이터 출처 — 가짜(mock) Supabase 데이터셋

`ml_delay_risk/models/mock_issue_dataset.py`의 `build_training_dataframe(limit=4500, num_projects=12, seed=42)`.

실제 DB나 외부 데이터셋을 쓰지 않고, **팀 Supabase 스키마 형태의 데이터를 코드로 직접 합성**한다.
DB 접속이 필요 없어 노트북을 그대로 실행하면 누구나 같은 결과를 재현할 수 있다(seed 고정).

| 항목 | 값 |
|---|---|
| 모사 대상 스키마 | `projects` / `users` / `milestones` / `tasks` / `task_checklists` / `task_comments` / `activities` |
| 학습 행 수 | **4,500행** (정상/주의/위험 각 **1,500행** — 완전 균형) |
| 프로젝트 수 | 12개 (프로젝트당 유저 4~8명, 마일스톤 3~6개) |
| 카테고리 | 18종 (`planning`/`frontend`/`backend`/`ai-ml`/`qa` 등 — 프론트엔드 `CatId`와 동일) |
| 우선순위 | 3종 (`high` 25% / `medium` 50% / `low` 25%) |
| 기준 시각(NOW) | `2026-07-20 09:00` 고정 (`datetime.utcnow()` 대신 고정값 — 재현성) |
| 경과 시간 범위 | 24시간 ~ 120일 |
| 생성 산출물 | [output/mock_issue_dataset.csv](output/mock_issue_dataset.csv) (4,500행 × 52컬럼) |

### 3.1 왜 실제 데이터가 아닌가

원래는 Jira Issue Tracking 데이터셋(MongoDB)으로 학습했지만, 실제 서비스(`delay_service.py`)는 팀 Supabase
스키마를 읽는다. 학습 데이터와 서빙 데이터의 출처·컬럼 구성이 달라 **train/serve skew**가 구조적으로 존재했다.
서비스가 아직 운영 데이터를 충분히 쌓지 못한 상태라, **학습 데이터 쪽을 서빙 스키마에 맞춰 합성**하는 방향으로 해결했다.

### 3.2 train/serve skew를 원천 차단한 방법

가장 중요한 설계다. **학습도 실시간 추론이 쓰는 `delay_service.build_feature_row()`를 그대로 호출**한다.
학습 전용 피처 생성 코드가 아예 존재하지 않으므로, 학습 피처와 서빙 피처가 어긋날 수 없다.

```
[학습]  합성 task 행 ─┐
                     ├─> delay_service.build_feature_row() ─> 52개 컬럼
[서빙]  Supabase 행 ─┘
```

학습 시점에는 아직 모델 아티팩트가 없어 `proxy_deadline_map`을 조회할 수 없으므로,
`proxy_deadline_lookup` 파라미터로 조회 함수만 주입한다(하위호환 — 기본값은 기존 동작과 동일).

### 3.3 생성 방법론 — "라벨을 먼저 정하고 데이터를 역산"

일반적인 데이터셋은 데이터를 모은 뒤 규칙(`classify_risk()`)으로 라벨을 **판정**한다. 이 데이터셋은 반대다.

1. 목표 라벨(정상/주의/위험)을 **먼저** 균등하게 배정
2. 그 라벨에 맞는 `elapsed_ratio` / `blocked_ratio` / 진행률 목표 구간을 뽑음
3. **`due_duration_hours = elapsed_hours / elapsed_ratio_목표`** 로 마감일을 역산해 원본 task 행을 생성

즉 `classify_risk()`를 호출하지 않는다. 다만 그 함수가 참조하는 임계값
(`risk_blocked_ratio=0.30`, `warning_blocked_ratio=0.10`, `warning_imbalance_index=0.30`)을
라벨별 목표 구간으로 그대로 재사용해 의미적 일관성은 유지한다.

**라벨별 시나리오** (`_scenario_targets`)

| 라벨 | 분기 | `elapsed_ratio` | `blocked_ratio` | 상태 | 진행률 성향 | 정체(stalled) |
|---|---|---|---|---|---|---|
| 정상 | – | 0.45~0.77 | 0~0.08 | `inprogress` | 경과율과 비슷 (×0.85~1.15) | ✕ |
| 주의 | 블로커형 (50%) | 0.45~0.77 | 0.12~0.28 | `blocked` | 경과율과 비슷 | ✕ |
| 주의 | 진행저조형 (50%) | 0.77~0.98 | 0~0.08 | `inprogress` | 경과율보다 0.35~0.55 낮음 | ✓ |
| 위험 | 마감초과형 (50%) | 1.05~1.8 (마감일 필수) | 0~0.15 | `inprogress` | 0.5~0.95 (미완료 방치) | ✓ |
| 위험 | 장기블로커형 (50%) | 0.45~0.77 | 0.35~0.7 | `blocked` | 경과율의 0.7~1.0배 | ✕ |

### 3.4 현실감을 위한 장치

| 장치 | 내용 | 의도 |
|---|---|---|
| 마감일 없음 | 약 17% (`NO_DUE_DATE_PROB=0.2`, 단 '위험-마감초과형'은 마감일 필수라 실측은 17.2%) | 실제 서비스의 결측 패턴 반영 |
| 담당자 미배정 | 약 5.4% (`UNASSIGNED_PROB=0.05`) | `assignee_at_cutoff="unassigned"` 케이스 학습 |
| 체크리스트 0개 | 약 10.6% → `progress_ratio_at_cutoff = NaN` | LightGBM 네이티브 결측 처리 경로 학습 |
| 마일스톤 연결 | 약 58.9% (`MILESTONE_LINK_PROB=0.6`) | `has_milestone` / `milestone_unresolved` 변동 부여 |
| `todo` 상태 주입 | 블로커가 아닌 업무 중 15%를 "아무도 손대지 않은 방치 업무"로 | `status_at_cutoff`가 `Blocked`/`In Progress`에만 몰리는 것 방지 |
| 필러 완료 업무 | 학습 행의 20%만큼 별도 생성 (학습 행에는 **미포함**) | 마일스톤 완료율에 현실적 변동만 주기 위함 |
| 댓글 희소성 | `COMMENT_USAGE_PROB=0.15` — **86.2%의 업무는 댓글이 0건** | 팀이 업무 댓글 기능을 거의 안 쓸 것으로 보고, 서빙 때 비어 있을 피처에 모델이 과의존하지 않게 함 |
| 정체(stalled) 신호 | 활동량 ×0.35, 마지막 발생 시점을 경과 기간 앞쪽 50%로 제한 | "일이 밀리면 최근 활동이 뜸해진다"는 현실 신호 부여 |

`stalled` 장치의 배경: 초기 버전에서는 '주의(진행저조형)'/'위험(마감초과형)'이 '정상'과
`status_at_cutoff`·`blocked_hours` 신호가 완전히 같아서, 구분 신호가 "경과시간 대 마감일 비율"(=카테고리별
기준시간과 비교해야 알 수 있는 상호작용 신호)뿐이었다. 단변량 상관계수 기반 피처 선정이 이 신호를 찾지 못해
걸러버렸고, **macro F1이 0.5 안팎으로 무너졌다**. 그래서 활동 모멘텀 피처가 단독으로도 마진 신호가 되도록 보강했다.

### 3.5 정합성 검증

생성 직후 `_validate_dataframe()`이 assert로 즉시 확인한다 — 라벨 집합 일치 / `num_unresolved_subtasks >= 0` /
`elapsed_hours_at_cutoff >= 0` / 클래스별 개수 균형. 추가로
[test_mock_issue_dataset.py](../App/backend_fastapi/tests/ml_delay_risk/test_mock_issue_dataset.py)에
균형 샘플링·seed 재현성·카테고리 다양성·모델 계약 컬럼 등 **테스트 9개**가 있다.

---

## 4. Target(타겟) 정의

### 4.1 타겟 컬럼

`risk_class`. `build_training_dataframe()`이 반환하는 시점에는 사람이 읽기 쉬운 **문자열**(`'정상'`/`'주의'`/`'위험'`)이고,
노트북 cell 17이 `RISK_CLASS_NAMES`의 역매핑으로 **정수 0/1/2**로 인코딩한다. 정수여야 하는 이유:

- 피처 선정(상관계수 R²)이 `risk_class`와의 상관계수를 직접 계산
- LightGBM `objective="multiclass"`는 라벨이 반드시 `0 ~ num_class-1` 정수여야 함
- 프로덕션 계약(`delay_router.py`, `ModelArtifact`)이 클래스 인덱스 0/1/2 → `NORMAL`/`CAUTION`/`DANGER`를 전제

### 4.2 라벨의 의미론적 근거 (`classify_risk`)

라벨을 직접 배정하긴 하지만, 그 목표 구간은 아래 규칙에서 그대로 가져온 것이다.
세 지표는 모두 **관찰 시점까지만 관측 가능한 값**이라, 학습 라벨링과 실시간 추론에 동일하게 재현 가능하다(미래 정보 누수 없음).

- `elapsed_ratio` = 경과 시간(생성 ~ now) ÷ 마감까지의 총 기간
- `blocked_ratio` = 블로커 상태 누적 체류시간 ÷ 마감까지의 총 기간
- `imbalance_index` = `elapsed_ratio` − `progress_ratio`(체크리스트 완료율. 체크리스트가 없으면 `None`)

```
elapsed_ratio > 1.0                        → 2 (위험, 마감일 초과)
blocked_ratio > 0.30                       → 2 (위험, 블로커 상태 장기 정체)
blocked_ratio > 0.10                       → 1 (주의, 블로커 상태 일정 기간 체류)
imbalance_index > 0.30                     → 1 (주의, 경과 대비 진행률 저조)
그 외                                        → 0 (정상)
```

### 4.3 마감일 (Proxy Deadline)

Jira 데이터셋에는 마감일 필드가 없어 "동일 (issuetype, priority) 그룹의 과거 처리시간 중앙값"을 대용했지만,
**팀 Supabase 스키마에는 진짜 마감일이 있다**. 그래서 우선순위는 다음과 같다.

1. `tasks.due_date`
2. 없으면 `milestones.due_date`
3. 둘 다 없으면 **`(category, priority) → proxy_deadline_hours` 맵** (폴백)

3번 맵은 `BASELINE_HOURS_BY_CATEGORY`(카테고리별 기준 소요시간) × `PRIORITY_MULTIPLIER`(`high` 0.7 /
`medium` 1.0 / `low` 1.4)로 만든다. 총 **54개 조합**, 전역 중앙값 **42.0시간**. 이 맵은 모델 아티팩트에
함께 저장되어 운영 중 `delay_model.proxy_deadline_for()`가 참조한다.

### 4.4 클래스 분포

| 클래스 | 학습 데이터 | train (80%) | valid (20%) |
|---|---|---|---|
| 0 (정상) | 1,500 | 1,200 | 300 |
| 1 (주의) | 1,500 | 1,200 | 300 |
| 2 (위험) | 1,500 | 1,200 | 300 |

규칙 기반 라벨링은 자연히 '정상'에 쏠리므로(Jira 학습 시절 정상 86.6% / 주의 0.8% / 위험 12.6%),
**라벨을 먼저 균등 배정해 생성 단계에서부터 불균형을 해소**했다. 그래서 이후 SMOTE 단계는 사실상 no-op이며 안전망으로만 유지된다.

---

## 5. Feature(피처) 상세 설명

### 5.1 전체 구조 — 52컬럼에서 5개까지

```
build_feature_row() 반환 52컬럼
  ├─ NON_FEATURE_COLUMNS (부기/누수/미지원)  → 30개 제외
  └─ 피처 후보 22개
       └─ 상관계수 R² 기반 선정 (R² 비중 ≥ 1%)  → 최종 학습 피처 5개
```

### 5.2 피처 후보 22개

| # | 피처명 | 설명 | 구분 |
|---|---|---|---|
| 1 | `project_key` | 프로젝트 코드 (`P9` 등). 프로젝트별 업무 패턴 차이 | 정적/범주형 |
| 2 | `issuetype_name` | 업무 카테고리 18종 (`frontend`/`backend`/`ai-ml` …). Proxy Deadline 산정 기준 | 정적/범주형 |
| 3 | `priority_name` | 우선순위 (`high`/`medium`/`low`). Proxy Deadline 산정 기준 | 정적/범주형 |
| 4 | `has_milestone` | 마일스톤에 연결돼 있는지 여부 | 정적 |
| 5 | `milestone_unresolved` | 연결된 마일스톤이 아직 미완료인지 (완료율 < 100%) | 정적 |
| 6 | `num_subtasks` | 체크리스트 항목 총 개수 (Jira의 하위 작업 자리) | 정적 |
| 7 | `num_unresolved_subtasks` | 그중 아직 완료되지 않은 개수 | 정적 |
| 8 | `created_day_of_week` | 생성 요일 (0=월 ~ 6=일) | 정적 |
| 9 | `created_hour` | 생성 시각 (0~23시) | 정적 |
| 10 | `summary_length` | 업무 제목 길이 (복잡도 근사) | 정적 |
| 11 | `status_at_cutoff` | 관찰 시점 상태 (`Open`/`In Progress`/`Blocked`) | 동적/범주형 |
| 12 | `assignee_at_cutoff` | 관찰 시점 담당자 (미배정이면 `"unassigned"`) | 동적/빈도인코딩 |
| 13 | `num_events_before_cutoff` | 관찰 시점 이전 `activities` 이벤트 총 개수 | 동적 |
| 14 | `hours_in_current_status` | `updated_at` ~ now 경과 시간 (상태 체류시간 근사) | 동적 |
| 15 | `blocked_hours_before_cutoff` | 블로커 상태 누적 체류시간 | 동적 |
| 16 | `num_comments_before_cutoff` | 관찰 시점 이전 `task_comments` 수 | 동적 |
| 17 | `num_unique_commenters` | 댓글을 남긴 고유 인원 수 | 동적 |
| 18 | `hours_since_last_comment` | 마지막 댓글 이후 경과 시간 (댓글 없으면 경과 시간 전체) | 동적 |
| 19 | `progress_ratio_at_cutoff` | 진행률 = 체크리스트 완료 ÷ 전체 (0개면 `NaN`) | 동적 |
| 20 | `elapsed_hours_at_cutoff` | 생성 후 now까지 경과 시간(시간 단위) | 동적 |
| 21 | `activity_count_recent_window` | 최근 **3일**간 (댓글 + 활동 로그) 합계 — 무활동은 위험 전조 | 동적 |
| 22 | `snapshot_offset_days` | 생성 후 며칠째인지 = `elapsed_hours / 24` | 동적 |

### 5.3 후보에서 제외한 컬럼 (30개)

**(a) 데이터 누수 방지 — `LEAKY_FEATURE_COLUMNS` 4개**

`mock_issue_dataset.py`가 `risk_class`를 정할 때 목표로 삼는 값 그 자체다. 피처로 남기면 모델이 패턴을
학습하는 대신 라벨링 규칙식을 그대로 베낀다.

| 제외 컬럼 | 이유 |
|---|---|
| `elapsed_ratio_at_cutoff` | 라벨 배정 기준값 그 자체 |
| `blocked_ratio_at_cutoff` | 라벨 배정 기준값 그 자체 |
| `imbalance_index_at_cutoff` | 라벨 배정 기준값 그 자체 |
| `hours_until_deadline_at_cutoff` | `proxy_deadline_hours − elapsed_hours`로 역산 가능 = `elapsed_ratio`와 동일 정보 |

**(b) Supabase에 대응 개념이 없는 컬럼 — `SUPABASE_UNAVAILABLE_COLUMNS` 18개**

`build_feature_row()`가 항상 고정값(0/False/`"unknown"`)으로 채우는 컬럼들이다. 학습이든 추론이든 항상
상수라 예측력에 기여하지 못하고, 후보로 남으면 더 유용한 피처가 선택될 기회만 뺏는다.

| 그룹 | 컬럼 |
|---|---|
| 등록자 개념 없음 | `reporter`, `is_self_assigned`, `is_subtask` |
| 릴리즈/버전/컴포넌트 없음 | `num_components`, `num_fixversions`, `has_released_fixversion`, `num_versions` |
| 예상 소요시간 컬럼 없음 | `has_original_estimate`, `original_estimate_seconds` |
| 이슈 링크 테이블 없음 | `num_issuelinks_total`, `num_blocked_by_links`, `num_unresolved_blockers` |
| worklog 테이블 없음 | `num_worklog_entries`, `num_unique_workers`, `time_spent_seconds_before_cutoff` |
| 이벤트 종류 구분 불가 | `num_status_changes`, `num_assignee_changes`, `num_reopens` |

> `has_original_estimate`가 대표적 사례다. Jira로 학습하던 시절엔 피처 중요도 1위(39%)였지만,
> Supabase `tasks` 테이블에는 예상 소요시간 컬럼이 없어 항상 `False`/`0`으로 들어간다.

**(c) 부기(bookkeeping) 컬럼 8개**

`issue_key`, `created`, `risk_class`(타겟), `milestone_id`,
`title`, `due_date`, `updated_at`, `milestone_due_date`
(`NON_FEATURE_COLUMNS`에는 `proxy_deadline_hours`도 들어 있지만 `build_feature_row()`가 반환하지 않는 컬럼이라 실제로는 8개)
— 식별자·원시 타임스탬프·자유 텍스트라 그 자체로는 피처가 아니다
(정보는 `summary_length` / `elapsed_hours_at_cutoff` / `has_milestone` 등으로 이미 피처화됨).

### 5.4 피처 선정 — 상관계수 R² 기반

4개 모델을 공정하게 비교하려면 피처가 동일해야 한다. 각 모델이 자기 방식으로 중요도를 재면
"어떤 모델이 유리한 피처를 골랐는가"가 알고리즘 비교에 섞여 들어간다. 그래서 **모델에 의존하지 않는
상관계수로 한 번만 선정**해 4개 모델이 완전히 같은 피처를 쓰게 한다.

명목형 컬럼(`issuetype_name` 등)은 임의의 정수 코드로 상관계수를 내면 코드 순서에 따라 왜곡되므로,
원-핫으로 펼쳐 더미별 R²를 구한 뒤 같은 원본 컬럼의 R²를 합산해 되돌린다.

**선정 결과 (후보 22개 → 5개, 기준: R² 비중 ≥ 1.0%)**

| 순위 | 피처 | R² | R² 비중 | 신호 |
|---|---|---|---|---|
| 1 | `status_at_cutoff` | 0.3357 | **54.9%** | 관찰 시점 상태 — `Blocked`면 주의/위험 쪽 |
| 2 | `blocked_hours_before_cutoff` | 0.1979 | **32.4%** | 블로커 누적 체류시간 — 길수록 위험 |
| 3 | `num_events_before_cutoff` | 0.0266 | 4.4% | 변경 이력 총량 |
| 4 | `hours_in_current_status` | 0.0217 | 3.5% | 마지막 수정 이후 방치된 시간 |
| 5 | `activity_count_recent_window` | 0.0214 | 3.5% | 최근 3일 활동 — 무활동은 위험 전조 |

**탈락한 상위권** (참고): `issuetype_name` 0.48%, `project_key` 0.39%, `num_comments_before_cutoff` 0.10%,
`hours_since_last_comment` 0.05%, `progress_ratio_at_cutoff` 0.003%.

상위 2개(`status_at_cutoff` + `blocked_hours_before_cutoff`)가 전체 설명력의 **87.3%**를 차지한다.
데이터 생성 시나리오가 라벨을 블로커 여부·블로커 체류시간으로 갈라놓기 때문에 당연한 결과이지만,
바꿔 말하면 **모델이 사실상 "블로커 상태와 그 체류시간"만 보고 판정하고 있다**는 뜻이기도 하다(→ 9. 한계).

### 5.5 인코딩 방식

| 방식 | 대상 | 설명 |
|---|---|---|
| **범주형 네이티브** | `status_at_cutoff` (최종 선정된 유일한 범주형) | LightGBM의 `category` dtype 기능을 그대로 사용. 학습 시 카테고리 목록을 `category_maps`로 저장해 추론 때 동일하게 복원 |
| **빈도 인코딩** | `reporter`, `assignee_at_cutoff` | 카디널리티가 높아(담당자 72종) 학습셋 등장 빈도로 치환. 추론 시 처음 보는 값은 0 |

`train_and_save`(학습)와 `predict_class_probabilities`(추론)가 동일한 인코딩 로직을 공유해 train/serve skew를 막는다.

---

## 6. 데이터 분할

**`train_test_split(test_size=0.2, stratify=risk_class, random_state=42)`** → train 3,600행 / valid 900행.

Jira 시절에는 같은 이슈의 여러 스냅샷이 train/valid에 걸쳐 나뉘는 **그룹 누수**를 막기 위해
`StratifiedGroupKFold`(issue_key 단위 그룹 분할)를 썼다. 지금은 `mock_issue_dataset.py`가 업무당 학습 행을
**1개만** 만들어 `issue_key`가 항상 유일하므로 그룹 분할이 불필요하다 — 행 단위 층화 분할이면 충분하다.

---

## 7. 학습 기법

| 항목 | 값/방법 |
|---|---|
| 목적함수 | `multiclass`, `num_class=3` |
| 학습 중 모니터링 지표 | `multi_logloss`, `multi_error` |
| 최종 평가 지표 | `F1-Macro`, **`F2-Macro`**, `classification_report`, 혼동행렬 |
| 클래스 불균형 보정 | **SMOTENC** (train에만 적용, valid는 원본 분포 유지) — 단 데이터가 이미 균형이라 실질 no-op |
| 하이퍼파라미터 탐색 | **MLflow** file store (`mlruns/delay_risk`), 4모델 × 3구성 = **12 trial** |
| 최적 구성 선택 기준 | 검증 `macro avg f1-score` 최대 |
| 조기 종료 | `early_stopping(30)` (RandomForest 제외) |
| 결측치 처리 | 별도 대치 없이 LightGBM 네이티브 결측 분기 사용 |

**SMOTE / SMOTENC를 쓰는 이유**: 일반 SMOTE는 모든 피처가 연속형이라고 가정해 두 값 사이를 보간한다.
`status_at_cutoff` 같은 범주형이 섞여 있으면 존재하지 않는 값이 생기므로, 연속형은 보간하고 범주형은
이웃의 값을 그대로 가져오는 **SMOTENC**를 쓴다(RandomForest는 원-핫 이후 전부 연속형이라 일반 SMOTE 사용).
**valid에는 적용하지 않는다** — 합성 표본이 섞이면 검증 점수가 부풀려지기 때문이다.

---

## 8. 학습 결과

### 8.1 4개 모델 비교 (튜닝 전 베이스라인, `learning_rate=0.05`)

| 모델 | macro precision | macro recall | **macro F1** | **macro F2** |
|---|---|---|---|---|
| **LightGBM** | 0.7355 | 0.7411 | **0.7335** | **0.7369** |
| CatBoost | 0.7336 | 0.7400 | 0.7324 | 0.7358 |
| XGBoost | 0.7351 | 0.7400 | 0.7334 | 0.7363 |
| RandomForest | 0.6975 | 0.6978 | 0.6972 | 0.6974 |

LightGBM / CatBoost / XGBoost는 사실상 동률(0.732~0.734)이고, RandomForest만 약 0.036 낮다.

### 8.2 MLflow 하이퍼파라미터 튜닝 (12 trial)

| 순위 | 모델 | trial | 주요 파라미터 | macro F1 | macro F2 |
|---|---|---|---|---|---|
| **1** | **LightGBM** | **2** | `lr=0.05, num_leaves=63, min_data_in_leaf=10, rounds=500` | **0.7399** | **0.7425** |
| 2 | CatBoost | 3 | `lr=0.08, depth=6, l2=5, iter=400` | 0.7370 | 0.7403 |
| 3 | CatBoost | 1 | `lr=0.03, depth=4, l2=3, iter=500` | 0.7369 | 0.7402 |
| 4 | LightGBM | 3 | `lr=0.08, num_leaves=31, min_data_in_leaf=10, rounds=400` | 0.7364 | 0.7396 |
| 5 | XGBoost | 1 | `lr=0.03, max_depth=4, n_est=500` | 0.7337 | 0.7371 |
| 6 | CatBoost | 2 | `lr=0.05, depth=6, l2=3, iter=500` | 0.7324 | 0.7358 |
| 7 | LightGBM | 1 | `lr=0.03, num_leaves=31, min_data_in_leaf=20, rounds=500` | 0.7284 | 0.7320 |
| 8 | XGBoost | 3 | `lr=0.08, max_depth=5, n_est=400` | 0.7259 | 0.7293 |
| 9 | RandomForest | 2 | `n_est=500, max_depth=12, sqrt` | 0.7257 | 0.7279 |
| 10 | XGBoost | 2 | `lr=0.05, max_depth=6, n_est=500` | 0.7216 | 0.7251 |
| 11 | RandomForest | 3 | `n_est=500, min_samples_leaf=2, log2` | 0.7135 | 0.7147 |
| 12 | RandomForest | 1 | `n_est=300, sqrt` | 0.6961 | 0.6963 |

**최종 채택**: LightGBM trial 2 — `learning_rate=0.05`, `num_leaves=63`, `min_data_in_leaf=10`,
`num_boost_round=500`. 검증 **macro F1 0.7399 / macro F2 0.7425**.
튜닝으로 얻은 개선폭은 베이스라인 대비 +0.0064로 크지 않다 — 성능 상한이 하이퍼파라미터가 아니라
**피처가 담고 있는 신호량**에 걸려 있다는 뜻이다.

### 8.3 클래스별 성능 (최적 모델, 검증셋 900행)

베이스라인 LightGBM 기준 `classification_report`:

| 클래스 | precision | recall | f1-score | support |
|---|---|---|---|---|
| 정상 | 0.80 | 0.97 | 0.87 | 300 |
| 주의 | 0.68 | 0.66 | 0.67 | 300 |
| 위험 | 0.73 | 0.60 | 0.66 | 300 |
| **macro avg** | **0.74** | **0.74** | **0.73** | 900 |

### 8.4 혼동 행렬 (최적 모델 = LightGBM trial 2)

| 실제 \ 예측 | 정상 | 주의 | 위험 |
|---|---|---|---|
| **정상** | **283** | 12 | 5 |
| **주의** | 36 | **199** | 65 |
| **위험** | 35 | 76 | **189** |

**해석**:

- **'정상'은 거의 완벽하다** (recall 0.94, 300건 중 283건 적중). 정상 업무는 블로커가 0%라
  `status_at_cutoff`/`blocked_hours` 신호만으로 깨끗하게 갈린다.
- **주된 오류는 '주의' ↔ '위험' 혼동이다** — 주의를 위험으로 65건, 위험을 주의로 76건 오분류.
  두 라벨 모두 절반이 `blocked` 상태이고, 이들을 가르는 건 `blocked_ratio`가 0.12~0.28이냐 0.35~0.7이냐인데
  그 분모(마감까지의 총 기간)는 **누수 방지를 위해 피처에서 제외**돼 있다. 즉 모델은 비율의 분자
  (`blocked_hours`)만 보고 판단해야 하므로 원리적으로 이 둘을 완전히 구분할 수 없다.
- **'위험'을 '정상'으로 놓치는 경우가 35건(11.7%)** 있다. 관리자 개입 신호라는 목적상 가장 비용이 큰 오류다.
  대부분 '위험-마감초과형'(블로커 없이 마감만 넘긴 케이스)으로 추정된다 — 이 분기의 유일한 구분 신호가
  `elapsed_ratio`인데 그것이 누수 컬럼이라 제외됐기 때문이다.
- macro F1(0.7399)과 macro F2(0.7425)가 거의 같다는 것은 정밀도와 재현율이 균형을 이뤘다는 의미다.
  다만 클래스가 완전 균형이라 accuracy와 macro avg가 거의 같아지므로, 이 데이터셋에서는 accuracy를 봐도 무방하다
  (실제 운영 데이터는 '정상'에 크게 쏠릴 것이므로 그때는 반드시 macro를 봐야 한다).

### 8.5 이전 기록(macro F1 0.7907)과의 차이

노트북에 저장된 실행 결과(2026-07-21)는 피처 8개 / macro F1 0.7907이지만, **그 이후 `COMMENT_USAGE_PROB=0.15`가
도입되면서(커밋 `2bb58ed5`) 지표가 0.7399로 내려갔다.** 원인은 명확하다.

| | 이전 (댓글 항상 생성) | 현재 (댓글 86% 없음) |
|---|---|---|
| 선정 피처 수 | 8개 | **5개** |
| `hours_since_last_comment` | R² 비중 15.0% (3위) | **0.05%** (탈락) |
| `num_comments_before_cutoff` | 4.5% (5위) | 0.10% (탈락) |
| `num_unique_commenters` | 1.9% (8위) | 0.03% (탈락) |
| macro F1 / F2 | 0.7907 / 0.7908 | **0.7399 / 0.7425** |

댓글이 없는 업무는 `hours_since_last_comment`가 `elapsed_hours`와 동일한 값으로 채워지므로(fallback),
86%가 댓글 0건이 되자 이 피처가 라벨과의 상관을 거의 잃었다. `stalled` 장치가 노렸던
"정체된 업무는 최근 댓글이 뜸하다"는 신호가 통째로 사라진 것이다.

**이 하락은 회귀가 아니라 의도된 현실화다.** 팀이 업무 댓글을 거의 쓰지 않을 것이라는 전제가 맞다면,
0.79는 서빙 시점에는 존재하지 않을 신호에 기댄 낙관적 수치였고 0.74가 실제에 가깝다.
`activity_count_recent_window`(활동 로그 기반)는 여전히 살아남아 5위(3.5%)를 지키고 있다.

> 노트북(`delay_model.ipynb`)에 저장된 셀 출력은 아직 2026-07-21 실행분(8피처/0.7907)이다.
> 배포된 `delay_model.pkl`(2026-07-22 학습)은 현재 코드와 동일한 **5피처 구성**이므로,
> **노트북 출력만 갱신이 필요하다**(노트북을 다시 실행해 저장하면 해소됨).

---

## 9. 기타 중요 사항 및 한계

### 9.1 합성 데이터의 근본적 한계

성능 수치는 "이 합성 데이터의 생성 규칙을 모델이 얼마나 잘 되짚어내는가"를 측정한 것이지,
**실제 팀의 지연 패턴을 얼마나 잘 맞히는가가 아니다.** 실 운영 데이터가 쌓이면 반드시 재검증해야 한다.

### 9.2 피처 간 완전 공선성 (실측 확인)

| 관계 | 확인 결과 |
|---|---|
| `blocked` 상태에서 `hours_in_current_status` == `blocked_hours_before_cutoff` | **100% 일치** |
| `snapshot_offset_days` == `elapsed_hours_at_cutoff / 24` | **100% 일치** |
| 댓글 0건일 때 `hours_since_last_comment` == `elapsed_hours_at_cutoff` | **100% 일치** |

`build_feature_row()`가 `blocked_hours = hours_in_current_status if is_blocked_status(...) else 0.0`으로
정의하기 때문에 발생하는 구조적 중복이다. 최종 피처 5개 중 2개(`blocked_hours_before_cutoff`,
`hours_in_current_status`)가 이 관계에 있으므로, 실질 독립 신호는 5개보다 적다.

### 9.3 신호가 블로커에 과도하게 집중

상위 2개 피처가 설명력의 87.3%를 차지한다. 이는 실질적으로 **"블로커면 위험, 아니면 정상"에 가까운
규칙을 학습한 것**에 가깝다. 실제 운영에서 블로커 표시를 성실히 하지 않는 팀이라면 모델이 거의 작동하지 않는다.

### 9.4 마감일 없는 장기 방치 업무

마감일이 없고 경과 시간이 매우 긴(최대 120일) 업무는 카테고리 폴백(기준 10~168시간)이 적용되어
`elapsed_ratio_at_cutoff`가 매우 크게 나올 수 있다. 이 컬럼은 학습에서 제외되므로 직접적인 문제는 아니고,
실제 운영에서도 동일하게 나타나는 현상이라 별도 보정하지 않았다.

### 9.5 '주의'/'위험' 구분 능력의 상한

8.4에서 본 대로, 두 라벨을 가르는 정보(`blocked_ratio`, `elapsed_ratio`)가 누수 컬럼이라 제외돼 있다.
현재 피처만으로는 이 둘을 완전히 구분할 수 없다. 개선하려면 누수가 아닌 형태로 마감일 정보를 넣어야 한다
(예: `hours_until_deadline`을 라벨 배정에 쓰지 않는 별도 시나리오로 재설계).

### 9.6 모델 아티팩트 구성

`booster` 외에 아래를 함께 `joblib`으로 직렬화(`models/delay_model.pkl`)해, 추론 시 학습과 완전히 동일한
인코딩·Proxy Deadline 조회를 보장한다.

`feature_names` / `categorical_columns` / `frequency_maps` / `category_maps` /
`proxy_deadline_map`(54조합) / `global_median_duration_hours`(42.0) / `model_type` / `model_feature_columns`

`.pkl`은 저장소 비대화 문제로 git에 커밋하지 않는다(`.gitignore`). 배포 시에는 `fetch_model.py`가
Hugging Face에서 내려받으며, `DELAY_RISK_HF_MODEL_SHA256`이 설정돼 있으면 체크섬을 검증한다
(joblib/pickle 역직렬화는 임의 코드 실행이 가능하므로 이 검증이 신뢰 경계다).

### 9.7 코드 구조

- `delay_model.ipynb` — 학습 파이프라인의 유일한 원본(피처 선정 → 분할 → 4모델 → MLflow 튜닝 → 저장)
- `delay_model.py` — 아티팩트 정의/저장/로드 + 실시간 추론 (프로덕션이 평범한 모듈로 import)
- `delay_service.py` — Supabase 행 → 피처 변환(`build_feature_row`) + 예측 + `ml_predictions` 적재
- `train.py` — `_notebook_runtime`으로 노트북을 스크립트처럼 실행 (`python -m ml_delay_risk.train`)

---

## 10. 재현 방법

```bash
cd App/backend_fastapi

# 데이터셋만 생성 (CSV 저장)
python -c "from ml_delay_risk.models.mock_issue_dataset import build_training_dataframe; \
           df,_,_ = build_training_dataframe(limit=4500, num_projects=12, seed=42); \
           df.to_csv('mock_issue_dataset.csv', index=False, encoding='utf-8-sig')"

# 전체 학습 파이프라인 (피처 선정 → 4모델 → MLflow 튜닝 → delay_model.pkl 저장)
python -m ml_delay_risk.train --limit 4500 --test-size 0.2

# 기존 모델을 덮어쓰지 않고 결과만 확인하려면 저장 경로를 분리
DELAY_RISK_MODEL_DIR=/tmp/model_out python -m ml_delay_risk.train --limit 4500

# MLflow UI로 12개 trial 비교
mlflow ui --backend-store-uri mlruns/delay_risk
```

seed가 고정되어 있어 위 명령은 항상 동일한 데이터셋과 동일한 지표를 재현한다.
