package com.example.hoconeditor.model;

import java.util.List;
import java.util.Map;

public record FlowProcess(
        List<Variable> variables,
        List<Step> steps
) {
    public record Variable(
            String name,
            String varClass,
            String type,
            Object value,
            String description,
            boolean required,
            Map<String, String> constraint
    ) {}

    public record Step(
            String id,
            String name,
            String type,
            String connection,
            Map<String, Object> config,
            int maxRetries,
            int retryDelayMs,
            List<Output> outputs
    ) {}

    public record Output(
            String to,
            String condition,
            int order
    ) {}
}
