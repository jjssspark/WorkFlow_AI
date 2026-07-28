from __future__ import annotations

import os
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.security import verify_internal_api_key
from llm_checklist.app.checklist_schema import ChecklistGenerateResponse, ChecklistItemSuggestion
from llm_checklist.app.routers.checklist_router import router

app = FastAPI()
app.include_router(router)
app.dependency_overrides[verify_internal_api_key] = lambda: None
client = TestClient(app, raise_server_exceptions=False)


def test_generate_returns_500_when_ollama_fails():
    with patch.dict(os.environ, {"CHECKLIST_PROVIDER": "ollama"}), \
         patch("llm_checklist.app.checklist_pipeline.generate_checklist_with_ollama",
               side_effect=RuntimeError("ollama down")):
        res = client.post("/ai/checklist/generate", json={"title": "로그인 API", "category": "backend"})
    assert res.status_code == 500


def test_generate_uses_ollama_when_available():
    fake = ChecklistGenerateResponse(items=[ChecklistItemSuggestion(title="API 설계", reason="x")], engine="ollama")
    with patch.dict(os.environ, {"CHECKLIST_PROVIDER": "ollama"}), \
         patch("llm_checklist.app.checklist_pipeline.generate_checklist_with_ollama", return_value=fake):
        res = client.post("/ai/checklist/generate", json={"title": "로그인 API", "category": "backend"})
    body = res.json()
    assert body["engine"] == "ollama"
    assert body["items"][0]["title"] == "API 설계"


def test_generate_uses_huggingface_when_provider_is_hf():
    fake = ChecklistGenerateResponse(
        items=[ChecklistItemSuggestion(title="JWT 생성 로직 구현", reason="인증 필수")], engine="huggingface")
    with patch.dict(os.environ, {"CHECKLIST_PROVIDER": "huggingface"}), \
         patch("llm_checklist.app.checklist_pipeline.generate_checklist_with_huggingface", return_value=fake):
        res = client.post("/ai/checklist/generate", json={"title": "로그인 API", "category": "backend"})
    body = res.json()
    assert body["engine"] == "huggingface"
    assert body["items"][0]["title"] == "JWT 생성 로직 구현"


def test_generate_returns_500_when_huggingface_fails():
    with patch.dict(os.environ, {"CHECKLIST_PROVIDER": "huggingface"}), \
         patch("llm_checklist.app.checklist_pipeline.generate_checklist_with_huggingface",
               side_effect=RuntimeError("hf down")):
        res = client.post("/ai/checklist/generate", json={"title": "로그인 API", "category": "backend"})
    assert res.status_code == 500
