package com.jmin.questweaver;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class StatusController {
    @GetMapping("/api/status")
    Status status() {
        return new Status("UP");
    }

    record Status(String status) {
    }
}
