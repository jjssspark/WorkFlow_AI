package com.workflowai.notification;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 사용자별 SSE 구독을 메모리에 들고 있다가 새 알림을 즉시 push한다. 백엔드가 단일 인스턴스로
 * 운영되는 동안에만 유효한 설계 — 여러 인스턴스로 스케일아웃하면 Redis pub/sub 등으로
 * 인스턴스 간 팬아웃이 필요하다(현재 범위 밖).
 */
@Component
public class NotificationBroadcaster {
  private static final long EMITTER_TIMEOUT_MS = 30 * 60 * 1000L;

  private final Map<Long, CopyOnWriteArrayList<SseEmitter>> emittersByUser =
      new ConcurrentHashMap<>();

  public SseEmitter subscribe(Long userId) {
    SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT_MS);
    emittersByUser.computeIfAbsent(userId, key -> new CopyOnWriteArrayList<>()).add(emitter);

    Runnable cleanup = () -> remove(userId, emitter);
    emitter.onCompletion(cleanup);
    emitter.onTimeout(cleanup);
    emitter.onError(e -> cleanup.run());
    return emitter;
  }

  public void broadcast(Long userId, NotificationDto dto) {
    broadcast(userId, "notification", dto);
  }

  public void broadcast(Long userId, String eventName, Object payload) {
    List<SseEmitter> emitters = emittersByUser.get(userId);
    if (emitters == null) return;
    for (SseEmitter emitter : emitters) {
      try {
        emitter.send(SseEmitter.event().name(eventName).data(payload));
      } catch (Exception e) {
        remove(userId, emitter);
      }
    }
  }

  @Scheduled(fixedRate = 15_000)
  void sendHeartbeat() {
    for (Map.Entry<Long, CopyOnWriteArrayList<SseEmitter>> entry : emittersByUser.entrySet()) {
      for (SseEmitter emitter : entry.getValue()) {
        try {
          emitter.send(SseEmitter.event().comment("ping"));
        } catch (Exception e) {
          remove(entry.getKey(), emitter);
        }
      }
    }
  }

  int subscriberCount(Long userId) {
    CopyOnWriteArrayList<SseEmitter> emitters = emittersByUser.get(userId);
    return emitters == null ? 0 : emitters.size();
  }

  private void remove(Long userId, SseEmitter emitter) {
    emittersByUser.computeIfPresent(
        userId,
        (key, list) -> {
          list.remove(emitter);
          return list.isEmpty() ? null : list;
        });
  }
}
