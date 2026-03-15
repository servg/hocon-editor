package com.example.hoconeditor.service;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

@Service
public class HoconFileService {

    public String loadSample(String name) throws IOException {
        var resource = new ClassPathResource("hocon-samples/" + name);
        return resource.getContentAsString(StandardCharsets.UTF_8);
    }
}
