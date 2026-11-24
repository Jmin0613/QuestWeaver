package com.jmin.questweaver.quest;

import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.util.concurrent.CompletableFuture;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class OpenAiSettingsTests {
    private final ObjectMapper json = new ObjectMapper();

    @Test
    @SuppressWarnings("unchecked")
    void keysArePerRequestAndStorageConfigurationDoesNotCallApi() {
        var client = mock(HttpClient.class);
        var provider = new OpenAiDraftProvider(json, "fake-environment", "existing-model", client);
        assertThat(provider.configured()).isTrue();
        verifyNoInteractions(client);
        HttpResponse<String> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(200);
        when(response.body()).thenReturn("""
                {"status":"completed","output":[{"type":"message","status":"completed",
                "content":[{"type":"output_text","text":"{}"}]}]}
                """);
        when(client.sendAsync(any(HttpRequest.class), any(HttpResponse.BodyHandler.class))).thenAnswer(call -> {
            HttpRequest request = call.getArgument(0);
            assertThat(request.uri().toString()).isEqualTo("https://api.openai.com/v1/responses");
            assertThat(request.headers().firstValue("Authorization")).contains("Bearer fake-app-key");
            return CompletableFuture.completedFuture(response);
        });
        assertThat(provider.generate("rules", "source", json.createObjectNode(), "fake-app-key")).isEqualTo("{}");
        verify(client, times(1)).sendAsync(any(HttpRequest.class), any(HttpResponse.BodyHandler.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void providerCodesAndNetworkFailuresHaveSanitizedDistinctMessagesWithoutRetry() {
        var client = mock(HttpClient.class);
        var provider = new OpenAiDraftProvider(json, "fake-key", "model", client);
        for (String[] failure : new String[][] {
                {"401", "invalid_api_key", "인증"}, {"429", "insufficient_quota", "크레딧"},
                {"429", "credit_balance_exhausted", "크레딧"},
                {"429", "organization_spend_limit_exceeded", "크레딧"},
                {"429", "project_spend_limit_exceeded", "크레딧"},
                {"429", "organization_usage_limit_exceeded", "크레딧"},
                {"429", "rate_limit_exceeded", "호출 제한"}, {"403", "account_deactivated", "인증"} }) {
            HttpResponse<String> response = mock(HttpResponse.class);
            when(response.statusCode()).thenReturn(Integer.parseInt(failure[0]));
            when(response.body()).thenReturn("{\"error\":{\"code\":\"" + failure[1]
                    + "\",\"message\":\"never expose fake-key\"}}");
            when(client.sendAsync(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                    .thenReturn(CompletableFuture.completedFuture(response));
            assertThatThrownBy(() -> provider.generate("rules", "source", json.createObjectNode()))
                    .hasMessageContaining(failure[2]).hasMessageNotContaining("fake-key").hasMessageNotContaining("never expose");
        }
        for (Exception failure : new Exception[] {new IOException("fake-key"), new HttpTimeoutException("fake-key")}) {
            when(client.sendAsync(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                    .thenReturn(CompletableFuture.failedFuture(failure));
            assertThatThrownBy(() -> provider.generate("rules", "source", json.createObjectNode()))
                    .hasMessageContaining(failure instanceof HttpTimeoutException ? "시간" : "네트워크")
                    .hasMessageNotContaining("fake-key");
        }
        verify(client, times(10)).sendAsync(any(HttpRequest.class), any(HttpResponse.BodyHandler.class));
    }
}
