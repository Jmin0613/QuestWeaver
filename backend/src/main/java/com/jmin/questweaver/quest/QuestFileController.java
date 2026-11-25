package com.jmin.questweaver.quest;

import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
class QuestFileController {
    record Input(String document) {}
    record Error(String message) {}
    private final QuestFiles files;
    QuestFileController(QuestFiles files) { this.files = files; }

    @GetMapping("/quests/{id}/file")
    QuestFiles.Document exportQuest(@PathVariable UUID id) { return files.exportQuest(id); }

    @PostMapping("/quest-files/preview")
    QuestFiles.Preview preview(@RequestBody Input input) { return files.preview(input.document()); }

    @PostMapping("/quest-files/import")
    QuestStore.Detail importQuest(@RequestBody Input input) { return files.importQuest(input.document()); }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Error> invalid(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(new Error(error.getReason()));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    Error conflict() { return new Error("가져오기를 저장하지 못했습니다. 변경 사항은 취소되었습니다. 다시 시도하세요."); }
}
