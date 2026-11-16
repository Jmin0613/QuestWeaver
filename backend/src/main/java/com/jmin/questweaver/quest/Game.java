package com.jmin.questweaver.quest;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;

@Entity
class Game {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id;

    @Column(nullable = false, length = 120)
    String name;

    @Column(nullable = false, unique = true, length = 400)
    String nameKey;

    protected Game() {
    }

    Game(String name, String nameKey) {
        this.name = name;
        this.nameKey = nameKey;
    }
}
