package com.example.hoconeditor;

import com.example.hoconeditor.service.HoconFileService;
import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.*;

class HoconFileServiceTest {

    private final HoconFileService service = new HoconFileService();

    @Test
    void loadExistingSample() throws IOException {
        String content = service.loadSample("sample-flow.conf");
        assertNotNull(content);
        assertTrue(content.contains("steps {"));
        assertTrue(content.contains("variables {"));
    }

    @Test
    void loadNonExistentThrows() {
        assertThrows(IOException.class, () -> service.loadSample("nonexistent.conf"));
    }
}
