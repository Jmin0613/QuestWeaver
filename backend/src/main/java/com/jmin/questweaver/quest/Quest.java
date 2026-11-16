package com.jmin.questweaver.quest;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.ManyToOne;

import org.hibernate.annotations.DynamicUpdate;

@Entity
@DynamicUpdate
class Quest {
    enum WritingState { DRAFT, REGISTERED }

    @Id
    UUID id;

    @ManyToOne
    Game game;

    @ManyToOne
    Region region;

    @Column(length = 200)
    String title;

    @Column(length = 120)
    String author;

    @Lob
    String body;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    WritingState writingState;

    @Column(nullable = false, updatable = false)
    Instant createdAt;

    @Column(nullable = false)
    Instant updatedAt;

    protected Quest() {
    }

    Quest(UUID id, Instant createdAt) {
        this.id = id;
        this.createdAt = createdAt;
    }
}
