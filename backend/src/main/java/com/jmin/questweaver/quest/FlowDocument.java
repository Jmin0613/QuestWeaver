package com.jmin.questweaver.quest;

import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

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
}
