package com.jmin.questweaver.quest;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "spring.datasource.url=jdbc:h2:mem:questweaver-flow-tests")
class QuestFlowTests {
    @LocalServerPort
    int port;

    @Autowired
    ObjectMapper json;

    @Autowired
    JdbcTemplate jdbc;

    private final HttpClient client = HttpClient.newHttpClient();

    @Test
    void savesEditsAndClearsAFlowIndependentlyOfTheQuest() throws Exception {
        String quest = newDraft("순찰 훈련");
        String flow = quest + "/flow";
        jdbc.update("update quest set updated_at = dateadd('SECOND', -1, updated_at) where id = ?",
                UUID.fromString(quest.substring(quest.lastIndexOf('/') + 1)));
        JsonNode original = read(quest);
        assertThat(read(flow)).isEqualTo(json.valueToTree(FlowDocument.empty()));

        FlowDocument document = example();
        send("PUT", flow, document, 200);
        assertThat(read(flow)).isEqualTo(json.valueToTree(document));

        JsonNode updated = read(quest);
        assertThat(updated.path("createdAt")).isEqualTo(original.path("createdAt"));
        assertThat(updated.path("body").asText()).isEqualTo("첫 줄\n둘째 줄");
        assertThat(updated.path("author").asText()).isEqualTo("기획자");
        assertThat(updated.at("/summary/title").asText()).isEqualTo("순찰 훈련");
        assertThat(updated.at("/summary/writingState").asText()).isEqualTo("DRAFT");
        assertThat(Instant.parse(updated.at("/summary/updatedAt").asText()))
                .isAfter(Instant.parse(original.at("/summary/updatedAt").asText()));

        List<FlowDocument.Step> steps = new ArrayList<>(document.steps());
        FlowDocument.Step start = steps.getFirst();
        steps.set(0, new FlowDocument.Step(start.id(), start.kind(), start.title(), "변경된 설명", -420.0, 92.0));
        List<FlowDocument.Link> links = new ArrayList<>(document.links());
        FlowDocument.Link first = links.getFirst();
        links.set(0, new FlowDocument.Link(first.id(), first.from(), first.to(), "변경된 조건"));
        FlowDocument edited = new FlowDocument(steps, links, new FlowDocument.Viewport(-310.0, 75.0, 1.8));
        send("PUT", flow, edited, 200);
        assertThat(read(flow)).isEqualTo(json.valueToTree(edited));

        long game = send("POST", "/api/games", Map.of("name", "플로우 테스트 게임"), 201).path("id").asLong();
        send("PUT", quest, Map.of("gameId", game, "title", "등록된 퀘스트", "body", "등록 원문",
                "writingState", "REGISTERED"), 200);
        assertThat(read(flow)).isEqualTo(json.valueToTree(edited));
        send("PUT", flow, FlowDocument.empty(), 200);
        assertThat(read(flow)).isEqualTo(json.valueToTree(FlowDocument.empty()));
        assertThat(read(quest).at("/summary/writingState").asText()).isEqualTo("REGISTERED");

        send("DELETE", quest, null, 204);
        send("GET", flow, null, 404);
        UUID id = UUID.fromString(quest.substring(quest.lastIndexOf('/') + 1));
        assertThat(jdbc.queryForObject("select count(*) from quest_flow where quest_id = ?", Integer.class, id))
                .isZero();
    }

    @Test
    void rejectsMalformedSnapshotsWithoutChangingSavedFlowOrTimestamp() throws Exception {
        String quest = newDraft("검증");
        String flow = quest + "/flow";
        FlowDocument document = example();
        send("PUT", flow, document, 200);
        JsonNode before = read(quest);
        FlowDocument.Step step = document.steps().getFirst();
        FlowDocument.Link link = document.links().getFirst();

        send("PUT", flow, new FlowDocument(List.of(step, step), List.of(), document.viewport()), 400);
        send("PUT", flow, new FlowDocument(document.steps(), List.of(link, link), document.viewport()), 400);
        send("PUT", flow, new FlowDocument(List.of(step), List.of(link), document.viewport()), 400);
        send("PUT", flow, new FlowDocument(document.steps(), document.links(), new FlowDocument.Viewport(0.0, 0.0, 0.0)), 400);
        send("PUT", flow, Map.of("steps", List.of(), "links", List.of()), 400);

        assertThat(read(flow)).isEqualTo(json.valueToTree(document));
        assertThat(read(quest)).isEqualTo(before);

        // An incomplete graph may contain an isolated step and no start.
        FlowDocument incomplete = new FlowDocument(List.of(document.steps().get(1)), List.of(), document.viewport());
        send("PUT", flow, incomplete, 200);
        assertThat(read(flow)).isEqualTo(json.valueToTree(incomplete));
    }

    @Test
    void inspectsTheSubmittedGraphWithoutWritingToTheQuest() throws Exception {
        String quest = newDraft("검사할 퀘스트");
        String flow = quest + "/flow";
        FlowDocument saved = example();
        send("PUT", flow, saved, 200);
        JsonNode before = read(quest);
        var branch = step(FlowDocument.Kind.BRANCH, 0, 0);
        FlowDocument unsaved = new FlowDocument(List.of(branch), List.of(), saved.viewport());
        JsonNode warnings = send("POST", "/api/flow/inspect", unsaved, 200);
        assertThat(warnings.size()).isEqualTo(5);
        assertThat(warnings.at("/3/stepId").asString()).isEqualTo(branch.id().toString());
        assertThat(warnings.at("/3/code").asString()).isEqualTo("TOO_FEW_BRANCHES");
        assertThat(read(flow)).isEqualTo(json.valueToTree(saved));
        assertThat(read(quest)).isEqualTo(before);

        var invalid = new FlowDocument(List.of(branch, branch), List.of(), saved.viewport());
        send("POST", "/api/flow/inspect", invalid, 400);
        send("PUT", flow, unsaved, 200);
        assertThat(read(flow)).isEqualTo(json.valueToTree(unsaved));
    }

    @Test
    void restoresLegacyLinksAndPersistsStepDirections() throws Exception {
        String quest = newDraft("연결 위치");
        String flow = quest + "/flow";
        UUID id = UUID.fromString(quest.substring(quest.lastIndexOf('/') + 1));
        FlowDocument example = example();
        JsonNode legacy = json.valueToTree(example);
        for (JsonNode step : legacy.path("steps")) {
            ((ObjectNode) step).remove("direction");
        }
        ((ObjectNode) legacy.at("/links/0")).put("fromSide", "BOTTOM").put("toSide", "TOP");
        ((ObjectNode) legacy.at("/links/5")).put("fromSide", "LEFT").put("toSide", "RIGHT");
        jdbc.update("insert into quest_flow (quest_id, document) values (?, ?)", id, json.writeValueAsString(legacy));
        assertThat(read(flow)).isEqualTo(json.valueToTree(example));

        JsonNode updated = json.valueToTree(example);
        ((ObjectNode) updated.at("/steps/0")).put("direction", "VERTICAL");
        ((ObjectNode) updated.at("/steps/2")).put("direction", "VERTICAL");
        send("PUT", flow, updated, 200);
        assertThat(read(flow)).isEqualTo(updated);
        assertThat(send("POST", "/api/flow/inspect", updated, 200))
                .isEqualTo(send("POST", "/api/flow/inspect", example, 200));

        JsonNode invalid = updated.deepCopy();
        ((ObjectNode) invalid.at("/steps/0")).put("direction", "DIAGONAL");
        send("PUT", flow, invalid, 400);
        assertThat(read(flow)).isEqualTo(updated);
    }

    @Test
    void persistsRelativeCurveOffsetsWithoutAffectingInspection() throws Exception {
        String flow = newDraft("수동 곡선") + "/flow";
        FlowDocument original = example();
        JsonNode manual = json.valueToTree(original);
        ((ObjectNode) manual.at("/links/0")).set("curve", json.valueToTree(
                new FlowDocument.Curve(new FlowDocument.Offset(130.0, -420.0), new FlowDocument.Offset(-90.0, 310.0))));
        send("PUT", flow, manual, 200);
        assertThat(read(flow)).isEqualTo(manual);
        assertThat(send("POST", "/api/flow/inspect", manual, 200))
                .isEqualTo(send("POST", "/api/flow/inspect", original, 200));

        JsonNode incomplete = manual.deepCopy();
        ((ObjectNode) incomplete.at("/links/0/curve")).remove("end");
        send("PUT", flow, incomplete, 400);
        assertThat(read(flow)).isEqualTo(manual);

        send("PUT", flow, original, 200);
        assertThat(read(flow).at("/links/0/curve").isMissingNode()).isTrue();
    }

    private String newDraft(String title) throws Exception {
        String quest = "/api/quests/" + UUID.randomUUID();
        send("PUT", quest, Map.of("title", title, "body", "첫 줄\n둘째 줄", "author", "기획자",
                "writingState", "DRAFT"), 200);
        return quest;
    }

    private JsonNode read(String uri) throws Exception {
        return send("GET", uri, null, 200);
    }

    private JsonNode send(String method, String path, Object body, int status) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).as("%s %s: %s", method, path, response.body()).isEqualTo(status);
        return response.body().isEmpty() ? null : json.readTree(response.body());
    }

    private static FlowDocument example() {
        List<FlowDocument.Step> steps = List.of(step(FlowDocument.Kind.START, 12, 30),
                step(FlowDocument.Kind.PROGRESS, 250, 30), step(FlowDocument.Kind.BRANCH, 480, 30),
                step(FlowDocument.Kind.END, 710, -130), step(FlowDocument.Kind.END, 710, 190));
        UUID start = steps.get(0).id();
        UUID progress = steps.get(1).id();
        UUID branch = steps.get(2).id();
        return new FlowDocument(steps, List.of(
                link(start, progress, "시작"), link(progress, branch, "조사 완료"),
                link(branch, steps.get(3).id(), "승리"), link(branch, steps.get(4).id(), "후퇴"),
                link(branch, progress, "재훈련"), link(branch, progress, "재도전")),
                new FlowDocument.Viewport(-10.0, 33.0, 1.45));
    }

    private static FlowDocument.Step step(FlowDocument.Kind kind, double x, double y) {
        return new FlowDocument.Step(UUID.randomUUID(), kind, "제목", "여러 줄의\n설명", x, y);
    }

    private static FlowDocument.Link link(UUID from, UUID to, String condition) {
        return new FlowDocument.Link(UUID.randomUUID(), from, to, condition);
    }
}
