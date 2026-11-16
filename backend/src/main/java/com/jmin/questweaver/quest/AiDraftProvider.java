package com.jmin.questweaver.quest;

import tools.jackson.databind.JsonNode;

interface AiDraftProvider {
    boolean configured();

    String generate(String instructions, String source, JsonNode schema);
}
