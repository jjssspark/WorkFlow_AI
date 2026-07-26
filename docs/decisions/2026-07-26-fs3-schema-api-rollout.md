# FS3 스키마·API 변경 배포 계약

- 날짜: 2026-07-26
- 대상 브랜치: `feature/fs3_ml-delay-risk`
- 목적: 운영 DB 누락과 구버전 클라이언트 영향이 서비스 교체 뒤에 발견되는 일을 막는다.

## 병합 전 필수 게이트

백엔드 CI는 실제 PostgreSQL 17 컨테이너에 현재 `db/init` 스키마를 만든 뒤 운영
baseline(`20260721.1`) 상태를 재현한다. 이후 Flyway 전체 체인을 실행해 다음을 검증한다.

- `users`: `affiliation`, `field_tags`, `github_username`, `profile_image_path`,
  `terms_agreed_at`, `privacy_agreed_at`
- `tasks.done_date`: 기존 완료 업무의 `updated_at` 날짜 백필
- `milestones.start_date`
- 레거시 `users.field` 값을 신규 `field_tags` JSON 배열로 보존
- Flyway `validate` 성공

`ProductionSchemaMigrationTest`가 Docker 부재로 skip되면 CI도 실패한다. migration guard는
최초 도입 PR에서 이미 계획된 R100 경로 재편만 일회성으로 허용한다. guard가 base에 존재하는
이후 PR은 기존 V파일의 rename·수정·삭제를 모두 차단하고 신규 V파일 추가만 허용한다.

## API 호환성 결정

| 변경 | 호환성 처리 |
|---|---|
| 회원가입의 `termsAgreed`, `privacyAgreed` | 법적 동의를 서버가 확인해야 하므로 누락을 자동 `true`로 간주하지 않는다. 프론트엔드와 백엔드를 같은 릴리스로 배포하고, 구버전 가입 요청은 명시적인 400 응답을 받는다. |
| `UserSummary` 프로필·관리자 필드 | 기존 `id`, `email`, `name`을 유지한 additive JSON 변경이다. 클라이언트는 알 수 없는 응답 필드를 무시해야 한다. |
| 일반 업무 생성 | 기존 계약대로 프로젝트 구성원에게 허용한다. 팀장 전용으로 좁히지 않는다. |
| 마일스톤 생성·수정·삭제 | 권한 상승을 막기 위해 팀장 전용을 유지한다. 구버전 팀원 클라이언트에는 403을 반환하며 프론트엔드도 동일하게 쓰기 UI를 숨긴다. |

필수 동의와 마일스톤 권한은 보안 경계라서 무동의 가입이나 팀원 쓰기를 허용하는 호환성
fallback을 두지 않는다. 대신 응답 코드와 동시 배포 계약을 고정한다.

## 운영 적용 전후 확인

배포 전에는 Flyway 장부가 실패 없이 끝났고 새 migration이 pending 또는 success 상태인지
확인한다. 서비스 readiness 통과 후에는 아래 쿼리로 실제 스키마를 확인한다.

```sql
SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('users', 'affiliation'),
    ('users', 'field_tags'),
    ('users', 'github_username'),
    ('users', 'profile_image_path'),
    ('users', 'terms_agreed_at'),
    ('users', 'privacy_agreed_at'),
    ('tasks', 'done_date'),
    ('milestones', 'start_date')
  )
ORDER BY table_name, column_name;

SELECT version, description, success
FROM flyway_schema_history
WHERE version IN ('20260722.1', '20260727.2', '20260727.3')
ORDER BY installed_rank;
```

세 migration은 모두 additive이므로 코드 롤백 시 컬럼을 삭제하지 않는다. Flyway 실패 시에는
서비스 컨테이너를 반복 재기동하지 말고 장부와 실제 스키마를 먼저 대조한다.
