package com.jmin.questweaver.quest;

import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
class QuestController {
    record NameInput(@NotBlank @Size(max = 120) String name) {}
    record ErrorMessage(String message) {}

    private final QuestStore store;

    QuestController(QuestStore store) {
        this.store = store;
    }

    @GetMapping("/games")
    List<QuestStore.Option> games() {
        return store.games();
    }

    @PostMapping("/games")
    @ResponseStatus(HttpStatus.CREATED)
    QuestStore.Option addGame(@Valid @RequestBody NameInput input) {
        return store.addGame(input.name());
    }

    @GetMapping("/games/{gameId}/regions")
    List<QuestStore.Option> regions(@PathVariable long gameId) {
        return store.regions(gameId);
    }

    @PostMapping("/games/{gameId}/regions")
    @ResponseStatus(HttpStatus.CREATED)
    QuestStore.Option addRegion(@PathVariable long gameId, @Valid @RequestBody NameInput input) {
        return store.addRegion(gameId, input.name());
    }

    @GetMapping("/quests")
    List<QuestStore.Summary> quests(@RequestParam(required = false) Long gameId,
                                    @RequestParam(required = false) Long regionId,
                                    @RequestParam(defaultValue = "") String search) {
        return store.quests(gameId, regionId, search);
    }

    @GetMapping("/quests/{id}")
    QuestStore.Detail quest(@PathVariable UUID id) {
        return store.quest(id);
    }

    @PutMapping("/quests/{id}")
    QuestStore.Detail save(@PathVariable UUID id, @Valid @RequestBody QuestStore.Input input) {
        return store.save(id, input);
    }

    @GetMapping("/quests/{id}/flow")
    FlowDocument flow(@PathVariable UUID id) {
        return store.flow(id);
    }

    @PutMapping("/quests/{id}/flow")
    FlowDocument saveFlow(@PathVariable UUID id, @Valid @RequestBody FlowDocument document) {
        return store.saveFlow(id, document);
    }

    @DeleteMapping("/quests/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@PathVariable UUID id) {
        store.delete(id);
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<ErrorMessage> invalidRequest(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(new ErrorMessage(error.getReason()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ErrorMessage invalidFields() {
        return new ErrorMessage("입력 항목과 글자 수 제한을 확인하세요.");
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    ErrorMessage conflict() {
        return new ErrorMessage("중복된 데이터가 있거나 다른 요청이 먼저 저장되었습니다. 다시 확인하세요.");
    }
}
