# 1단계(build): Gradle + JDK 21로 jar 파일만 만든다
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY gradlew settings.gradle build.gradle ./
COPY gradle gradle
# Windows에서 체크아웃하면 gradlew가 CRLF로 바뀌어 셔뱅(#!/bin/sh)이 깨짐 → 줄바꿈 정규화 후 실행권한 부여
RUN sed -i 's/\r$//' gradlew && chmod +x gradlew
COPY src src
RUN ./gradlew bootJar --no-daemon -x test

# 2단계(runtime): 빌드 결과(jar)만 가져와서 실행 — JDK가 아니라 더 가벼운 JRE 사용
FROM eclipse-temurin:21-jre
# 스캔본 PDF(텍스트 레이어가 없는 이미지 PDF)는 PDFBox로 글자를 뽑을 수 없어 OCR이 필요하다.
# 한국어 회의록이 주 대상이므로 kor 학습 데이터를 함께 설치한다.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-kor tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
