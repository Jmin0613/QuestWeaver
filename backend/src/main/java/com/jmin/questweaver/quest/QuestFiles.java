package com.jmin.questweaver.quest;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.Validator;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.ObjectReader;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.cfg.EnumFeature;
import tools.jackson.databind.type.LogicalType;

@Service
class QuestFiles {
    static final int MAX_BYTES = 5 * 1024 * 1024;
    static final String FORMAT = "questweaver.quest";
    record PortableQuest(@Size(max = 200) String title, @Size(max = 120) String author,
                         String body, @Size(max = 120) String game,
                         @Size(max = 120) String region, @NotNull @Valid QuestPlanning planning,
                         @NotNull Quest.WritingState writingState, @NotNull Instant createdAt,
                         @NotNull Instant updatedAt) {}
    record Document(@NotNull String format, @NotNull Integer schemaVersion,
                    @NotNull @Valid PortableQuest quest, @NotNull @Valid FlowDocument flow) {}
    record Preview(String title, String game, String region, int steps, int links) {}

    private final QuestStore store;
    private final ObjectMapper json;
    private final ObjectReader reader;
    private final Validator validator;

    QuestFiles(QuestStore store, ObjectMapper json, Validator validator) {
        this.store = store;
        this.json = json;
        this.validator = validator;
        reader = json.rebuild().disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
                .enable(EnumFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
                .withCoercionConfig(LogicalType.Textual, config -> config
                        .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail))
                .withCoercionConfig(LogicalType.DateTime, config -> config
                        .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Float, CoercionAction.Fail))
                .build().reader()
                .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
                DeserializationFeature.FAIL_ON_TRAILING_TOKENS, DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY,
                DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Document exportQuest(UUID id) {
        var workspace = store.workspace(id);
        var detail = workspace.quest();
        var summary = detail.summary();
        var portable = new PortableQuest(summary.title(), detail.author(), detail.body(), summary.gameName(),
                summary.regionName(), detail.planning(), summary.writingState(), detail.createdAt(), summary.updatedAt());
        var document = new Document(FORMAT, 1, portable, workspace.flow());
        // Exported files must satisfy the same limits as imports.
        parse(json.writeValueAsString(document));
        return document;
    }

    Preview preview(String source) {
        var file = parse(source);
        return new Preview(file.quest().title(), file.quest().game(), file.quest().region(),
                file.flow().steps().size(), file.flow().links().size());
    }

    @Transactional
    QuestStore.Detail importQuest(String source) {
        var file = parse(source);
        var ids = new HashMap<UUID, UUID>();
        for (var step : file.flow().steps()) ids.put(step.id(), UUID.randomUUID());
        var steps = file.flow().steps().stream().map(step -> new FlowDocument.Step(ids.get(step.id()), step.kind(),
                step.title(), step.description(), step.x(), step.y(), step.direction(), step.width(), step.height(), step.planning())).toList();
        var links = file.flow().links().stream().map(link -> new FlowDocument.Link(UUID.randomUUID(),
                ids.get(link.from()), ids.get(link.to()), link.condition(), link.curve(), link.kind(), link.route())).toList();
        var flow = new FlowDocument(steps, links, file.flow().viewport());
        flow.validateShape();
        return store.importQuest(file.quest(), flow);
    }

    Document parse(String source) {
        if (source == null || source.length() > MAX_BYTES || source.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw invalid("퀘스트 파일은 UTF-8 기준 5 MiB 이하여야 합니다.");
        }
        Document file;
        try {
            var root = reader.readTree(source);
            if (root == null || !root.isObject() || !FORMAT.equals(root.path("format").asString(""))) {
                throw invalid("QuestWeaver 퀘스트 파일 형식이 아닙니다.");
            }
            var version = root.path("schemaVersion");
            if (!version.isIntegralNumber() || !version.canConvertToInt() || version.asInt() != 1) {
                throw invalid("지원하지 않는 퀘스트 파일 버전입니다. 스키마 버전 1만 지원합니다.");
            }
            file = reader.forType(Document.class).readValue(root);
        } catch (ResponseStatusException error) {
            throw error;
        } catch (RuntimeException error) {
            // File contents and parser exceptions may contain sensitive user text; never echo them.
            throw invalid("JSON 형식이나 필드 값이 올바르지 않습니다. 올바른 퀘스트 파일을 선택하세요.");
        }
        if (!validator.validate(file).isEmpty()) throw invalid("퀘스트 파일의 필수 항목과 글자 수 제한을 확인하세요.");
        var quest = file.quest();
        if (quest.planning().code().length() > 120 || quest.planning().chapter().length() > 200) {
            throw invalid("퀘스트 기획용 코드나 챕터의 글자 수 제한을 확인하세요.");
        }
        if (quest.region() != null && !quest.region().isBlank() && (quest.game() == null || quest.game().isBlank())) {
            throw invalid("지역이 있는 퀘스트 파일에는 게임 이름도 필요합니다.");
        }
        if (file.flow().steps().size() > 2000 || file.flow().links().size() > 5000) {
            throw invalid("퀘스트 파일은 단계 2,000개, 연결선 5,000개까지 지원합니다.");
        }
        file.flow().validateShape(); // Format integrity only; planning warnings do not block import.
        return file;
    }

    private static ResponseStatusException invalid(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
