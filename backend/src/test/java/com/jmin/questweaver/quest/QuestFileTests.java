package com.jmin.questweaver.quest;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.HashMap;
import java.util.HashSet;
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
        properties = "spring.datasource.url=jdbc:h2:mem:quest-file-tests")
class QuestFileTests {
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate db;
    private final HttpClient client = HttpClient.newHttpClient();

    @Test
    void exportsSavedDataWithoutMutationAndImportsNewDraftsWithFreshGraphIds() throws Exception {
        String game = "파일 게임 " + UUID.randomUUID();
        JsonNode gameOption = send("POST", "/api/games", Map.of("name", game), 201);
        JsonNode region = send("POST", "/api/games/" + gameOption.path("id").asLong() + "/regions", Map.of("name", "성문"), 201);
        String route = "/api/quests/" + UUID.randomUUID();
        send("PUT", route, Map.of("gameId", gameOption.path("id").asLong(), "regionId", region.path("id").asLong(),
                "title", "백업: 퀘스트", "author", "직접 입력", "body", "한글 원문\n<img src=x onerror=alert(1)>\n다시 도전한다.",
                "writingState", "REGISTERED", "planning", Map.of("code", "Q-1", "chapter", "챕터", "prerequisites", "선행",
                        "optional", true, "rewards", "보상\n둘째 줄", "background", "배경")), 200);
        send("PUT", route + "/flow", flow(), 200);
        JsonNode before = send("GET", route + "/workspace", null, 200);
        JsonNode exported = send("GET", route + "/file", null, 200);
        assertThat(exported.path("format").asString()).isEqualTo(QuestFiles.FORMAT);
        assertThat(exported.path("schemaVersion").asInt()).isEqualTo(1);
        assertThat(exported.path("quest").has("id")).isFalse();
        assertThat(exported.path("quest").has("gameId")).isFalse();
        assertThat(exported.path("quest").path("game").asString()).isEqualTo(game);
        assertThat(exported.path("flow")).isEqualTo(before.path("flow"));
        JsonNode preview = send("POST", "/api/quest-files/preview", Map.of("document", exported.toString()), 200);
        assertThat(preview.path("steps").asInt()).isEqualTo(3);
        assertThat(preview.path("links").asInt()).isEqualTo(4);
        assertThat(send("GET", route + "/workspace", null, 200)).isEqualTo(before);

        var priorIds = new HashSet<String>();
        for (JsonNode step : exported.path("flow").path("steps")) priorIds.add(step.path("id").asString());
        for (JsonNode link : exported.path("flow").path("links")) priorIds.add(link.path("id").asString());
        for (int attempt = 0; attempt < 2; attempt++) {
            JsonNode imported = send("POST", "/api/quest-files/import", Map.of("document", exported.toString()), 200);
            assertThat(imported.at("/summary/id")).isNotEqualTo(before.at("/quest/summary/id"));
            assertThat(imported.at("/summary/writingState").asString()).isEqualTo("DRAFT");
            assertThat(imported.at("/summary/gameId")).isEqualTo(gameOption.path("id"));
            assertThat(imported.at("/summary/regionId")).isEqualTo(region.path("id"));
            assertThat(imported.path("body")).isEqualTo(exported.at("/quest/body"));
            assertThat(imported.path("planning")).isEqualTo(exported.at("/quest/planning"));
            String copy = "/api/quests/" + imported.at("/summary/id").asString();
            JsonNode restored = send("GET", copy + "/flow", null, 200);
            var mapping = new HashMap<String, String>();
            for (int i = 0; i < restored.path("steps").size(); i++) {
                String fresh = restored.path("steps").get(i).path("id").asString();
                assertThat(priorIds.add(fresh)).isTrue();
                mapping.put(fresh, exported.path("flow").path("steps").get(i).path("id").asString());
                ((ObjectNode) restored.path("steps").get(i)).put("id", mapping.get(fresh));
            }
            for (int i = 0; i < restored.path("links").size(); i++) {
                ObjectNode link = (ObjectNode) restored.path("links").get(i);
                assertThat(priorIds.add(link.path("id").asString())).isTrue();
                link.put("id", exported.path("flow").path("links").get(i).path("id").asString());
                link.put("from", mapping.get(link.path("from").asString()));
                link.put("to", mapping.get(link.path("to").asString()));
            }
            assertThat(restored).isEqualTo(exported.path("flow"));
        }
        assertThat(send("GET", route + "/workspace", null, 200)).isEqualTo(before);
    }

    @Test
    void supportsIncompleteDraftsEmptyFlowAndNormalizedGameRegionReuse() throws Exception {
        String route = "/api/quests/" + UUID.randomUUID();
        send("PUT", route, Map.of("writingState", "DRAFT"), 200);
        JsonNode file = send("GET", route + "/file", null, 200);
        JsonNode draft = send("POST", "/api/quest-files/import", Map.of("document", file.toString()), 200);
        assertThat(draft.at("/summary/title").isNull()).isTrue();
        assertThat(send("GET", "/api/quests/" + draft.at("/summary/id").asString() + "/flow", null, 200).path("steps").size()).isZero();
        String game = "Reuse-" + UUID.randomUUID();
        var existing = send("POST", "/api/games", Map.of("name", game), 201);
        var region = send("POST", "/api/games/" + existing.path("id").asLong() + "/regions", Map.of("name", "Area"), 201);
        ((ObjectNode) file.path("quest")).put("game", "  " + game.toUpperCase() + "  ").put("region", " area ");
        var imported = send("POST", "/api/quest-files/import", Map.of("document", file.toString()), 200);
        assertThat(imported.at("/summary/gameId")).isEqualTo(existing.path("id"));
        assertThat(imported.at("/summary/regionId")).isEqualTo(region.path("id"));
        // A receiving PC without these names creates both, then reuses them on the next import.
        String absentGame = "new-file-game-" + UUID.randomUUID();
        ((ObjectNode) file.path("quest")).put("game", absentGame).put("region", "새 지역");
        long games = count("game"), regions = count("region");
        var created = send("POST", "/api/quest-files/import", Map.of("document", file.toString()), 200);
        var reused = send("POST", "/api/quest-files/import", Map.of("document", file.toString()), 200);
        assertThat(created.at("/summary/gameName").asString()).isEqualTo(absentGame);
        assertThat(created.at("/summary/regionName").asString()).isEqualTo("새 지역");
        assertThat(created.at("/summary/gameId")).isEqualTo(reused.at("/summary/gameId"));
        assertThat(created.at("/summary/regionId")).isEqualTo(reused.at("/summary/regionId"));
        assertThat(count("game")).isEqualTo(games + 1);
        assertThat(count("region")).isEqualTo(regions + 1);
    }

    @Test
    void rejectsCorruptFilesButAcceptsGraphPlanningWarningsWithoutWritingAnythingOnPreview() throws Exception {
        JsonNode file = fixture();
        long count = count("quest");
        for (String invalid : List.of("{", "{}", file.toString() + "{}", file.toString().replace("\"schemaVersion\":1", "\"schemaVersion\":2"),
                file.toString().replace("\"format\":\"questweaver.quest\"", "\"format\":\"other\""),
                file.toString().replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"schemaVersion\":1"),
                file.toString().replace("\"format\":", "\"apiKey\":\"fake-never-echo\",\"format\":"))) {
            var error = send("POST", "/api/quest-files/preview", Map.of("document", invalid), 400);
            assertThat(error.path("message").asString()).doesNotContain("fake-never-echo");
        }
        JsonNode graph = flow();
        ((ObjectNode) file).set("flow", graph);
        // No END stage and repeated retry links are editable planning warnings, not corrupt data.
        send("POST", "/api/quest-files/preview", Map.of("document", file.toString()), 200);
        ((ObjectNode) graph.path("links").get(0)).put("to", UUID.randomUUID().toString());
        assertThat(send("POST", "/api/quest-files/import", Map.of("document", file.toString()), 400).path("message").asString()).contains("참조");
        ((ObjectNode) graph.path("steps").get(1)).put("id", graph.at("/steps/0/id").asString());
        assertThat(send("POST", "/api/quest-files/preview", Map.of("document", file.toString()), 400).path("message").asString()).contains("중복");
        ((ObjectNode) file).set("flow", json.valueToTree(FlowDocument.empty()));
        ((ObjectNode) file.path("quest")).put("body", "x".repeat(QuestFiles.MAX_BYTES + 1));
        assertThat(send("POST", "/api/quest-files/preview", Map.of("document", file.toString()), 400).path("message").asString()).contains("5 MiB");
        assertThat(count("quest")).isEqualTo(count);
    }

    @Test
    void validatesScalarTypesRequiredFieldsAndElementLimits() throws Exception {
        JsonNode file = fixture();
        ((ObjectNode) file.path("quest")).put("title", 123);
        send("POST", "/api/quest-files/preview", Map.of("document", file.toString()), 400);
        file = fixture();
        ((ObjectNode) file.path("flow").path("viewport")).put("zoom", "1");
        send("POST", "/api/quest-files/preview", Map.of("document", file.toString()), 400);
        file = fixture();
        ((ObjectNode) file.path("flow")).remove("viewport");
        send("POST", "/api/quest-files/preview", Map.of("document", file.toString()), 400);
        file = fixture();
        JsonNode graph = flow();
        ((ObjectNode) graph.path("steps").get(0)).put("kind", 0);
        ((ObjectNode) file).set("flow", graph);
        send("POST", "/api/quest-files/preview", Map.of("document", file.toString()), 400);
        var tooMany = json.createArrayNode();
        for (int i = 0; i < 2001; i++) {
            var step = (ObjectNode) json.readTree(flow().path("steps").get(1).toString());
            step.put("id", UUID.randomUUID().toString());
            tooMany.add(step);
        }
        ((ObjectNode) graph).set("steps", tooMany);
        assertThat(send("POST", "/api/quest-files/preview", Map.of("document", file.toString()), 400).path("message").asString()).contains("2,000");
    }

    @Test
    void failedFlowInsertRollsBackQuestGameAndRegionTogether() throws Exception {
        JsonNode file = fixture();
        ((ObjectNode) file.path("quest")).put("game", "rollback-" + UUID.randomUUID()).put("region", "new region");
        var graph = flow();
        ((ObjectNode) graph.path("steps").get(0)).put("title", "ROLLBACK_FILE_TEST");
        ((ObjectNode) file).set("flow", graph);
        long quests = count("quest"), games = count("game"), regions = count("region");
        db.execute("alter table quest_flow add constraint reject_file_test check (document not like '%ROLLBACK_FILE_TEST%')");
        try {
            send("POST", "/api/quest-files/import", Map.of("document", file.toString()), 409);
            assertThat(count("quest")).isEqualTo(quests);
            assertThat(count("game")).isEqualTo(games);
            assertThat(count("region")).isEqualTo(regions);
        } finally { db.execute("alter table quest_flow drop constraint reject_file_test"); }
    }

    private JsonNode fixture() {
        return json.valueToTree(new QuestFiles.Document(QuestFiles.FORMAT, 1,
                new QuestFiles.PortableQuest(null, null, null, null, null, QuestPlanning.empty(), Quest.WritingState.DRAFT,
                        java.time.Instant.now(), java.time.Instant.now()), FlowDocument.empty()));
    }

    private JsonNode flow() {
        var a = UUID.randomUUID(); var b = UUID.randomUUID(); var c = UUID.randomUUID();
        return json.readTree("""
            {"steps":[
              {"id":"%s","kind":"START","title":"시작","description":"설명\\n둘째 줄","x":-60,"y":40,"direction":"VERTICAL","width":240,"height":120,
               "planning":{"actionType":"DIALOGUE","target":"NPC","location":"성문","startCondition":"선행","completionCondition":"완료","stateChanges":"flag=true","rewards":"보상","notes":"메모"}},
              {"id":"%s","kind":"PROGRESS","title":"진행","description":"","x":300,"y":-20},
              {"id":"%s","kind":"BRANCH","title":"분기","description":"","x":650,"y":20}],
             "links":[
              {"id":"%s","from":"%s","to":"%s","condition":"진입","kind":"CURVE","curve":{"start":{"x":50,"y":90},"end":{"x":-50,"y":80}}},
              {"id":"%s","from":"%s","to":"%s","condition":"판정","kind":"ORTHOGONAL","route":{"start":50,"end":70,"offset":240}},
              {"id":"%s","from":"%s","to":"%s","condition":"재도전"},
              {"id":"%s","from":"%s","to":"%s","condition":"다른 재도전"}],
             "viewport":{"x":30,"y":80,"zoom":0.8}}
            """.formatted(a, b, c, UUID.randomUUID(), a, b, UUID.randomUUID(), b, c,
                UUID.randomUUID(), c, b, UUID.randomUUID(), c, b));
    }

    private long count(String table) { return db.queryForObject("select count(*) from " + table, Long.class); }
    private JsonNode send(String method, String route, Object body, int expected) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + route)).header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
        var response = client.send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).as("%s %s", method, route).isEqualTo(expected);
        return response.statusCode() == 204 ? null : json.readTree(response.body());
    }
}
