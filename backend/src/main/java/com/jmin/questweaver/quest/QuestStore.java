package com.jmin.questweaver.quest;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.databind.ObjectMapper;

@Repository
@Transactional(readOnly = true)
class QuestStore {
    record Option(Long id, String name) {}

    record Summary(UUID id, Long gameId, String gameName, Long regionId, String regionName,
                   String title, Quest.WritingState writingState, Instant updatedAt) {}

    record Detail(Summary summary, String author, String body, Instant createdAt, QuestPlanning planning) {}
    record Workspace(Detail quest, FlowDocument flow) {}
    record WorkspaceInput(@NotNull @Valid FlowDocument flow, @Valid QuestPlanning.Patch planning) {}

    record Input(Long gameId, Long regionId, @Size(max = 200) String title, @Size(max = 120) String author,
                 String body, @NotNull Quest.WritingState writingState, @Valid QuestPlanning.Patch planning) {}

    private final EntityManager db;
    private final ObjectMapper json;

    QuestStore(EntityManager db, ObjectMapper json) {
        this.db = db;
        this.json = json;
    }

    List<Option> games() {
        return db.createQuery("from Game g order by g.nameKey, g.id", Game.class).getResultList()
                .stream().map(g -> new Option(g.id, g.name)).toList();
    }

    @Transactional
    Option addGame(String rawName) {
        String name = requiredName(rawName);
        String key = nameKey(name);
        if (!db.createQuery("select g.id from Game g where g.nameKey = :key", Long.class)
                .setParameter("key", key).getResultList().isEmpty()) {
            throw conflict("같은 이름의 게임이 이미 있습니다.");
        }
        Game game = new Game(name, key);
        db.persist(game);
        return new Option(game.id, game.name);
    }

    List<Option> regions(long gameId) {
        requireGame(gameId);
        return db.createQuery("from Region r where r.game.id = :gameId order by r.nameKey, r.id", Region.class)
                .setParameter("gameId", gameId).getResultList()
                .stream().map(r -> new Option(r.id, r.name)).toList();
    }

    @Transactional
    Option addRegion(long gameId, String rawName) {
        Game game = requireGame(gameId);
        String name = requiredName(rawName);
        String key = nameKey(name);
        if (!db.createQuery("select r.id from Region r where r.game.id = :gameId and r.nameKey = :key", Long.class)
                .setParameter("gameId", gameId).setParameter("key", key).getResultList().isEmpty()) {
            throw conflict("이 게임에 같은 이름의 지역이 이미 있습니다.");
        }
        Region region = new Region(game, name, key);
        db.persist(region);
        return new Option(region.id, region.name);
    }

    List<Summary> quests(Long gameId, Long regionId, String search) {
        if (regionId != null) {
            requireRegion(gameId, regionId);
        }
        return db.createQuery("""
                select q.id, g.id, g.name, r.id, r.name, q.title, q.writingState, q.updatedAt
                from Quest q left join q.game g left join q.region r
                where (:gameId is null or g.id = :gameId)
                  and (:regionId is null or r.id = :regionId)
                  and (:search = '' or locate(:search, lower(coalesce(q.title, ''))) > 0)
                order by q.updatedAt desc, q.id desc
                """, Object[].class)
                .setParameter("gameId", gameId)
                .setParameter("regionId", regionId)
                .setParameter("search", nameKey(search.strip()))
                .getResultList().stream()
                .map(row -> new Summary((UUID) row[0], (Long) row[1], (String) row[2],
                        (Long) row[3], (String) row[4], (String) row[5], (Quest.WritingState) row[6], (Instant) row[7]))
                .toList();
    }

    Detail quest(UUID id) {
        return detail(requireQuest(db.find(Quest.class, id)));
    }

    @Transactional
    Detail save(UUID id, Input input) {
        String title = optionalText(input.title());
        if (input.writingState() == Quest.WritingState.REGISTERED
                && (input.gameId() == null || title == null || input.body() == null || input.body().isBlank())) {
            throw badRequest("등록하려면 게임, 퀘스트명, 퀘스트 원문을 입력하세요.");
        }

        Game game = input.gameId() == null ? null : requireGame(input.gameId());
        Region region = input.regionId() == null ? null : requireRegion(input.gameId(), input.regionId());
        Quest existing = db.find(Quest.class, id, LockModeType.PESSIMISTIC_WRITE);
        if (existing != null && existing.writingState == Quest.WritingState.REGISTERED
                && input.writingState() == Quest.WritingState.DRAFT) {
            throw conflict("등록한 퀘스트는 임시저장으로 변경할 수 없습니다.");
        }

        Instant now = Instant.now();
        Quest quest = existing == null ? new Quest(id, now) : existing;
        quest.game = game;
        quest.region = region;
        quest.title = title;
        quest.author = optionalText(input.author());
        quest.body = input.body();
        quest.writingState = input.writingState();
        if (input.planning() != null) quest.planningDocument = json.writeValueAsString(planning(quest).apply(input.planning()));
        quest.updatedAt = now;
        if (existing == null) {
            db.persist(quest);
        }
        // Return the timestamp precision that subsequent database reads will use.
        db.flush();
        db.refresh(quest);
        return detail(quest);
    }

    @Transactional
    void delete(UUID id) {
        Quest quest = requireQuest(db.find(Quest.class, id, LockModeType.PESSIMISTIC_WRITE));
        db.createQuery("delete from QuestFlow f where f.questId = :id")
                .setParameter("id", id).executeUpdate();
        db.remove(quest);
    }

    FlowDocument flow(UUID id) {
        requireQuest(db.find(Quest.class, id));
        QuestFlow flow = db.find(QuestFlow.class, id);
        return flow == null ? FlowDocument.empty() : json.readValue(flow.document, FlowDocument.class);
    }

    String source(UUID id) {
        return requireQuest(db.find(Quest.class, id)).body;
    }

    Workspace workspace(UUID id) {
        return new Workspace(quest(id), flow(id));
    }

    @Transactional
    Workspace saveWorkspace(UUID id, WorkspaceInput input) {
        input.flow().validateShape();
        Quest quest = requireQuest(db.find(Quest.class, id, LockModeType.PESSIMISTIC_WRITE));
        if (input.planning() != null) quest.planningDocument = json.writeValueAsString(planning(quest).apply(input.planning()));
        writeFlow(quest, input.flow());
        db.flush();
        db.refresh(quest);
        return new Workspace(detail(quest), input.flow());
    }

    @Transactional
    FlowDocument saveFlow(UUID id, FlowDocument document) {
        document.validateShape();
        Quest quest = requireQuest(db.find(Quest.class, id, LockModeType.PESSIMISTIC_WRITE));
        writeFlow(quest, document);
        return document;
    }

    private void writeFlow(Quest quest, FlowDocument document) {
        String snapshot = json.writeValueAsString(document);
        QuestFlow flow = db.find(QuestFlow.class, quest.id);
        if (flow == null) {
            db.persist(new QuestFlow(quest, snapshot));
        } else {
            flow.document = snapshot;
        }
        quest.updatedAt = Instant.now();
    }

    private Game requireGame(long id) {
        Game game = db.find(Game.class, id);
        if (game == null) {
            throw badRequest("선택한 게임을 찾을 수 없습니다.");
        }
        return game;
    }

    private Region requireRegion(Long gameId, long regionId) {
        Region region = db.find(Region.class, regionId);
        if (region == null || !region.game.id.equals(gameId)) {
            throw badRequest("선택한 게임에 속한 지역을 선택하세요.");
        }
        return region;
    }

    private static Quest requireQuest(Quest quest) {
        if (quest == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "퀘스트를 찾을 수 없습니다.");
        }
        return quest;
    }

    private QuestPlanning planning(Quest quest) {
        return quest.planningDocument == null ? QuestPlanning.empty()
                : json.readValue(quest.planningDocument, QuestPlanning.class);
    }

    private Detail detail(Quest q) {
        Summary summary = new Summary(q.id, q.game == null ? null : q.game.id, q.game == null ? null : q.game.name,
                q.region == null ? null : q.region.id, q.region == null ? null : q.region.name,
                q.title, q.writingState, q.updatedAt);
        return new Detail(summary, q.author, q.body, q.createdAt, planning(q));
    }

    private static String requiredName(String rawName) {
        String name = optionalText(rawName);
        if (name == null) {
            throw badRequest("이름을 입력하세요.");
        }
        return name;
    }

    private static String nameKey(String name) {
        return name.toLowerCase(Locale.ROOT);
    }

    private static String optionalText(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private static ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }
}
