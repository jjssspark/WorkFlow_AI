package com.workflowai.project;

/** 수락 결과. 어느 프로젝트에 들어갔는지를 클라이언트가 추측하지 않도록 id를 그대로 돌려준다. */
public record AcceptInvitationResponse(Long projectId) {
}
