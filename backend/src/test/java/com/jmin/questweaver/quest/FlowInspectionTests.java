package com.jmin.questweaver.quest;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import static com.jmin.questweaver.quest.FlowDocument.Kind.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

class FlowInspectionTests {
    private final FlowDocument.Step start = step(START);
    private final FlowDocument.Step task = step(PROGRESS);
    private final FlowDocument.Step branch = step(BRANCH);
    private final FlowDocument.Step end = step(END);

    @Test
    void acceptsACompleteLinearFlow() {
        assertThat(inspect(List.of(start, task, end), link(start, task, ""), link(task, end, ""))).isEmpty();
    }

    @Test
    void reportsAnUnreachableStageEvenWhenItCanReachAnEnd() {
        assertThat(inspect(List.of(start, task, end), link(start, end, ""), link(task, end, "")))
                .extracting(FlowInspection.Warning::code, FlowInspection.Warning::stepId)
                .containsExactly(tuple("UNREACHABLE", task.id()));
    }

    @Test
    void reportsAWhitespaceConditionAndTooFewBranchLinks() {
        assertThat(inspect(List.of(start, branch, end), link(start, branch, ""), link(branch, end, " \t")))
                .extracting(FlowInspection.Warning::code, FlowInspection.Warning::stepId)
                .containsExactly(tuple("TOO_FEW_BRANCHES", branch.id()), tuple("MISSING_BRANCH_CONDITION", branch.id()));
    }

    @Test
    void acceptsARetryLoopWithAnExit() {
        assertThat(inspect(List.of(start, task, branch, end), link(start, task, ""), link(task, branch, ""),
                link(branch, task, "다시 시도"), link(branch, end, "완료"))).isEmpty();
    }

    @Test
    void findsATrappedCycleEvenWhenStartCanReachAnEndOnAnotherPath() {
        assertThat(inspect(List.of(start, task, branch, end), link(start, task, ""), link(start, end, ""),
                link(task, branch, ""), link(branch, task, "반복"), link(branch, branch, "대기")))
                .extracting(FlowInspection.Warning::code, FlowInspection.Warning::stepId)
                .containsExactly(tuple("NO_END_PATH", task.id()), tuple("NO_END_PATH", branch.id()));
    }

    @Test
    void reportsMissingEndpointsAndDeadEnds() {
        assertThat(inspect(List.of(task)))
                .extracting(FlowInspection.Warning::code)
                .containsExactly("NO_START", "NO_END", "NO_NEXT", "NO_END_PATH");
    }

    @Test
    void reportsEachExtraStartAndUsesAllStartsForReachability() {
        var second = step(START);
        assertThat(inspect(List.of(start, second, task, end), link(start, end, ""),
                link(second, task, ""), link(task, end, "")))
                .extracting(FlowInspection.Warning::code, FlowInspection.Warning::stepId)
                .containsExactly(tuple("MULTIPLE_STARTS", start.id()), tuple("MULTIPLE_STARTS", second.id()));
    }

    private static List<FlowInspection.Warning> inspect(List<FlowDocument.Step> steps, FlowDocument.Link... links) {
        return FlowInspection.inspect(new FlowDocument(steps, List.of(links), FlowDocument.empty().viewport()));
    }

    private static FlowDocument.Step step(FlowDocument.Kind kind) {
        return new FlowDocument.Step(UUID.randomUUID(), kind, kind.name(), "", 0.0, 0.0);
    }

    private static FlowDocument.Link link(FlowDocument.Step from, FlowDocument.Step to, String condition) {
        return new FlowDocument.Link(UUID.randomUUID(), from.id(), to.id(), condition);
    }
}
