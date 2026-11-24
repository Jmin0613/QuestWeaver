package com.jmin.questweaver;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class DesktopApiProtection extends OncePerRequestFilter {
    private final boolean managed;
    private final byte[] authorization;

    DesktopApiProtection(@Value("${questweaver.desktop-managed:false}") boolean managed,
            @Value("${QUESTWEAVER_DESKTOP_TOKEN:}") String token) {
        this.managed = managed;
        this.authorization = token.isBlank() ? new byte[0] : ("Bearer " + token).getBytes(StandardCharsets.UTF_8);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        if (managed) {
            String supplied = request.getHeader("Authorization");
            if (authorization.length == 0 || supplied == null || !MessageDigest.isEqual(authorization,
                    supplied.getBytes(StandardCharsets.UTF_8))) {
                response.setStatus(401);
                response.setContentType("application/json;charset=UTF-8");
                response.getWriter().write("{\"message\":\"앱 전용 요청만 허용됩니다.\"}");
                return;
            }
        } else if (request.getHeader("X-QuestWeaver-AI-Key") != null) {
            // Desktop overrides are accepted only through the authenticated desktop transport.
            response.setStatus(403);
            return;
        }
        chain.doFilter(request, response);
    }
}
