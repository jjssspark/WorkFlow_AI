package com.workflowai.task;

import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedGetObjectRequest;

/**
 * S3 호환 오브젝트 스토리지 클라이언트. 지금은 Supabase Storage의 S3 엔드포인트를 쓰지만, AWS SigV4
 * 기반 표준 S3 프로토콜이라 OCI Object Storage로 이관할 때도 endpoint/region/자격증명 설정값만
 * 바꾸면 이 클래스는 그대로 재사용할 수 있다. 접근 제어("담당자만 업로드 가능" 등)는 이 클래스가
 * 아니라 이 클래스를 호출하는 TaskResultController/AuthService에서 한다 — 여기 쓰는 자격증명은
 * 버킷 정책을 우회하는 관리자 성격의 키다.
 */
@Component
public class S3StorageClient {
    private final S3Client s3Client;
    private final S3Presigner presigner;
    private final String bucket;
    private final boolean configured;

    public S3StorageClient(
        @Value("${workflow.storage.endpoint}") String endpoint,
        @Value("${workflow.storage.region}") String region,
        @Value("${workflow.storage.access-key}") String accessKey,
        @Value("${workflow.storage.secret-key}") String secretKey,
        @Value("${workflow.storage.bucket}") String bucket,
        @Value("${workflow.storage.path-style-access}") boolean pathStyleAccess
    ) {
        this.bucket = bucket;
        this.configured = accessKey != null && !accessKey.isBlank() && secretKey != null && !secretKey.isBlank();
        // 자격증명 검증(AwsBasicCredentials.create)은 값이 비어있으면 즉시 예외를 던진다. 스토리지를
        // 아직 설정하지 않은 환경(로컬/CI 등)에서도 앱 자체는 뜰 수 있도록, 검증을 빈 생성 시점이
        // 아니라 실제 요청 시점으로 미룬다(resolveCredentials는 호출될 때만 실행됨).
        AwsCredentialsProvider credentialsProvider = () -> AwsBasicCredentials.create(accessKey, secretKey);
        // OCI Object Storage는 AWS SDK v2 PutObject 기본값인 aws-chunked 전송 인코딩을 지원하지
        // 않는다(요청을 인증 실패로 거부함) - Supabase/OCI가 둘 다 "S3 호환"이어도 세부 동작까지
        // 완전히 같지는 않다는 걸 실측으로 확인했다. chunkedEncodingEnabled를 꺼서 일반 PUT으로
        // 보내야 두 프로바이더 모두에서 동작한다.
        S3Configuration serviceConfiguration = S3Configuration.builder()
            .pathStyleAccessEnabled(pathStyleAccess)
            .chunkedEncodingEnabled(false)
            .build();

        var clientBuilder = S3Client.builder()
            .region(Region.of(region))
            .credentialsProvider(credentialsProvider)
            .serviceConfiguration(serviceConfiguration);
        var presignerBuilder = S3Presigner.builder()
            .region(Region.of(region))
            .credentialsProvider(credentialsProvider)
            .serviceConfiguration(serviceConfiguration);
        if (endpoint != null && !endpoint.isBlank()) {
            URI endpointUri = URI.create(endpoint);
            clientBuilder.endpointOverride(endpointUri);
            presignerBuilder.endpointOverride(endpointUri);
        }
        this.s3Client = clientBuilder.build();
        this.presigner = presignerBuilder.build();
    }

    /** path는 버킷 하위 object 키(예: tasks/42/uuid-파일명.pdf). */
    public void upload(String path, InputStream content, long contentLength, String contentType) {
        PutObjectRequest request = PutObjectRequest.builder()
            .bucket(bucket)
            .key(path)
            .contentType(contentType != null ? contentType : "application/octet-stream")
            .contentLength(contentLength)
            .build();
        s3Client.putObject(request, RequestBody.fromInputStream(content, contentLength));
    }

    public void delete(String path) {
        s3Client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(path).build());
    }

    /**
     * 만료 시간이 있는 임시 다운로드 URL을 발급한다(버킷이 비공개라 직접 URL로는 못 받음).
     * downloadFileName을 지정하면 브라우저가 새 탭에 미리보기로 열지 않고 그 이름으로 바로
     * 다운로드하도록 Content-Disposition: attachment를 걸어준다.
     *
     * <p>스토리지 자격증명이 설정되지 않았으면 {@code null}을 돌려준다. 서명을 시도하면 AWS SDK가
     * NPE("Access key ID cannot be blank")를 던지는데, 프로필 사진 URL은 /me 응답마다 발급되므로
     * 스토리지를 안 붙인 환경에서는 정상 요청마다 ERROR 스택트레이스가 쌓인다. 자격증명 미설정은
     * 장애가 아니라 그 환경의 상태이므로 예외가 아니라 반환값으로 알린다.
     * upload/delete는 실패를 사용자에게 알려야 하는 쓰기 작업이라 이 완화를 적용하지 않는다.
     */
    public String createSignedUrl(String path, int expiresInSeconds, String downloadFileName) {
        if (!configured) {
            return null;
        }
        GetObjectRequest.Builder getObjectRequest = GetObjectRequest.builder().bucket(bucket).key(path);
        if (downloadFileName != null && !downloadFileName.isBlank()) {
            getObjectRequest.responseContentDisposition(contentDisposition(downloadFileName));
        }
        GetObjectPresignRequest presignRequest = GetObjectPresignRequest.builder()
            .signatureDuration(Duration.ofSeconds(expiresInSeconds))
            .getObjectRequest(getObjectRequest.build())
            .build();
        PresignedGetObjectRequest presigned = presigner.presignGetObject(presignRequest);
        return presigned.url().toString();
    }

    /**
     * 원본 파일명을 그대로 따옴표 안에 넣으면 "가 있을 때 속성이 끊기거나(예: filename="a"; evil=1),
     * 제어문자(CRLF 등)로 헤더 자체가 오염될 수 있다(비ASCII는 RFC 2616 filename 속성 자체가
     * 원래 지원 안 함). ASCII로 정리한 filename과, RFC 5987 filename*(UTF-8 퍼센트 인코딩) 둘 다
     * 채워서 따옴표/제어문자/비ASCII 전부 안전하게 처리한다 — filename*을 인식하는 브라우저는 원본
     * 이름 그대로, 아니면 정리된 ASCII 이름으로 다운로드된다.
     */
    private static String contentDisposition(String downloadFileName) {
        String asciiFallback = downloadFileName
            .replaceAll("[^\\x20-\\x7E]", "_")
            .replace("\\", "_")
            .replace("\"", "'");
        String encoded = URLEncoder.encode(downloadFileName, StandardCharsets.UTF_8).replace("+", "%20");
        return "attachment; filename=\"" + asciiFallback + "\"; filename*=UTF-8''" + encoded;
    }
}
