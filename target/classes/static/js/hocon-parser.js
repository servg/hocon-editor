/**
 * HOCON Parser — parses variables {} + steps {} blocks
 */
const HoconParser = (function() {
    'use strict';

    function parseHocon(text) {
        const sanitized = stripComments(text);

        let variables = [];
        try {
            const varsBlock = extractNamedBlock(sanitized, "variables");
            variables = parseVariablesBlock(varsBlock.content);
        } catch (e) {
            // variables block is optional
        }

        const stepsBlock = extractNamedBlock(sanitized, "steps");
        const steps = parseStepDefinitions(stepsBlock.content);

        // Parse optional ui-layout block and apply uiLevel to steps
        try {
            const layoutBlock = extractNamedBlock(sanitized, "ui-layout");
            const layoutObj = parseObjectAssignments(layoutBlock.content);
            const stepsById = {};
            steps.forEach(function(s) { stepsById[s.id] = s; });
            Object.keys(layoutObj.values).forEach(function(key) {
                var lvl = parseInt(layoutObj.values[key].value, 10);
                if (stepsById[key] && Number.isFinite(lvl)) {
                    stepsById[key].uiLevel = Math.max(0, lvl);
                }
            });
        } catch (e) {
            // ui-layout block is optional
        }

        return { variables: variables, steps: steps };
    }

    function stripComments(text) {
        let result = "";
        let inString = false;
        let escaped = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const next = text[i + 1];

            if (inString) {
                result += char;
                if (escaped) { escaped = false; }
                else if (char === "\\") { escaped = true; }
                else if (char === "\"") { inString = false; }
                continue;
            }

            if (char === "\"") { inString = true; result += char; continue; }

            if (char === "#") {
                while (i < text.length && text[i] !== "\n") { i++; }
                if (i < text.length) result += "\n";
                continue;
            }

            if (char === "/" && next === "/") {
                i += 2;
                while (i < text.length && text[i] !== "\n") { i++; }
                if (i < text.length) result += "\n";
                continue;
            }

            result += char;
        }
        return result;
    }

    function extractNamedBlock(text, key) {
        const regex = new RegExp("(^|\\s)" + escapeRegex(key) + "\\s*\\{", "m");
        const match = regex.exec(text);
        if (!match) throw new Error("Expected '" + key + " {' block.");

        const braceIndex = text.indexOf("{", match.index);
        return { start: braceIndex, content: readBalanced(text, braceIndex, "{", "}").content };
    }

    function readBalanced(text, startIndex, openChar, closeChar) {
        if (text[startIndex] !== openChar) throw new Error("Expected '" + openChar + "' at index " + startIndex);

        let depth = 0, inString = false, escaped = false;
        for (let i = startIndex; i < text.length; i++) {
            const char = text[i];
            if (inString) {
                if (escaped) { escaped = false; }
                else if (char === "\\") { escaped = true; }
                else if (char === "\"") { inString = false; }
                continue;
            }
            if (char === "\"") { inString = true; continue; }
            if (char === openChar) { depth++; }
            else if (char === closeChar) {
                depth--;
                if (depth === 0) return { content: text.slice(startIndex + 1, i), endIndex: i };
            }
        }
        throw new Error("Unclosed block starting at index " + startIndex);
    }

    function parseVariablesBlock(content) {
        const variables = [];
        let index = 0;

        while (index < content.length) {
            index = skipWhitespace(content, index);
            if (index >= content.length) break;

            const keyToken = readIdentifier(content, index);
            if (!keyToken.value) { index++; continue; }
            index = skipWhitespace(content, keyToken.nextIndex);

            if (content[index] === "{") {
                const block = readBalanced(content, index, "{", "}");
                const varObj = parseObjectAssignments(block.content);
                variables.push({
                    name: keyToken.value,
                    type: getVal(varObj.values.type, "string"),
                    value: getVal(varObj.values.value, ""),
                    description: getVal(varObj.values.description, ""),
                    required: getVal(varObj.values.required, "false") === "true",
                    constraint: varObj.blocks.constraint
                        ? parseConstraintBlock(varObj.blocks.constraint)
                        : null
                });
                index = block.endIndex + 1;
            } else if (content[index] === "=" || content[index] === ":") {
                // simple key = value
                const val = readValue(content, index + 1);
                variables.push({
                    name: keyToken.value,
                    type: "string",
                    value: val.value,
                    description: "",
                    required: false,
                    constraint: null
                });
                index = val.nextIndex;
            } else {
                index++;
            }
        }
        return variables;
    }

    function parseConstraintBlock(content) {
        const obj = parseObjectAssignments(content);
        const result = {};
        Object.keys(obj.values).forEach(function(k) {
            result[k] = obj.values[k].value;
        });
        return result;
    }

    function parseStepDefinitions(content) {
        const steps = [];
        let index = 0;

        while (index < content.length) {
            index = skipWhitespace(content, index);
            if (index >= content.length) break;

            const keyToken = readIdentifier(content, index);
            if (!keyToken.value) throw new Error("Expected step id near: " + content.slice(index, index + 24));
            index = skipWhitespace(content, keyToken.nextIndex);

            if (content[index] !== "{") throw new Error("Expected '{' after step id '" + keyToken.value + "'.");

            const block = readBalanced(content, index, "{", "}");
            steps.push(parseSingleStep(keyToken.value, block.content));
            index = block.endIndex + 1;
        }
        return steps;
    }

    function parseSingleStep(stepId, blockContent) {
        const structure = parseObjectAssignments(blockContent);
        const configBlock = structure.blocks.config ? parseObjectAssignments(structure.blocks.config) : { values: {} };
        const outputs = structure.values.outputs ? parseOutputsArray(structure.values.outputs.raw) : [];

        return {
            id: stepId,
            name: getVal(structure.values.name, stepId),
            type: getVal(structure.values.type, "EMPTY"),
            connection: getVal(structure.values.connection, ""),
            maxRetries: toNumber(getVal(structure.values["max-retries"], "0")),
            retryDelayMs: toNumber(getVal(structure.values["retry-delay-ms"], "0")),
            config: Object.fromEntries(Object.entries(configBlock.values).map(function(e) { return [e[0], e[1].value]; })),
            outputs: outputs
        };
    }

    function parseObjectAssignments(content) {
        const values = {}, blocks = {};
        let index = 0;

        while (index < content.length) {
            index = skipWhitespace(content, index);
            if (index >= content.length) break;

            const id = readIdentifier(content, index);
            if (!id.value) { index++; continue; }
            index = skipWhitespace(content, id.nextIndex);

            const char = content[index];
            if (char === "{") {
                const block = readBalanced(content, index, "{", "}");
                blocks[id.value] = block.content;
                index = block.endIndex + 1;
            } else if (char === "=" || char === ":") {
                const val = readValue(content, index + 1);
                values[id.value] = val;
                index = val.nextIndex;
            } else {
                index++;
            }
        }
        return { values: values, blocks: blocks };
    }

    function parseOutputsArray(rawArrayValue) {
        const trimmed = rawArrayValue.trim();
        if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) throw new Error("outputs must be an array.");
        const inner = trimmed.slice(1, -1);
        const outputs = [];
        let index = 0;

        while (index < inner.length) {
            index = skipDelimiters(inner, index);
            if (index >= inner.length) break;
            if (inner[index] !== "{") throw new Error("Expected '{' inside outputs array.");

            const block = readBalanced(inner, index, "{", "}");
            const assignment = parseObjectAssignments(block.content);
            outputs.push({
                to: getVal(assignment.values.to, ""),
                condition: getVal(assignment.values.condition, ""),
                order: outputs.length
            });
            index = block.endIndex + 1;
        }
        return outputs;
    }

    function readValue(content, startIndex) {
        let index = skipWhitespace(content, startIndex);
        if (index >= content.length) return { raw: "", value: "", nextIndex: index };

        const char = content[index];
        if (char === "\"") return readQuotedValue(content, index);
        if (char === "[") {
            const b = readBalanced(content, index, "[", "]");
            return { raw: "[" + b.content + "]", value: "[" + b.content + "]", nextIndex: b.endIndex + 1 };
        }
        if (char === "{") {
            const b = readBalanced(content, index, "{", "}");
            return { raw: "{" + b.content + "}", value: "{" + b.content + "}", nextIndex: b.endIndex + 1 };
        }

        let end = index;
        while (end < content.length && content[end] !== "\n" && content[end] !== "\r" && content[end] !== "}" && content[end] !== ",") { end++; }
        const raw = content.slice(index, end).trim().replace(/,$/, "").trim();
        return { raw: raw, value: raw, nextIndex: end };
    }

    function readQuotedValue(content, startIndex) {
        let index = startIndex + 1, escaped = false;
        while (index < content.length) {
            const char = content[index];
            if (escaped) { escaped = false; }
            else if (char === "\\") { escaped = true; }
            else if (char === "\"") {
                const raw = content.slice(startIndex, index + 1);
                let value;
                try { value = JSON.parse(raw); }
                catch (e) { throw new Error("Invalid quoted string near: " + raw); }
                return { raw: raw, value: value, nextIndex: index + 1 };
            }
            index++;
        }
        throw new Error("Unterminated quoted string.");
    }

    function readIdentifier(content, startIndex) {
        const match = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(content.slice(startIndex));
        if (!match) return { value: "", nextIndex: startIndex };
        return { value: match[0], nextIndex: startIndex + match[0].length };
    }

    function skipWhitespace(content, index) {
        while (index < content.length && /\s/.test(content[index])) index++;
        return index;
    }

    function skipDelimiters(content, index) {
        while (index < content.length && (/\s/.test(content[index]) || content[index] === ",")) index++;
        return index;
    }

    function getVal(parsed, def) { return parsed ? parsed.value : def; }
    function toNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
    function escapeRegex(v) { return String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

    return { parseHocon: parseHocon };
})();
