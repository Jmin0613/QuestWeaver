package com.jmin.questweaver.quest;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

final class FlowInspection {
    record Warning(String code, UUID stepId, String reason) {}

    private FlowInspection() {}

    static List<Warning> inspect(FlowDocument flow) {
        flow.validateShape();
        List<UUID> starts = new ArrayList<>();
        List<UUID> ends = new ArrayList<>();
        for (var step : flow.steps()) {
            if (step.kind() == FlowDocument.Kind.START) starts.add(step.id());
            if (step.kind() == FlowDocument.Kind.END) ends.add(step.id());
        }

        Map<UUID, List<FlowDocument.Link>> outgoing = new HashMap<>();
        Map<UUID, List<FlowDocument.Link>> incoming = new HashMap<>();
        for (var link : flow.links()) {
            outgoing.computeIfAbsent(link.from(), ignored -> new ArrayList<>()).add(link);
            incoming.computeIfAbsent(link.to(), ignored -> new ArrayList<>()).add(link);
        }
        Set<UUID> fromStart = reachable(starts, outgoing, FlowDocument.Link::to);
        Set<UUID> toEnd = reachable(ends, incoming, FlowDocument.Link::from);

        List<Warning> warnings = new ArrayList<>();
        if (starts.isEmpty()) warnings.add(new Warning("NO_START", null, "시작 단계가 없습니다."));
        if (ends.isEmpty()) warnings.add(new Warning("NO_END", null, "종료 단계가 없습니다."));
        for (var step : flow.steps()) {
            UUID id = step.id();
            var next = outgoing.getOrDefault(id, List.of());
            if (step.kind() == FlowDocument.Kind.START && starts.size() > 1) {
                warnings.add(new Warning("MULTIPLE_STARTS", id, "시작 단계가 여러 개입니다."));
            }
            if (!starts.isEmpty() && !fromStart.contains(id)) {
                warnings.add(new Warning("UNREACHABLE", id, "어느 시작 단계에서도 도달할 수 없습니다."));
            }
            if (step.kind() != FlowDocument.Kind.END && next.isEmpty()) {
                warnings.add(new Warning("NO_NEXT", id, "다음 단계로 이어지는 연결이 없습니다."));
            }
            if (step.kind() == FlowDocument.Kind.BRANCH) {
                if (next.size() < 2) {
                    warnings.add(new Warning("TOO_FEW_BRANCHES", id, "분기에서 나가는 연결이 2개 미만입니다."));
                }
                if (next.stream().anyMatch(link -> link.condition().isBlank())) {
                    warnings.add(new Warning("MISSING_BRANCH_CONDITION", id, "조건이 비어 있는 나가는 연결이 있습니다."));
                }
            }
            if (!toEnd.contains(id)) {
                warnings.add(new Warning("NO_END_PATH", id, "종료 단계로 이어지는 경로가 없습니다."));
            }
        }
        return warnings;
    }

    private static Set<UUID> reachable(List<UUID> roots, Map<UUID, List<FlowDocument.Link>> adjacency,
                                       Function<FlowDocument.Link, UUID> nextStep) {
        Set<UUID> visited = new HashSet<>(roots);
        var queue = new ArrayDeque<>(roots);
        while (!queue.isEmpty()) {
            UUID current = queue.remove();
            for (var link : adjacency.getOrDefault(current, List.of())) {
                UUID next = nextStep.apply(link);
                if (visited.add(next)) queue.add(next);
            }
        }
        return visited;
    }
}
