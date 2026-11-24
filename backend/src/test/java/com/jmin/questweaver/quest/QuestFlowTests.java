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

    @Test
    void persistsSizesAndRejectsInvalidDimensionsWithoutChangingTheFlow() throws Exception {
        String flow = newDraft("단계 크기") + "/flow";
        FlowDocument original = example();
        JsonNode sized = json.valueToTree(original);
        ((ObjectNode) sized.at("/steps/0")).put("width", 97.5).put("height", 412.25);
        send("PUT", flow, sized, 200);
        assertThat(read(flow)).isEqualTo(sized);
        assertThat(send("POST", "/api/flow/inspect", sized, 200))
                .isEqualTo(send("POST", "/api/flow/inspect", original, 200));
        for (double width : new double[]{-1, 0, 79}) {
            JsonNode invalid = sized.deepCopy();
            ((ObjectNode) invalid.at("/steps/0")).put("width", width);
            send("PUT", flow, invalid, 400);
            assertThat(read(flow)).isEqualTo(sized);
        }
    }

    @Test
    void preservesLegacyCurvesAndPersistsOrthogonalKindAndRelativeRoute() throws Exception {
        String flow = newDraft("직각 연결선") + "/flow";
        FlowDocument original = example();
        JsonNode document = json.valueToTree(original);
        ObjectNode link = (ObjectNode) document.at("/links/0");
        link.set("curve", json.valueToTree(new FlowDocument.Curve(
                new FlowDocument.Offset(110.0, -250.0), new FlowDocument.Offset(-90.0, 120.0))));
        send("PUT", flow, document, 200);
        assertThat(read(flow)).isEqualTo(document);
        link.put("kind", "ORTHOGONAL");
        link.set("route", json.valueToTree(new FlowDocument.Route(45.0, 60.0, 420.0)));
        send("PUT", flow, document, 200);
        assertThat(read(flow)).isEqualTo(document);
        assertThat(send("POST", "/api/flow/inspect", document, 200))
                .isEqualTo(send("POST", "/api/flow/inspect", original, 200));
        JsonNode invalid = document.deepCopy();
        ((ObjectNode) invalid.at("/links/0/route")).put("start", 23);
        send("PUT", flow, invalid, 400);
        assertThat(read(flow)).isEqualTo(document);
        ((ObjectNode) invalid.at("/links/0")).put("kind", "UNKNOWN");
        send("PUT", flow, invalid, 400);
        link.put("kind", "CURVE");
        send("PUT", flow, document, 200);
        assertThat(read(flow)).isEqualTo(document);
    }

    @Test
    void savesQuestAndStepPlanningInWorkspaceWithoutOverwritingNewerBasicInformation() throws Exception {
        String quest = newDraft("기존 퀘스트");
        JsonNode legacy = read(quest);
        assertThat(legacy.at("/planning/code").asString()).isEmpty();
        assertThat(legacy.at("/planning/optional").asBoolean()).isFalse();
        JsonNode document = json.valueToTree(example());
        ObjectNode planning = ((ObjectNode) document.at("/steps/0")).putObject("planning");
        planning.put("actionType", "COMBAT").put("target", "흑아").put("location", "성문")
                .put("startCondition", "단계 시작").put("completionCondition", "흑아의 체력이 0이 되면 완료")
                .put("stateChanges", "흑아전 완료 = true").put("rewards", "단계 보상")
                .put("notes", "재도전 메모");
        String workspace = quest + "/workspace";
        JsonNode first = send("PUT", workspace, Map.of("flow", document, "planning", Map.of(
                "code", "Q-001", "chapter", "챕터 1", "prerequisites", "이전 퀘스트 완료",
                "optional", true, "rewards", "퀘스트 보상", "background", "기획 의도")), 200);
        assertThat(first.path("flow")).isEqualTo(document);
        assertThat(first.at("/quest/planning/rewards").asString()).isEqualTo("퀘스트 보상");
        assertThat(first.at("/flow/steps/0/planning/rewards").asString()).isEqualTo("단계 보상");
        send("PUT", quest, Map.of("title", "다른 창에서 바꾼 제목", "body", "최신 원문",
                "writingState", "DRAFT", "planning", Map.of("rewards", "최신 보상")), 200);
        JsonNode saved = send("PUT", workspace, Map.of("flow", document, "planning", Map.of("chapter", "챕터 2")), 200);
        assertThat(saved.at("/quest/summary/title").asString()).isEqualTo("다른 창에서 바꾼 제목");
        assertThat(saved.at("/quest/body").asString()).isEqualTo("최신 원문");
        assertThat(saved.at("/quest/planning/code").asString()).isEqualTo("Q-001");
        assertThat(saved.at("/quest/planning/rewards").asString()).isEqualTo("최신 보상");
        assertThat(saved.at("/quest/planning/chapter").asString()).isEqualTo("챕터 2");
        assertThat(saved.at("/quest/planning/optional").asBoolean()).isTrue();
        assertThat(read(workspace)).isEqualTo(saved);
        JsonNode withoutPlanning = document.deepCopy();
        for (JsonNode step : withoutPlanning.path("steps")) ((ObjectNode) step).remove("planning");
        assertThat(send("POST", "/api/flow/inspect", document, 200))
                .isEqualTo(send("POST", "/api/flow/inspect", withoutPlanning, 200));
        JsonNode invalid = document.deepCopy();
        ((ObjectNode) invalid.at("/steps/0/planning")).put("actionType", "EXECUTE_CODE");
        send("PUT", workspace, Map.of("flow", invalid, "planning", Map.of("code", "실패")), 400);
        assertThat(read(workspace)).isEqualTo(saved);
        JsonNode cleared = send("PUT", workspace,
                Map.of("flow", document, "planning", Map.of("optional", false, "code", "")), 200);
        assertThat(cleared.at("/quest/planning/optional").asBoolean()).isFalse();
        assertThat(cleared.at("/quest/planning/code").asString()).isEmpty();
        assertThat(cleared.at("/quest/planning/chapter").asString()).isEqualTo("챕터 2");
    }

    @Test
    void rollsBackFlowAndQuestPlanningTogetherWhenDatabaseRejectsTheSave() throws Exception {
        String quest = newDraft("원자적 저장");
        String workspace = quest + "/workspace";
        JsonNode before = read(workspace);
        String id = quest.substring(quest.lastIndexOf('/') + 1);
        jdbc.execute("alter table quest add constraint planning_atomic_test check (id <> UUID '" + id
                + "' or planning_document not like '%ROLLBACK%')");
        try {
            send("PUT", workspace, Map.of("flow", example(), "planning", Map.of("code", "ROLLBACK")), 409);
            assertThat(read(workspace)).isEqualTo(before);
        } finally {
            jdbc.execute("alter table quest drop constraint planning_atomic_test");
        }
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
