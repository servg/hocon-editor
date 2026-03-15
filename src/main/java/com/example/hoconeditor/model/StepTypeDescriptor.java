package com.example.hoconeditor.model;

import java.util.List;

public record StepTypeDescriptor(
        String type,
        String label,
        String description,
        boolean requiresConnection,
        boolean supportsRetry,
        List<FieldDescriptor> fields,
        List<String> hints
) {
    public StepTypeDescriptor withoutFields() {
        return new StepTypeDescriptor(type, label, description, requiresConnection, supportsRetry, null, null);
    }
}
