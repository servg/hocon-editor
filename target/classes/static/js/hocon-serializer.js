/**
 * HOCON Serializer — variables {} + steps {}
 */
const HoconSerializer = (function() {
    'use strict';

    function serializeHocon(draft) {
        const lines = [];

        // Variables block
        if (draft.variables && draft.variables.length) {
            lines.push("variables {");
            draft.variables.forEach(function(v) {
                lines.push("");
                lines.push("  " + v.name + " {");
                lines.push("    type: " + q(v.type || "string"));
                if (v.value !== undefined && v.value !== "") {
                    lines.push("    value: " + formatConfigValue(v.value));
                }
                if (v.description) {
                    lines.push("    description: " + q(v.description));
                }
                if (v.required) {
                    lines.push("    required: true");
                }
                if (v.constraint && Object.keys(v.constraint).length) {
                    lines.push("    constraint {");
                    Object.entries(v.constraint).forEach(function(e) {
                        lines.push("      " + e[0] + ": " + q(e[1]));
                    });
                    lines.push("    }");
                }
                lines.push("  }");
            });
            lines.push("}");
            lines.push("");
        }

        // ui-layout block (explicit level overrides)
        var layoutSteps = (draft.steps || []).filter(function(s) { return s.uiLevel != null; });
        if (layoutSteps.length) {
            lines.push("ui-layout {");
            layoutSteps.forEach(function(s) {
                lines.push("  " + s.id + ": " + s.uiLevel);
            });
            lines.push("}");
            lines.push("");
        }

        // Steps block
        lines.push("steps {");
        draft.steps.forEach(function(step) {
            lines.push("");
            lines.push("  " + step.id + " {");
            lines.push("    name = " + q(step.name || step.id));
            lines.push("    type = " + bareOrQuoted(step.type));

            if (step.connection) {
                lines.push("    connection = " + q(step.connection));
            }

            const configEntries = Object.entries(step.config || {});
            if (configEntries.length) {
                lines.push("    config {");
                configEntries.forEach(function(e) {
                    lines.push("      " + e[0] + " = " + formatConfigValue(e[1]));
                });
                lines.push("    }");
            }

            if (Number(step.maxRetries) > 0) lines.push("    max-retries = " + Number(step.maxRetries));
            if (Number(step.retryDelayMs) > 0) lines.push("    retry-delay-ms = " + Number(step.retryDelayMs));

            if (step.outputs && step.outputs.length) {
                lines.push("    outputs = [");
                step.outputs
                    .slice().sort(function(a, b) { return a.order - b.order; })
                    .forEach(function(out) {
                        const parts = ["to = " + stepRef(out.to)];
                        if (out.condition) parts.push("condition = " + q(out.condition));
                        lines.push("      { " + parts.join(", ") + " }");
                    });
                lines.push("    ]");
            }

            lines.push("  }");
        });
        lines.push("}");
        return lines.join("\n");
    }

    function formatConfigValue(value) {
        var s = String(value == null ? "" : value);
        if (/^(true|false|null|-?\d+(\.\d+)?)$/i.test(s)) return s;
        if (/^[A-Z][A-Z0-9_-]*$/.test(s)) return s;
        return q(s);
    }

    function bareOrQuoted(value) {
        var s = String(value == null ? "" : value);
        if (/^[A-Z][A-Z0-9_-]*$/.test(s)) return s;
        return q(s);
    }

    function stepRef(value) {
        var s = String(value == null ? "" : value).trim();
        if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(s)) return s;
        return q(s);
    }

    function q(value) {
        return JSON.stringify(String(value == null ? "" : value));
    }

    return { serializeHocon: serializeHocon };
})();
