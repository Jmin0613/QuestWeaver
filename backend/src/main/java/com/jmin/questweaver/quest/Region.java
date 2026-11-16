package com.jmin.questweaver.quest;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"game_id", "name_key"}))
class Region {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "game_id")
    Game game;

    @Column(nullable = false, length = 120)
    String name;

    @Column(name = "name_key", nullable = false, length = 400)
    String nameKey;

    protected Region() {
    }

    Region(Game game, String name, String nameKey) {
        this.game = game;
        this.name = name;
        this.nameKey = nameKey;
    }
}
