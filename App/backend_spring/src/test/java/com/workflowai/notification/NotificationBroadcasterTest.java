package com.workflowai.notification;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

class NotificationBroadcasterTest {

  private final NotificationBroadcaster broadcaster = new NotificationBroadcaster();

  private static NotificationDto sampleDto() {
    return new NotificationDto(
        "1",
        "TASK_ASSIGNED",
        "제목",
        "내용",
        "task",
        "42",
        "7",
        false,
        "2026-07-26T00:00:00Z");
  }

  /**
   * SseEmitter는 실제 서블릿 응답이 있어야 전송 내역을 볼 수 있어, 테스트용 Handler를 직접 initialize해
   * 가로챈다. Handler가 package-private이므로 reflection으로 프록시를 만든다.
   */
  private static List<Object> captureSentData(SseEmitter emitter) throws Exception {
    List<Object> sent = new ArrayList<>();
    Class<?> handlerClass =
        Class.forName("org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter$Handler");
    Object handler =
        Proxy.newProxyInstance(
            ResponseBodyEmitter.class.getClassLoader(),
            new Class[] {handlerClass},
            new InvocationHandler() {
              @Override
              public Object invoke(Object proxy, java.lang.reflect.Method method, Object[] args)
                  throws Throwable {
                if ("send".equals(method.getName())) {
                  sent.add(args[0]);
                  return null;
                }
                return null;
              }
            });
    var initMethod = ResponseBodyEmitter.class.getDeclaredMethod("initialize", handlerClass);
    initMethod.setAccessible(true);
    initMethod.invoke(emitter, handler);
    return sent;
  }

  private static void installFailingHandler(SseEmitter emitter) throws Exception {
    Class<?> handlerClass =
        Class.forName("org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter$Handler");
    Object handler =
        Proxy.newProxyInstance(
            ResponseBodyEmitter.class.getClassLoader(),
            new Class[] {handlerClass},
            new InvocationHandler() {
              @Override
              public Object invoke(Object proxy, java.lang.reflect.Method method, Object[] args)
                  throws Throwable {
                if ("send".equals(method.getName())) {
                  throw new IOException("연결 끊김");
                }
                return null;
              }
            });
    var initMethod = ResponseBodyEmitter.class.getDeclaredMethod("initialize", handlerClass);
    initMethod.setAccessible(true);
    initMethod.invoke(emitter, handler);
  }

  @Test
  void subscribeRegistersTheEmitterForThatUserOnly() {
    broadcaster.subscribe(5L);

    assertThat(broadcaster.subscriberCount(5L)).isEqualTo(1);
    assertThat(broadcaster.subscriberCount(999L)).isEqualTo(0);
  }

  @Test
  void broadcastSendsToSubscribedEmitter() throws Exception {
    SseEmitter emitter = broadcaster.subscribe(5L);
    List<Object> sent = captureSentData(emitter);

    broadcaster.broadcast(5L, sampleDto());

    assertThat(sent).hasSize(1);
  }

  @Test
  void broadcastOnlyReachesTheTargetUser() throws Exception {
    SseEmitter emitterA = broadcaster.subscribe(1L);
    SseEmitter emitterB = broadcaster.subscribe(2L);
    List<Object> sentToA = captureSentData(emitterA);
    List<Object> sentToB = captureSentData(emitterB);

    broadcaster.broadcast(1L, sampleDto());

    assertThat(sentToA).hasSize(1);
    assertThat(sentToB).isEmpty();
  }

  @Test
  void broadcastToUserWithNoSubscribersDoesNothing() {
    broadcaster.broadcast(999L, sampleDto());
    // 예외 없이 조용히 무시되면 통과
  }

  @Test
  void supportsMultipleEmittersForTheSameUser() throws Exception {
    SseEmitter emitterA = broadcaster.subscribe(3L);
    SseEmitter emitterB = broadcaster.subscribe(3L);
    List<Object> sentToA = captureSentData(emitterA);
    List<Object> sentToB = captureSentData(emitterB);

    broadcaster.broadcast(3L, sampleDto());

    assertThat(sentToA).hasSize(1);
    assertThat(sentToB).hasSize(1);
  }

  @Test
  void removesEmitterWhenSendFails() throws Exception {
    SseEmitter emitter = broadcaster.subscribe(9L);
    installFailingHandler(emitter);
    assertThat(broadcaster.subscriberCount(9L)).isEqualTo(1);

    broadcaster.broadcast(9L, sampleDto());

    assertThat(broadcaster.subscriberCount(9L)).isEqualTo(0);
  }
}
