package com.jmin.questweaver.quest;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Lob;
import jakarta.persistence.MapsId;
import jakarta.persistence.OneToOne;

@Entity
class QuestFlow {
    @Id
    UUID questId;

    @MapsId
    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "quest_id")
    Quest quest;

    @Lob
    @Column(nullable = false)
    String document;

    protected QuestFlow() {
    }

    QuestFlow(Quest quest, String document) {
        this.quest = quest;
        this.document = document;
    }
}
