package com.workflowai.presence;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class PresenceServiceTest {

    @Test
    void release_removesOnlyMatchingSession() {
        PresenceService service = new PresenceService();

        assertThat(service.tryAcquire(1L, "session-a")).isTrue();
        service.release(1L, "session-b");

        assertThat(service.isActive(1L)).isTrue();
        service.release(1L, "session-a");
        assertThat(service.isActive(1L)).isFalse();
    }

    @Test
    void tryAcquire_blocksDifferentActiveSessionForSameUser() {
        PresenceService service = new PresenceService();

        assertThat(service.tryAcquire(1L, "session-a")).isTrue();
        assertThat(service.tryAcquire(1L, "session-b")).isFalse();
        assertThat(service.tryAcquire(1L, "session-a")).isTrue();
    }

    @Test
    void touch_doesNotCreateUnacquiredSession() {
        PresenceService service = new PresenceService();

        assertThat(service.touch(1L, "unknown-session")).isFalse();

        assertThat(service.isActive(1L)).isFalse();
    }

    @Test
    void touch_extendsOnlyAcquiredSession() {
        PresenceService service = new PresenceService();

        assertThat(service.tryAcquire(1L, "session-a")).isTrue();
        assertThat(service.touch(1L, "session-a")).isTrue();
        assertThat(service.touch(1L, "session-b")).isFalse();

        assertThat(service.isActive(1L)).isTrue();
    }

    /**
     * UT-131. 접속자 목록은 프로젝트 멤버 전원을 후보로 넘기고 그중 활성 상태만 골라낸다.
     *
     * <p>PresenceControllerTest는 이 메서드를 목으로 대체하므로 걸러내는 동작 자체는 거기서 검증되지
     * 않는다 - 필터를 통째로 지워 후보를 그대로 돌려줘도 컨트롤러 테스트는 전부 통과한다.
     *
     * <p>사전조건의 "중복 없이"는 여기서 만들어지는 성질이 아니다. 후보 목록은 project_members에서
     * 오고 그 테이블에 {@code UNIQUE (project_id, user_id)}가 걸려 있어 한 사용자가 두 번 들어올 수
     * 없다. 이 메서드는 받은 순서와 개수를 그대로 두고 걸러내기만 한다.
     */
    @Test
    void activeUserIds_keepsOnlyUsersWithAnOpenSession() {
        PresenceService service = new PresenceService();

        assertThat(service.tryAcquire(1L, "session-a")).isTrue();
        assertThat(service.tryAcquire(3L, "session-c")).isTrue();
        // 2번은 접속한 적이 없다. 이 대조군이 없으면 필터를 지워도 단정이 그대로 성립한다.

        assertThat(service.activeUserIds(List.of(1L, 2L, 3L))).containsExactly(1L, 3L);
    }

    /** 로그아웃한 사용자는 접속자 목록에서 즉시 빠진다. */
    @Test
    void activeUserIds_dropsUsersAfterRelease() {
        PresenceService service = new PresenceService();

        assertThat(service.tryAcquire(1L, "session-a")).isTrue();
        assertThat(service.activeUserIds(List.of(1L))).containsExactly(1L);

        service.release(1L, "session-a");

        assertThat(service.activeUserIds(List.of(1L))).isEmpty();
    }
}
