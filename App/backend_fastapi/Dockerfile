FROM python:3.12-slim
WORKDIR /app

# lightgbm이 런타임에 libgomp.so.1(OpenMP)을 필요로 함 - slim 이미지엔 기본 미포함
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# CPU 전용 PyTorch 휠을 먼저 설치한다. requirements.txt에 torch를 그냥 적으면 기본 PyPI 인덱스가
# CUDA 포함 빌드를 받아와 이미지가 수 GB 커진다 - RAG 임베딩 로컬 추론(embedding_service.py)은
# GPU가 필요 없으므로 반드시 CPU 휠 인덱스로 먼저 설치해 이후 requirements.txt 설치 시 재설치되지 않게 한다.
#
# --mount=type=cache로 pip 다운로드 캐시를 빌더에 남긴다(이미지 레이어에는 안 들어가므로 크기 영향 없음).
# 이게 없으면 requirements.txt가 한 줄만 바뀌어도 약 700초짜리 설치를 매번 처음부터 다시 받는데,
# 그 사이 PyPI 접속이 한 번만 흔들려도 레이어 전체가 버려진다(2026-07-28: numpy==2.2.6에서
# "from versions: none"으로 실패, 재시도만으로 성공). 캐시가 있으면 재시도가 받은 것부터 이어간다.
# --retries/--timeout은 pip 기본값(5회/15초)보다 늘려 짧은 네트워크 흔들림을 빌드 실패로 만들지 않는다.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --retries 10 --timeout 60 torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu

# requirements는 저장소 루트 requirements.txt로 통합됨 (빌드 컨텍스트는 루트, docker-compose.yml 참고)
# requirements 먼저 복사해서 설치 → 코드만 바뀌었을 땐 pip install을 다시 안 하고 캐시를 씀
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --retries 10 --timeout 60 -r requirements.txt

COPY App/backend_fastapi/app app
COPY App/backend_fastapi/core core
COPY App/backend_fastapi/llm_rag_assistant llm_rag_assistant
COPY App/backend_fastapi/ml_workload_score ml_workload_score
COPY App/backend_fastapi/ai_contribution_report ai_contribution_report
COPY App/backend_fastapi/contribution_score contribution_score
# 업무 체크리스트 AI 생성 (LLM)
COPY App/backend_fastapi/llm_checklist llm_checklist
# FS-3(대시보드) - 지연 위험도 예측
COPY App/backend_fastapi/ml_delay_risk ml_delay_risk
# ml_delay_risk/models/*.pkl은 git에 없으므로(.gitignore 참고),
# 컨테이너 기동 시 docker-entrypoint.sh가 Hugging Face Hub에서 내려받는다.
COPY App/backend_fastapi/docker-entrypoint.sh docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 8000
CMD ["./docker-entrypoint.sh"]
