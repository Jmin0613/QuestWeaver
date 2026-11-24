package com.jmin.questweaver.quest;

import jakarta.validation.constraints.Size;

record QuestPlanning(String code, String chapter, String prerequisites, boolean optional,
                     String rewards, String background) {
    QuestPlanning {
        code = text(code);
        chapter = text(chapter);
        prerequisites = text(prerequisites);
        rewards = text(rewards);
        background = text(background);
    }

    record Patch(@Size(max = 120) String code, @Size(max = 200) String chapter,
                 String prerequisites, Boolean optional, String rewards, String background) {}

    static QuestPlanning empty() {
        return new QuestPlanning("", "", "", false, "", "");
    }

    QuestPlanning apply(Patch patch) {
        if (patch == null) return this;
        return new QuestPlanning(patch.code() == null ? code : patch.code(),
                patch.chapter() == null ? chapter : patch.chapter(),
                patch.prerequisites() == null ? prerequisites : patch.prerequisites(),
                patch.optional() == null ? optional : patch.optional(),
                patch.rewards() == null ? rewards : patch.rewards(),
                patch.background() == null ? background : patch.background());
    }

    private static String text(String value) {
        return value == null ? "" : value;
    }
}
