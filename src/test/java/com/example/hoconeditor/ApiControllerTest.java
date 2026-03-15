package com.example.hoconeditor;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class ApiControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void listStepTypes() throws Exception {
        mockMvc.perform(get("/api/step-types"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(4)))
                .andExpect(jsonPath("$[0].type", is("ORACLE_PLSQL")))
                .andExpect(jsonPath("$[0].fields").doesNotExist());
    }

    @Test
    void getStepTypeWithFields() throws Exception {
        mockMvc.perform(get("/api/step-types/ORACLE_PLSQL"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type", is("ORACLE_PLSQL")))
                .andExpect(jsonPath("$.requiresConnection", is(true)))
                .andExpect(jsonPath("$.fields", hasSize(3)))
                .andExpect(jsonPath("$.fields[0].key", is("sql")));
    }

    @Test
    void getStepTypeNotFound() throws Exception {
        mockMvc.perform(get("/api/step-types/UNKNOWN"))
                .andExpect(status().isNotFound());
    }

    @Test
    void validateProcess() throws Exception {
        mockMvc.perform(post("/api/hocon/validate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "variables": [],
                                  "steps": [
                                    {"id": "step1", "name": "s1", "type": "EMPTY", "connection": "", "config": {}, "maxRetries": 0, "retryDelayMs": 0,
                                     "outputs": [{"to": "missing_step", "condition": "", "order": 0}]}
                                  ]
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.errors", hasSize(0)))
                .andExpect(jsonPath("$.warnings", hasSize(1)));
    }

    @Test
    void saveProcess() throws Exception {
        mockMvc.perform(post("/api/hocon/save")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"variables": [], "steps": []}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("ok")));
    }

    @Test
    void loadSample() throws Exception {
        mockMvc.perform(get("/api/hocon/sample/sample-flow.conf"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("steps {")));
    }
}
