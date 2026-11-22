package com.jmin.questweaver.quest;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

record FlowDocument(
        @NotNull List<@NotNull @Valid Step> steps,
        @NotNull List<@NotNull @Valid Link> links,
        @NotNull @Valid Viewport viewport) {

    enum Kind { START, PROGRESS, BRANCH, END }
    enum Direction { HORIZONTAL, VERTICAL }
    enum LinkKind { ORTHOGONAL, CURVE }

    record Step(@NotNull UUID id, @NotNull Kind kind, @NotNull @Size(max = 200) String title,
                @NotNull String description, @NotNull Double x, @NotNull Double y, Direction direction,
                @JsonInclude(JsonInclude.Include.NON_NULL) Double width,
                @JsonInclude(JsonInclude.Include.NON_NULL) Double height) {
        Step {
            direction = direction == null ? Direction.HORIZONTAL : direction;
        }

        Step(UUID id, Kind kind, String title, String description, Double x, Double y) {
            this(id, kind, title, description, x, y, Direction.HORIZONTAL, null, null);
        }
    }

    @JsonIgnoreProperties({"fromSide", "toSide"})
    record Link(@NotNull UUID id, @NotNull UUID from, @NotNull UUID to, @NotNull String condition,
                @Valid @JsonInclude(JsonInclude.Include.NON_NULL) Curve curve,
                @JsonInclude(JsonInclude.Include.NON_NULL) LinkKind kind,
                @Valid @JsonInclude(JsonInclude.Include.NON_NULL) Route route) {
        Link(UUID id, UUID from, UUID to, String condition) {
            this(id, from, to, condition, null, null, null);
        }
    }

    record Route(@NotNull Double start, @NotNull Double end, @NotNull Double offset) {}

    record Curve(@NotNull @Valid Offset start, @NotNull @Valid Offset end) {}

    record Offset(@NotNull Double x, @NotNull Double y) {
        boolean finite() {
            return Double.isFinite(x) && Double.isFinite(y);
        }
    }

    record Viewport(@NotNull Double x, @NotNull Double y, @NotNull Double zoom) {}

    static FlowDocument empty() {
        return new FlowDocument(List.of(), List.of(), new Viewport(0.0, 0.0, 1.0));
    }

    void validateShape() {
        Set<UUID> stepIds = new HashSet<>();
        for (FlowDocument.Step step : steps) {
            if (!stepIds.add(step.id())) {
                throw badRequest("플로우에 중복된 ID가 있습니다.");
            }
            if (!Double.isFinite(step.x()) || !Double.isFinite(step.y())) {
                throw badRequest("단계 좌표를 확인하세요.");
            }
            if ((step.width() != null && (!Double.isFinite(step.width()) || step.width() < 80))
                    || (step.height() != null && (!Double.isFinite(step.height()) || step.height() < 54))) {
                throw badRequest("단계 크기를 확인하세요. 최소 너비는 80, 높이는 54입니다.");
            }
        }

        Set<UUID> allIds = new HashSet<>(stepIds);
        for (FlowDocument.Link link : links) {
            if (!allIds.add(link.id())) {
                throw badRequest("플로우에 중복된 ID가 있습니다.");
            }
            if (!stepIds.contains(link.from()) || !stepIds.contains(link.to())) {
                throw badRequest("연결선은 존재하는 단계의 ID를 참조해야 합니다.");
            }
            if (link.curve() != null && (!link.curve().start().finite() || !link.curve().end().finite())) {
                throw badRequest("연결선의 곡선 제어점 좌표를 확인하세요.");
            }
            if (link.route() != null && (!Double.isFinite(link.route().start()) || link.route().start() < 24
                    || !Double.isFinite(link.route().end()) || link.route().end() < 24
                    || !Double.isFinite(link.route().offset()))) {
                throw badRequest("직각 연결선의 경로를 확인하세요.");
            }
        }

        FlowDocument.Viewport view = viewport;
        if (!Double.isFinite(view.x()) || !Double.isFinite(view.y())
                || !Double.isFinite(view.zoom()) || view.zoom() < 0.1 || view.zoom() > 4.0) {
            throw badRequest("플로우 화면의 위치와 확대 비율을 확인하세요.");
        }
    }

    private static ResponseStatusException badRequest(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }
}
