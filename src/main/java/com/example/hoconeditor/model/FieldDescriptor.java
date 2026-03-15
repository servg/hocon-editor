package com.example.hoconeditor.model;

import java.util.List;

public record FieldDescriptor(
        String key,
        String label,
        String type,       // text | number | boolean | select | textarea
        boolean required,
        String placeholder,
        String hint,
        List<String> options // for select type
) {
    public FieldDescriptor(String key, String label, String type, boolean required, String placeholder, String hint) {
        this(key, label, type, required, placeholder, hint, null);
    }
}
