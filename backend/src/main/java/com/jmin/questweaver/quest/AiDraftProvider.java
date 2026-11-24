package com.jmin.questweaver.quest;

import tools.jackson.databind.JsonNode;

interface AiDraftProvider {
    boolean configured();

    default String generate(String instructions, String source, JsonNode schema, String key) {
        return generate(instructions, source, schema);
    }

    String generate(String instructions, String source, JsonNode schema);
}
