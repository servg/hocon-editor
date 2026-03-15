/**
 * Flow Map Renderer — builds flow model, renders levels + SVG lines
 */
const FlowRenderer = (function() {
    'use strict';

    function buildFlowMapModel(steps, selectedStepId) {
        const backEdges = findBackEdges(steps);
        const transitions = getTransitions(steps);
        const incomingCounts = getIncomingCountsExcluding(steps, backEdges);
        const orderMap = {};
        const levelsById = assignLevels(steps, backEdges);

        // П.4: apply explicit uiLevel overrides BEFORE cross-edge detection and bucket layout
        steps.forEach(function(step) {
            if (step.uiLevel != null) levelsById[step.id] = step.uiLevel;
        });

        const missingTargets = {};

        steps.forEach(function(step, i) { orderMap[step.id] = i; });

        transitions.forEach(function(t) {
            if (getStepById(steps, t.to)) return;
            if (backEdges.has(t.from + '::' + t.to)) return;
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
                id: step.id, realStepId: step.id, level: li,
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
                    var isBackRef = backEdges.has(step.id + '::' + out.to);
                    return {
                        to: out.to, condition: out.condition || "",
                        missing: !isBackRef && !getStepById(steps, out.to),
                        isBackRef: isBackRef,
                        kindLabel: isBackRef ? "back" : !getStepById(steps, out.to) ? "missing" : out.condition ? "when" : "else",
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
                outputs: [], sortKey: steps.length + i + 1, level: bi
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

        // Classify cross-edges: same-level → SVG horizontal line; backward → back-ref only
        const sameLevelEdges = new Set();
        transitions.forEach(function(t) {
            if (backEdges.has(t.from + '::' + t.to)) return;
            if (!getStepById(steps, t.to)) return;
            var fromLvl = levelsById[t.from] == null ? 0 : levelsById[t.from];
            var toLvl   = levelsById[t.to]   == null ? 0 : levelsById[t.to];
            if (toLvl === fromLvl) {
                sameLevelEdges.add(t.from + '::' + t.to); // SVG horizontal line
            } else if (toLvl < fromLvl) {
                backEdges.add(t.from + '::' + t.to);      // back-ref row only
            }
        });

        // Build SVG lines: forward edges + same-level edges (horizontal)
        const lines = transitions
            .filter(function(t) { return !backEdges.has(t.from + '::' + t.to); })
            .map(function(t) {
                return {
                    from: t.from, to: t.to,
                    label: t.condition || "default",
                    conditional: Boolean(t.condition),
                    missing: !getStepById(steps, t.to),
                    outputOrder: t.order,
                    sameLevel: sameLevelEdges.has(t.from + '::' + t.to)
                };
            });

        return { levels: levels, lines: lines };
    }

    // DFS to detect back-edges (edges that go to an ancestor in the DFS tree = cycle)
    function findBackEdges(steps) {
        const stepsById = {};
        steps.forEach(function(s) { stepsById[s.id] = s; });
        const visited = {}, inStack = {};
        const backEdges = new Set();

        function dfs(id) {
            if (inStack[id]) return;
            if (visited[id]) return;
            visited[id] = true;
            inStack[id] = true;
            var step = stepsById[id];
            if (step) {
                (step.outputs || []).forEach(function(out) {
                    if (!out.to || !stepsById[out.to]) return;
                    if (inStack[out.to]) {
                        backEdges.add(id + '::' + out.to);
                    } else {
                        dfs(out.to);
                    }
                });
            }
            inStack[id] = false;
        }

        steps.forEach(function(s) { dfs(s.id); });
        return backEdges;
    }

    function assignLevels(steps, backEdges) {
        const incomingCounts = getIncomingCountsExcluding(steps, backEdges);
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
                if (backEdges && backEdges.has(cur + '::' + out.to)) return; // skip back-edges
                const candidate = base + 1;
                if (levelsById[out.to] == null) {
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
                    if (o.isBackRef) {
                        return '<div class="node-output-row node-backref-row">' +
                            '<div class="node-output-copy">↩ <strong>' + esc(o.to) + '</strong>' +
                            '<span>' + esc(o.condition || "back reference") + '</span></div>' +
                            '<button type="button" class="btn btn-sm btn-outline-secondary backref-jump-btn" ' +
                            'data-target="' + escA(o.to) + '">Jump</button></div>';
                    }
                    return '<div class="node-output-row" data-output-anchor="' + escA(node.id + "::" + o.order) + '">' +
                        '<div class="node-output-copy"><strong>' + esc(o.to) + '</strong><span>' + esc(o.condition || "Fallback / default transition") + '</span></div>' +
                        '<span class="node-output-kind ' + (o.missing ? "missing" : o.condition ? "conditional" : "fallback") + '">' + esc(o.kindLabel) + '</span></div>';
                }).join("")
                : '<div class="node-output-row"><div class="node-output-copy"><strong>No outputs yet</strong><span>Используйте + чтобы быстро добавить следующий шаг.</span></div><span class="node-output-kind fallback">free</span></div>'
            ) +
            (node.missing ? "" : '<div class="d-flex justify-content-end"><button type="button" class="btn btn-primary add-next-step-btn" data-action="add-next" data-id="' + escA(node.id) + '" title="Add next step">+</button></div>') +
            '</div>';

        var cls = "flow-node" + (node.selected ? " selected" : "") + (node.isStart ? " start" : "") + (node.isEnd ? " end" : "") + (node.missing ? " missing" : "");

        return '<article class="' + cls + '" data-flow-node="' + escA(node.id) + '" data-step-id="' + escA(node.realStepId || "") + '" data-level="' + escA(node.level == null ? 0 : node.level) + '">' +
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

        // Define arrowhead markers (one per stroke colour)
        var defs =
            '<defs>' +
            '<marker id="arr-default" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#94a3b8"/></marker>' +
            '<marker id="arr-conditional" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#0b7285"/></marker>' +
            '<marker id="arr-missing" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#b54708"/></marker>' +
            '</defs>';

        var parts = [defs];
        renderedLines.forEach(function(line) {
            var fromNode = nodesById[line.from];
            var toNode = nodesById[line.to];
            if (!fromNode || !toNode) return;

            var fromNodeRect = fromNode.getBoundingClientRect();
            var toRect = toNode.getBoundingClientRect();

            var stroke = line.missing ? "#b54708" : line.conditional ? "#0b7285" : "#94a3b8";
            var dash = line.conditional ? "" : ' stroke-dasharray="7 6"';
            var sx, sy, ex, ey, path, lx, ly;

            if (line.sameLevel) {
                // Same-level edge: right side of from-card → left side of to-card (horizontal curve)
                sx = fromNodeRect.right - innerRect.left;
                sy = fromNodeRect.top - innerRect.top + fromNodeRect.height / 2;
                ex = toRect.left - innerRect.left;
                ey = toRect.top - innerRect.top + toRect.height / 2;
                // If to-node is to the left of from-node, use left↔right instead
                if (toRect.left < fromNodeRect.left) {
                    sx = fromNodeRect.left - innerRect.left;
                    ex = toRect.right - innerRect.left;
                }
                var hdx = Math.max(40, Math.abs(ex - sx) / 2);
                var csx = sx + (ex > sx ? hdx : -hdx);
                var cex = ex + (ex > sx ? -hdx : hdx);
                path = "M " + sx + " " + sy + " C " + csx + " " + sy + " " + cex + " " + ey + " " + ex + " " + ey;
                lx = (sx + ex) / 2;
                ly = Math.min(sy, ey) - 10;
            } else {
                // Normal forward edge: bottom of from-card → top of to-card
                var totalAnchors = fromNode.querySelectorAll('[data-output-anchor]').length || 1;
                var laneWidth = fromNodeRect.width / (totalAnchors + 1);
                sx = fromNodeRect.left - innerRect.left + laneWidth * (line.outputOrder + 1);
                sy = fromNodeRect.bottom - innerRect.top;
                ex = toRect.left - innerRect.left + (toRect.width / 2);
                ey = toRect.top - innerRect.top;
                var delta = Math.max(52, (ey - sy) / 2);
                path = "M " + sx + " " + sy + " C " + sx + " " + (sy + delta) + " " + ex + " " + (ey - delta) + " " + ex + " " + ey;
                lx = sx + ((ex - sx) / 2) + 8;
                ly = sy + Math.max(26, (ey - sy) / 2);
            }

            var markerId = line.missing ? 'arr-missing' : line.conditional ? 'arr-conditional' : 'arr-default';
            parts.push('<path d="' + path + '" fill="none" stroke="' + stroke + '" stroke-width="2.5" stroke-linecap="round"' + (dash ? ' ' + dash : '') + ' marker-end="url(#' + markerId + ')"/>');
            parts.push('<text x="' + lx + '" y="' + ly + '" class="line-label">' + esc(shorten(line.label, 34)) + '</text>');
            parts.push('<circle cx="' + sx + '" cy="' + sy + '" r="3" fill="' + stroke + '"/>');
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
        return getIncomingCountsExcluding(steps, null);
    }

    function getIncomingCountsExcluding(steps, backEdges) {
        var counts = {};
        getTransitions(steps).forEach(function(t) {
            if (!t.to) return;
            if (backEdges && backEdges.has(t.from + '::' + t.to)) return;
            counts[t.to] = (counts[t.to] || 0) + 1;
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
