package com.jmin.questweaver.quest;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

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

    record Step(@NotNull UUID id, @NotNull Kind kind, @NotNull @Size(max = 200) String title,
                @NotNull String description, @NotNull Double x, @NotNull Double y) {}

    record Link(@NotNull UUID id, @NotNull UUID from, @NotNull UUID to, @NotNull String condition) {}

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
        }

        Set<UUID> allIds = new HashSet<>(stepIds);
        for (FlowDocument.Link link : links) {
            if (!allIds.add(link.id())) {
                throw badRequest("플로우에 중복된 ID가 있습니다.");
            }
            if (!stepIds.contains(link.from()) || !stepIds.contains(link.to())) {
                throw badRequest("연결선은 존재하는 단계의 ID를 참조해야 합니다.");
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
