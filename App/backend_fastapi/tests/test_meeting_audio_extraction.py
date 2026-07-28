from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import DocumentTextExtractionError, app, extract_audio_text, extract_uploaded_text
from core.security import verify_internal_api_key


@pytest.fixture(autouse=True)
def _bypass_internal_api_key():
    app.dependency_overrides[verify_internal_api_key] = lambda: None
    yield
    app.dependency_overrides.pop(verify_internal_api_key, None)


@dataclass
class FakeSegment:
    text: str


class FakeWhisperModel:
    def __init__(self, segments: list[FakeSegment]):
        self._segments = segments
        self.transcribe_calls: list[tuple[bytes, str]] = []

    def transcribe(self, audio, language=None, **kwargs):
        self.transcribe_calls.append((audio.read(), language))
        return iter(self._segments), object()


@pytest.mark.parametrize("file_name", ["meeting.mp3", "meeting.wav", "meeting.m4a", "meeting.ogg"])
def test_extract_uploaded_text_routes_audio_extensions_to_whisper(file_name):
    with patch("app.main.extract_audio_text", return_value="회의 내용 전사 결과") as mock_extract_audio:
        result = extract_uploaded_text(b"fake-audio-bytes", file_name)

    mock_extract_audio.assert_called_once_with(b"fake-audio-bytes")
    assert result == "회의 내용 전사 결과"


def test_extract_audio_text_joins_and_strips_segment_text():
    fake_model = FakeWhisperModel([FakeSegment(" 안녕하세요 "), FakeSegment("오늘 회의를 시작합니다.")])
    with patch("app.main.get_whisper_model", return_value=fake_model):
        result = extract_audio_text(b"fake-audio-bytes")

    assert result == "안녕하세요 오늘 회의를 시작합니다."
    assert fake_model.transcribe_calls == [(b"fake-audio-bytes", "ko")]


def test_extract_audio_text_raises_when_transcription_is_empty():
    fake_model = FakeWhisperModel([FakeSegment("   "), FakeSegment("")])
    with patch("app.main.get_whisper_model", return_value=fake_model):
        with pytest.raises(DocumentTextExtractionError):
            extract_audio_text(b"fake-audio-bytes")


def test_extract_audio_text_wraps_missing_dependency_as_extraction_error():
    with patch("app.main.get_whisper_model", side_effect=ImportError("faster_whisper missing")):
        with pytest.raises(DocumentTextExtractionError):
            extract_audio_text(b"fake-audio-bytes")


def test_extract_audio_text_wraps_unexpected_errors_as_extraction_error():
    with patch("app.main.get_whisper_model", side_effect=RuntimeError("decode failed")):
        with pytest.raises(DocumentTextExtractionError):
            extract_audio_text(b"fake-audio-bytes")


def test_transcribe_endpoint_returns_extracted_text():
    with patch("app.main.extract_audio_text", return_value="음성에서 추출된 텍스트") as mock_extract_audio:
        client = TestClient(app)
        response = client.post(
            "/api/v1/meetings/transcribe",
            files={"file": ("meeting.wav", b"fake-audio-bytes", "audio/wav")},
        )

    assert response.status_code == 200
    assert response.json() == {"text": "음성에서 추출된 텍스트"}
    mock_extract_audio.assert_called_once_with(b"fake-audio-bytes")


def test_transcribe_endpoint_returns_422_when_extraction_fails():
    with patch("app.main.extract_audio_text", side_effect=DocumentTextExtractionError("음성 파일에서 텍스트를 추출하지 못했습니다.")):
        client = TestClient(app)
        response = client.post(
            "/api/v1/meetings/transcribe",
            files={"file": ("silent.wav", b"fake-audio-bytes", "audio/wav")},
        )

    assert response.status_code == 422
