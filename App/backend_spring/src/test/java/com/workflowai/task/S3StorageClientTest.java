package com.workflowai.task;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayInputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * S3StorageClient는 실제 AWS를 안 써도 검증할 수 있다: presign(URL 서명 생성)은 순수 로컬 계산이라
 * 네트워크가 필요 없고, upload/delete는 JDK 내장 HttpServer로 가짜 S3 엔드포인트를 띄워 실제 요청이
 * 버킷/키 경로대로 나가는지 확인한다.
 */
class S3StorageClientTest {
    private HttpServer server;
    private volatile String lastMethod;
    private volatile String lastPath;

    @BeforeEach
    void startFakeS3() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            lastMethod = exchange.getRequestMethod();
            lastPath = exchange.getRequestURI().getPath();
            exchange.getRequestBody().readAllBytes();
            exchange.sendResponseHeaders("DELETE".equals(lastMethod) ? 204 : 200, -1);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopFakeS3() {
        server.stop(0);
    }

    private S3StorageClient client() {
        int port = server.getAddress().getPort();
        return new S3StorageClient(
            "http://127.0.0.1:" + port, "us-east-1", "test-access-key", "test-secret-key", "test-bucket", true
        );
    }

    @Test
    void constructsWithoutThrowingWhenCredentialsAreBlank() {
        assertThatCode(() -> new S3StorageClient("", "us-east-1", "", "", "task-results", true))
            .doesNotThrowAnyException();
    }

    @Test
    void signedUrlIsNullWhenStorageIsNotConfiguredInsteadOfThrowingOnEveryRequest() {
        // 자격증명이 비어 있으면 AWS SDK가 서명 시점에 NPE("Access key ID cannot be blank")를 던진다.
        // 프로필 사진 URL은 /me 응답마다 발급되므로, 그대로 두면 스토리지를 안 붙인 로컬/CI에서
        // 정상 요청 한 건마다 ERROR 스택트레이스가 쌓인다(2026-07-28 로컬 compose에서 확인).
        // "설정 안 됨"은 장애가 아니라 상태이므로 예외 대신 null로 알린다.
        S3StorageClient unconfigured = new S3StorageClient("", "us-east-1", "", "", "task-results", true);

        assertThat(unconfigured.createSignedUrl("avatars/1/pic.png", 60, null)).isNull();
    }

    @Test
    void uploadSendsPutToBucketAndKeyPath() {
        byte[] content = "hello".getBytes(StandardCharsets.UTF_8);
        client().upload("tasks/42/file.txt", new ByteArrayInputStream(content), content.length, "text/plain");

        assertThat(lastMethod).isEqualTo("PUT");
        assertThat(lastPath).isEqualTo("/test-bucket/tasks/42/file.txt");
    }

    @Test
    void deleteSendsDeleteToBucketAndKeyPath() {
        client().delete("tasks/42/file.txt");

        assertThat(lastMethod).isEqualTo("DELETE");
        assertThat(lastPath).isEqualTo("/test-bucket/tasks/42/file.txt");
    }

    @Test
    void signedUrlOmitsContentDispositionWhenNoDownloadFileNameGiven() {
        String url = client().createSignedUrl("tasks/42/file.txt", 60, null);

        assertThat(url).doesNotContain("response-content-disposition");
    }

    @Test
    void signedUrlSanitizesQuotesAndControlCharsInAsciiFallback() {
        String url = client().createSignedUrl("tasks/42/file.txt", 60, "evil\"; x=1\r\nInjected: yes.txt");

        String disposition = extractContentDisposition(url);
        assertThat(disposition).doesNotContain("\r").doesNotContain("\n").doesNotContain("\"; x=1");
        assertThat(disposition).contains("filename=\"evil'; x=1__Injected: yes.txt\"");
    }

    @Test
    void signedUrlEncodesNonAsciiFilenameInFilenameStar() {
        String url = client().createSignedUrl("tasks/42/file.txt", 60, "회의록.pdf");

        String disposition = extractContentDisposition(url);
        assertThat(disposition).contains("filename*=UTF-8''%ED%9A%8C%EC%9D%98%EB%A1%9D.pdf");
    }

    private String extractContentDisposition(String url) {
        String marker = "response-content-disposition=";
        int idx = url.indexOf(marker);
        assertThat(idx).isGreaterThan(-1);
        String rest = url.substring(idx + marker.length());
        int amp = rest.indexOf('&');
        String value = amp >= 0 ? rest.substring(0, amp) : rest;
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }
}
