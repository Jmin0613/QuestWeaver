package com.jmin.questweaver;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:questweaver")
class QuestweaverApplicationTests {

	@Test
	void contextLoads() {
	}

}
