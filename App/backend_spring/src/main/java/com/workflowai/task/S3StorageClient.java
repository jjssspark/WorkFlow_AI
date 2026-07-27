package com.workflowai.task;

import java.io.InputStream;
import java.net.URI;
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

    public S3StorageClient(
        @Value("${workflow.storage.endpoint}") String endpoint,
        @Value("${workflow.storage.region}") String region,
        @Value("${workflow.storage.access-key}") String accessKey,
        @Value("${workflow.storage.secret-key}") String secretKey,
        @Value("${workflow.storage.bucket}") String bucket,
        @Value("${workflow.storage.path-style-access}") boolean pathStyleAccess
    ) {
        this.bucket = bucket;
        // 자격증명 검증(AwsBasicCredentials.create)은 값이 비어있으면 즉시 예외를 던진다. 스토리지를
        // 아직 설정하지 않은 환경(로컬/CI 등)에서도 앱 자체는 뜰 수 있도록, 검증을 빈 생성 시점이
        // 아니라 실제 요청 시점으로 미룬다(resolveCredentials는 호출될 때만 실행됨).
        AwsCredentialsProvider credentialsProvider = () -> AwsBasicCredentials.create(accessKey, secretKey);
        S3Configuration serviceConfiguration =
            S3Configuration.builder().pathStyleAccessEnabled(pathStyleAccess).build();

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
     */
    public String createSignedUrl(String path, int expiresInSeconds, String downloadFileName) {
        GetObjectRequest.Builder getObjectRequest = GetObjectRequest.builder().bucket(bucket).key(path);
        if (downloadFileName != null && !downloadFileName.isBlank()) {
            getObjectRequest.responseContentDisposition("attachment; filename=\"" + downloadFileName + "\"");
        }
        GetObjectPresignRequest presignRequest = GetObjectPresignRequest.builder()
            .signatureDuration(Duration.ofSeconds(expiresInSeconds))
            .getObjectRequest(getObjectRequest.build())
            .build();
        PresignedGetObjectRequest presigned = presigner.presignGetObject(presignRequest);
        return presigned.url().toString();
    }
}
