package com.jmin.questweaver.quest;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
class OpenAiDraftProvider implements AiDraftProvider {
    private static final URI RESPONSES = URI.create("https://api.openai.com/v1/responses");
    private static final Duration TIMEOUT = Duration.ofSeconds(55);
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper json;
    private final String apiKey;
    private final String model;

    OpenAiDraftProvider(ObjectMapper json,
            @Value("${QUESTWEAVER_OPENAI_API_KEY:}") String apiKey,
            @Value("${QUESTWEAVER_OPENAI_MODEL:gpt-5.4-mini}") String model) {
        this.json = json;
        this.apiKey = apiKey.strip();
        this.model = model.strip();
    }

    @Override
    public boolean configured() {
        return !apiKey.isEmpty() && !model.isEmpty();
    }

    @Override
    public String generate(String instructions, String source, JsonNode schema) {
        if (!configured()) throw AiDraftFailure.CONFIGURATION.error();

        var body = Map.of(
                "model", model, "instructions", instructions, "input", source,
                "store", false, "max_output_tokens", 8192, "truncation", "disabled",
                "text", Map.of("format", Map.of("type", "json_schema", "name", "quest_flow_draft",
                        "strict", true, "schema", schema)));
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(RESPONSES).timeout(TIMEOUT)
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
        } catch (IllegalArgumentException invalidHeader) {
            throw AiDraftFailure.CONFIGURATION.error();
        }

        var pending = client.sendAsync(request, HttpResponse.BodyHandlers.ofString());
        HttpResponse<String> response;
        try {
            response = pending.get(TIMEOUT.toSeconds(), TimeUnit.SECONDS);
        } catch (TimeoutException timeout) {
            pending.cancel(true);
            throw AiDraftFailure.TIMEOUT.error();
        } catch (InterruptedException interrupted) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            throw AiDraftFailure.NETWORK.error();
        } catch (ExecutionException failure) {
            throw (failure.getCause() instanceof HttpTimeoutException
                    ? AiDraftFailure.TIMEOUT : AiDraftFailure.NETWORK).error();
        }
        checkStatus(response.statusCode());
        try {
            return completedText(json.readTree(response.body()));
        } catch (JacksonException malformed) {
            throw AiDraftFailure.INVALID.error();
        }
    }

    static void checkStatus(int status) {
        if (status >= 200 && status < 300) return;
        throw switch (status) {
            case 401, 403 -> AiDraftFailure.AUTHENTICATION.error();
            case 429 -> AiDraftFailure.LIMIT.error();
            case 408, 504 -> AiDraftFailure.TIMEOUT.error();
            default -> AiDraftFailure.UPSTREAM.error();
        };
    }

    static String completedText(JsonNode response) {
        if (response == null || !response.isObject()) throw AiDraftFailure.INVALID.error();
        String status = response.path("status").asString("");
        if ("incomplete".equals(status)) throw AiDraftFailure.INCOMPLETE.error();
        if (!"completed".equals(status) || !response.path("output").isArray()) throw AiDraftFailure.INVALID.error();
        List<String> text = new ArrayList<>();
        for (JsonNode item : response.path("output")) {
            if (!"message".equals(item.path("type").asString(""))) continue;
            if (!"completed".equals(item.path("status").asString(""))) throw AiDraftFailure.INCOMPLETE.error();
            if (!item.path("content").isArray()) throw AiDraftFailure.INVALID.error();
            for (JsonNode content : item.path("content")) {
                if ("refusal".equals(content.path("type").asString(""))) throw AiDraftFailure.REFUSAL.error();
                if ("output_text".equals(content.path("type").asString("")) && content.path("text").isString()) {
                    text.add(content.path("text").asString());
                }
            }
        }
        if (text.size() != 1 || text.getFirst().isBlank()) throw AiDraftFailure.INVALID.error();
        return text.getFirst();
    }
}
