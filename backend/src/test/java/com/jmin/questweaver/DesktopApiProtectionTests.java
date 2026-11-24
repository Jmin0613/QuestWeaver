package com.jmin.questweaver;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class DesktopApiProtectionTests {
    @Test
    void desktopRequestsRequireTheirProcessTokenIncludingKeyOverrides() throws Exception {
        var filter = new DesktopApiProtection(true, "fake-process-token");
        for (String authorization : new String[] { "", "Bearer wrong", "Bearer fake-process-token" }) {
            var request = new MockHttpServletRequest("POST", "/api/quests/example/flow/generate");
            request.addHeader("Authorization", authorization);
            request.addHeader("X-QuestWeaver-AI-Key", "fake-api-key");
            var response = new MockHttpServletResponse();
            var chain = new MockFilterChain();
            filter.doFilter(request, response, chain);
            assertThat(chain.getRequest() != null).isEqualTo(authorization.equals("Bearer fake-process-token"));
            assertThat(response.getContentAsString()).doesNotContain("fake-api-key", "fake-process-token");
        }
    }

    @Test
    void missingDesktopTokenFailsClosedAndStandaloneRejectsKeyOverride() throws Exception {
        var response = new MockHttpServletResponse();
        new DesktopApiProtection(true, "").doFilter(new MockHttpServletRequest(), response, new MockFilterChain());
        assertThat(response.getStatus()).isEqualTo(401);
        var request = new MockHttpServletRequest();
        request.addHeader("X-QuestWeaver-AI-Key", "fake-api-key");
        response = new MockHttpServletResponse();
        new DesktopApiProtection(false, "").doFilter(request, response, new MockFilterChain());
        assertThat(response.getStatus()).isEqualTo(403);
    }
}
