package com.jmin.questweaver.quest;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

enum AiDraftFailure {
    CONFIGURATION(HttpStatus.SERVICE_UNAVAILABLE, "AI 연결 설정이 필요합니다. 앱 상단의 API 키 설정과 개발 환경의 모델 설정을 확인하세요."),
    AUTHENTICATION(HttpStatus.BAD_GATEWAY, "AI 서비스 인증에 실패했습니다. AI 연결 설정에서 키를 다시 등록하고 모델 접근 권한을 확인하세요."),
    LIMIT(HttpStatus.TOO_MANY_REQUESTS, "AI 호출 제한에 도달했습니다. 잠시 후 직접 다시 시도하세요."),
    QUOTA(HttpStatus.TOO_MANY_REQUESTS, "AI 크레딧 또는 사용 예산이 부족합니다. OpenAI API 계정의 결제와 사용 한도를 확인하세요."),
    NETWORK(HttpStatus.BAD_GATEWAY, "AI 서비스에 연결할 수 없습니다. 네트워크 연결을 확인하고 다시 시도하세요."),
    TIMEOUT(HttpStatus.GATEWAY_TIMEOUT, "AI 서비스 응답 시간이 초과되었습니다. 다시 시도하세요."),
    INCOMPLETE(HttpStatus.BAD_GATEWAY, "AI가 생성 결과를 끝까지 반환하지 못했습니다. 원문을 줄이거나 다시 시도하세요."),
    REFUSAL(HttpStatus.BAD_GATEWAY, "AI 서비스가 이 원문의 플로우 생성을 거절했습니다."),
    INVALID(HttpStatus.BAD_GATEWAY, "AI 응답의 플로우 형식이 올바르지 않습니다. 다시 생성해 주세요."),
    UPSTREAM(HttpStatus.BAD_GATEWAY, "AI 서비스가 요청을 처리하지 못했습니다. 모델 설정을 확인하거나 잠시 후 다시 시도하세요.");

    private final HttpStatus status;
    private final String message;

    AiDraftFailure(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }

    ResponseStatusException error() {
        return new ResponseStatusException(status, message);
    }
}
