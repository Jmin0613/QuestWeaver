package com.jmin.questweaver;

import java.io.IOException;
import java.io.OutputStream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "questweaver.desktop-managed", havingValue = "true")
class DesktopLifecycle {
    private static final Logger LOGGER = LoggerFactory.getLogger(DesktopLifecycle.class);

    @EventListener
    void ready(ApplicationReadyEvent event) {
        ConfigurableApplicationContext context = event.getApplicationContext();
        int port = ((WebServerApplicationContext) context).getWebServer().getPort();

        // Electron owns the write end of stdin for the full lifetime of the app.
        Thread.ofVirtual().name("desktop-lifecycle").start(() -> {
            try {
                System.in.transferTo(OutputStream.nullOutputStream());
            } catch (IOException error) {
                LOGGER.warn("Desktop process pipe closed", error);
            } finally {
                context.close();
            }
        });

        System.out.println("QUESTWEAVER_READY " + port);
        System.out.flush();
    }
}
