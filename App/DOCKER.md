# Docker로 실행하기

파일 배치는 이미 적용되어 있다. (`docker-compose.yml`, `.env.example`은 `App/` 루트, 각 서비스의
`Dockerfile`/`.dockerignore`는 해당 서비스 폴더 안)

## 실행 방법

```bash
cd App
cp .env.example .env   # 값 채우기: DB 비밀번호, JWT_SECRET, LLM_API_KEY 등
docker compose up -d
```

- 프론트엔드: http://localhost:5173
- Spring Boot API: http://localhost:8080/api/v1/health
- Swagger UI: http://localhost:8080/swagger-ui/index.html
- AI FastAPI: http://localhost:8000/api/v1/health

## 현재 상태에서 알아둘 것

- **db / redis는 앱이 실제로 쓴다.** Spring은 JPA/Postgres/Redis 의존성을 갖고 있고
  (`build.gradle`), FastAPI도 `redis` 클라이언트로 캐시·`rag_epoch`를 다룬다.
- **kafka만 아직 코드에서 안 쓴다.** 컨테이너는 뜨지만 붙는 쪽이 없다. 나중에 연동할 때
  `KAFKA_BOOTSTRAP_SERVERS` 환경변수 이름이 실제 설정 프로퍼티 키와 맞는지 확인할 것.
- **DB 포트 충돌**: 로컬에 이미 PostgreSQL이 떠 있다면 `.env`에 `DB_HOST_PORT=5433` 추가.
- **frontend는 dev 서버가 아니다.** `frontend/Dockerfile`이 `pnpm build`로 만든 `dist`를
  nginx(5173 포트)로 서빙한다. HMR도 없고 소스 볼륨 마운트도 없으므로, 프론트 코드를 고친 뒤
  화면에서 확인하려면 반드시 다시 빌드해야 한다:

  ```bash
  docker compose up -d --build frontend
  ```

  이걸 빼먹으면 컨테이너는 멀쩡히 떠 있는 채로 예전 화면이 계속 보인다.
- **AI 어시스턴트 첫 응답이 느린 경우**: 로컬 ollama는 모델이 메모리에서 내려가 있으면
  로드에만 10초 이상 쓴다. `RAG_OLLAMA_KEEP_ALIVE`(기본 30m)로 붙들어 두고, Spring 쪽 대기
  한도는 `WORKFLOW_AI_ASSISTANT_READ_TIMEOUT_SECONDS`(기본 120초)로 조절한다.
