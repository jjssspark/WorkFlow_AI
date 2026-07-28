from __future__ import annotations

from fastapi import APIRouter, Depends

from core.security import verify_internal_api_key

from ..checklist_pipeline import generate_checklist
from ..checklist_schema import ChecklistGenerateRequest, ChecklistGenerateResponse

router = APIRouter(prefix="/ai/checklist", tags=["checklist"], dependencies=[Depends(verify_internal_api_key)])


@router.post("/generate", response_model=ChecklistGenerateResponse)
def generate(request: ChecklistGenerateRequest) -> ChecklistGenerateResponse:
    return generate_checklist(request)
