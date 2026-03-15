package com.example.hoconeditor.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class EditorController {

    @GetMapping("/")
    public String editor() {
        return "editor";
    }
}
