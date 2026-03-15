/**
 * Flow Map Renderer — builds flow model, renders levels + SVG lines
 */
const FlowRenderer = (function() {
    'use strict';

    function buildFlowMapModel(steps, selectedStepId) {
        const transitions = getTransitions(steps);
        const incomingCounts = getIncomingCounts(steps);
        const orderMap = {};
        const levelsById = assignLevels(steps);
        const missingTargets = {};

        steps.forEach(function(step, i) { orderMap[step.id] = i; });

        transitions.forEach(function(t) {
            if (getStepById(steps, t.to)) return;
            if (!missingTargets[t.to]) {
                missingTargets[t.to] = { id: t.to, parents: [], maxLevel: 0 };
            }
            missingTargets[t.to].parents.push(t.from);
            missingTargets[t.to].maxLevel = Math.max(
                missingTargets[t.to].maxLevel,
                (levelsById[t.from] == null ? 0 : levelsById[t.from]) + 1
            );
        });

        const levelBuckets = {};
        steps.forEach(function(step) {
            const li = levelsById[step.id] == null ? 0 : levelsById[step.id];
            if (!levelBuckets[li]) levelBuckets[li] = [];
            levelBuckets[li].push({
                id: step.id, realStepId: step.id,
                name: step.name || step.id, type: step.type,
                connection: step.connection || "",
                isStart: !incomingCounts[step.id],
                isEnd: !step.outputs || step.outputs.length === 0,
                missing: false,
                selected: step.id === selectedStepId,
                description: step.connection
                    ? "Connection: " + step.connection + ". Outputs: " + (step.outputs ? step.outputs.length : 0) + "."
                    : "Outputs: " + (step.outputs ? step.outputs.length : 0) + ".",
                outputs: (step.outputs || []).slice().sort(function(a, b) { return a.order - b.order; }).map(function(out) {
                    return {
                        to: out.to, condition: out.condition || "",
                        missing: !getStepById(steps, out.to),
                        kindLabel: !getStepById(steps, out.to) ? "missing" : out.condition ? "when" : "else",
                        order: out.order
                    };
                }),
                sortKey: orderMap[step.id]
            });
        });

        Object.keys(missingTargets).forEach(function(targetId, i) {
            const bi = missingTargets[targetId].maxLevel;
            if (!levelBuckets[bi]) levelBuckets[bi] = [];
            levelBuckets[bi].push({
                id: targetId, realStepId: "", name: targetId, type: "MISSING",
                connection: "", isStart: false, isEnd: true, missing: true, selected: false,
                description: "На этот id ссылается переход, но шаг не найден.",
                outputs: [], sortKey: steps.length + i + 1
            });
        });

        const maxLevel = Math.max.apply(null, Object.keys(levelBuckets).map(Number).concat([0]));
        const levels = [];
        for (let i = 0; i <= maxLevel; i++) {
            const nodes = (levelBuckets[i] || []).slice().sort(function(a, b) { return a.sortKey - b.sortKey; });
            levels.push({
                title: i === 0 ? "Level 0 · Start / Input" : "Level " + i,
                subtitle: nodes.length + " node" + (nodes.length === 1 ? "" : "s"),
                nodes: nodes
            });
        }

        const lines = transitions.map(function(t) {
            return {
                from: t.from, to: t.to,
                label: t.condition || "default",
                conditional: Boolean(t.condition),
                missing: !getStepById(steps, t.to),
                outputOrder: t.order
            };
        });

        return { levels: levels, lines: lines };
    }

    function assignLevels(steps) {
        const incomingCounts = getIncomingCounts(steps);
        const stepsById = {};
        steps.forEach(function(s) { stepsById[s.id] = s; });
        const levelsById = {};
        const queue = [];

        steps.forEach(function(s) {
            if (!incomingCounts[s.id]) { levelsById[s.id] = 0; queue.push(s.id); }
        });
        if (!queue.length && steps.length) { levelsById[steps[0].id] = 0; queue.push(steps[0].id); }

        while (queue.length) {
            const cur = queue.shift();
            const step = stepsById[cur];
            if (!step) continue;
            const base = levelsById[cur] == null ? 0 : levelsById[cur];
            (step.outputs || []).forEach(function(out) {
                if (!stepsById[out.to]) return;
                const candidate = base + 1;
                if (levelsById[out.to] == null || levelsById[out.to] < candidate) {
                    levelsById[out.to] = candidate;
                    queue.push(out.to);
                }
            });
        }

        steps.forEach(function(s) { if (levelsById[s.id] == null) levelsById[s.id] = 0; });
        return levelsById;
    }

    function renderFlowLevel(level) {
        return '<section class="flow-column">' +
            '<header class="flow-column-header"><strong>' + esc(level.title) + '</strong><span>' + esc(level.subtitle) + '</span></header>' +
            (level.nodes.length
                ? level.nodes.map(renderFlowNode).join("")
                : '<div class="empty-hint">Уровень пуст.</div>') +
            '</section>';
    }

    function renderFlowNode(node) {
        var outputsHtml = '<div class="node-output-list">' +
            (node.outputs.length
                ? node.outputs.map(function(o) {
                    return '<div class="node-output-row" data-output-anchor="' + escA(node.id + "::" + o.order) + '">' +
                        '<div class="node-output-copy"><strong>' + esc(o.to) + '</strong><span>' + esc(o.condition || "Fallback / default transition") + '</span></div>' +
                        '<span class="node-output-kind ' + (o.missing ? "missing" : o.condition ? "conditional" : "fallback") + '">' + esc(o.kindLabel) + '</span></div>';
                }).join("")
                : '<div class="node-output-row"><div class="node-output-copy"><strong>No outputs yet</strong><span>Используйте + чтобы быстро добавить следующий шаг.</span></div><span class="node-output-kind fallback">free</span></div>'
            ) +
            (node.missing ? "" : '<div class="d-flex justify-content-end"><button type="button" class="btn btn-primary add-next-step-btn" data-action="add-next" data-id="' + escA(node.id) + '" title="Add next step">+</button></div>') +
            '</div>';

        var cls = "flow-node" + (node.selected ? " selected" : "") + (node.isStart ? " start" : "") + (node.isEnd ? " end" : "") + (node.missing ? " missing" : "");

        return '<article class="' + cls + '" data-flow-node="' + escA(node.id) + '" data-step-id="' + escA(node.realStepId || "") + '">' +
            '<div class="flow-node-title"><div><strong>' + esc(node.name) + '</strong><code>' + esc(node.id) + '</code></div>' +
            '<div class="d-flex flex-wrap gap-1 justify-content-end">' +
            (node.isStart ? '<span class="badge text-bg-success">START</span>' : "") +
            (node.isEnd && !node.missing ? '<span class="badge text-bg-warning">END</span>' : "") +
            (node.missing ? '<span class="badge text-bg-warning">Missing</span>' : '<span class="badge text-bg-light">' + esc(node.type) + '</span>') +
            '</div></div>' +
            '<div class="node-meta">' +
            (node.missing ? '<span class="badge text-bg-warning">Unknown step reference</span>' : '<span class="badge text-bg-light">' + esc(node.type) + '</span>') +
            (node.connection ? '<span class="badge text-bg-light">' + esc(node.connection) + '</span>' : '') +
            '</div>' +
            '<div class="node-copy">' + esc(node.description) + '</div>' +
            outputsHtml +
            (node.missing ? "" : '<div class="mt-3 d-flex flex-wrap gap-2">' +
                '<button type="button" class="btn btn-sm btn-primary" data-action="edit" data-id="' + escA(node.id) + '">Edit</button>' +
                '<button type="button" class="btn btn-sm btn-outline-secondary" data-action="duplicate" data-id="' + escA(node.id) + '">Duplicate</button>' +
                '<button type="button" class="btn btn-sm btn-outline-danger" data-action="delete" data-id="' + escA(node.id) + '">Delete</button></div>') +
            '</article>';
    }

    function redrawFlowLines(renderedLines, flowMapInner, flowMapShell, flowMapColumns, flowMapLinesSvg) {
        if (!renderedLines.length) return;

        var innerRect = flowMapInner.getBoundingClientRect();
        var nodes = flowMapColumns.querySelectorAll("[data-flow-node]");
        var nodesById = {};
        nodes.forEach(function(n) { nodesById[n.getAttribute("data-flow-node")] = n; });

        var w = Math.max(flowMapColumns.scrollWidth + 16, flowMapShell.clientWidth);
        var h = Math.max(flowMapColumns.scrollHeight + 16, flowMapShell.clientHeight);
        flowMapLinesSvg.setAttribute("viewBox", "0 0 " + w + " " + h);
        flowMapLinesSvg.setAttribute("width", String(w));
        flowMapLinesSvg.setAttribute("height", String(h));

        var parts = [];
        renderedLines.forEach(function(line) {
            var fromNode = nodesById[line.from];
            var toNode = nodesById[line.to];
            if (!fromNode || !toNode) return;

            var fromAnchor = flowMapColumns.querySelector('[data-output-anchor="' + line.from + '::' + line.outputOrder + '"]');
            var fromRect = (fromAnchor || fromNode).getBoundingClientRect();
            var toRect = toNode.getBoundingClientRect();
            var sx = fromRect.left - innerRect.left + (fromRect.width / 2);
            var sy = fromRect.bottom - innerRect.top;
            var ex = toRect.left - innerRect.left + (toRect.width / 2);
            var ey = toRect.top - innerRect.top;
            var delta = Math.max(52, (ey - sy) / 2);
            var path = "M " + sx + " " + sy + " C " + sx + " " + (sy + delta) + " " + ex + " " + (ey - delta) + " " + ex + " " + ey;
            var stroke = line.missing ? "#b54708" : line.conditional ? "#0b7285" : "#94a3b8";
            var dash = line.conditional ? "" : ' stroke-dasharray="7 6"';
            var lx = sx + ((ex - sx) / 2) + 8;
            var ly = sy + Math.max(26, (ey - sy) / 2);

            parts.push('<path d="' + path + '" fill="none" stroke="' + stroke + '" stroke-width="2.5" stroke-linecap="round"' + dash + '/>');
            parts.push('<text x="' + lx + '" y="' + ly + '" class="line-label">' + esc(shorten(line.label, 34)) + '</text>');
            parts.push('<circle cx="' + sx + '" cy="' + sy + '" r="3.4" fill="' + stroke + '"/>');
            parts.push('<circle cx="' + ex + '" cy="' + ey + '" r="3.4" fill="' + stroke + '"/>');
        });

        flowMapLinesSvg.innerHTML = parts.join("");
    }

    // Utilities
    function getTransitions(steps) {
        return steps.flatMap(function(s) {
            return (s.outputs || []).map(function(o) {
                return { from: s.id, to: o.to, condition: o.condition || "", order: o.order };
            });
        });
    }

    function getIncomingCounts(steps) {
        var counts = {};
        getTransitions(steps).forEach(function(t) {
            if (t.to) counts[t.to] = (counts[t.to] || 0) + 1;
        });
        return counts;
    }

    function getStepById(steps, id) {
        return steps.find(function(s) { return s.id === id; }) || null;
    }

    function shorten(v, limit) {
        var t = String(v == null ? "" : v);
        return t.length <= limit ? t : t.slice(0, limit - 1) + "…";
    }

    function esc(v) {
        return String(v == null ? "" : v)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function escA(v) { return esc(v); }

    return {
        buildFlowMapModel: buildFlowMapModel,
        renderFlowLevel: renderFlowLevel,
        redrawFlowLines: redrawFlowLines,
        getTransitions: getTransitions,
        getIncomingCounts: getIncomingCounts,
        getStepById: getStepById,
        esc: esc,
        escA: escA
    };
})();
