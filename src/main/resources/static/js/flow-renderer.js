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

        // Force START to level 0, END to maxLevel+1 (unless manually pinned via uiLevel)
        var startStep = steps.find(function(s) { return s.type === 'START'; });
        var endStep   = steps.find(function(s) { return s.type === 'END'; });
        if (startStep && startStep.uiLevel == null) levelsById[startStep.id] = 0;
        if (endStep && endStep.uiLevel == null) {
            var currentMax = 0;
            steps.forEach(function(s) {
                if (s.type !== 'END' && levelsById[s.id] != null) currentMax = Math.max(currentMax, levelsById[s.id]);
            });
            levelsById[endStep.id] = currentMax + 1;
        }

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
                isStartType: step.type === 'START',
                isEndType: step.type === 'END',
                missing: false,
                selected: step.id === selectedStepId,
                exception: step.exception || { type: 'break', userForm: ['break', 'next'], gotoStep: '' },
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

        // Add exception-goto lines
        steps.forEach(function(step) {
            var ex = step.exception;
            if (ex && ex.type === 'goto' && ex.gotoStep && getStepById(steps, ex.gotoStep)) {
                lines.push({
                    from: step.id, to: ex.gotoStep,
                    label: 'exception→goto',
                    conditional: false, missing: false,
                    outputOrder: -1, sameLevel: false,
                    exceptionGoto: true
                });
            }
        });

        // Back-ref lines (upward transitions + self-loops)
        transitions.forEach(function(t) {
            if (!backEdges.has(t.from + '::' + t.to)) return;
            if (!getStepById(steps, t.to)) return;
            lines.push({
                from: t.from, to: t.to,
                label: t.condition || 'default',
                conditional: Boolean(t.condition),
                missing: false,
                outputOrder: t.order,
                sameLevel: false,
                backRef: true
            });
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
        var hasSingleton = level.nodes.some(function(n) { return n.isStartType || n.isEndType; });
        return '<section class="flow-column' + (hasSingleton ? ' flow-column-singleton' : '') + '">' +
            '<header class="flow-column-header"><strong>' + esc(level.title) + '</strong>' +
            (level.subtitle ? '<span class="ms-2 text-muted fw-normal">' + esc(level.subtitle) + '</span>' : '') +
            '</header>' +
            (level.nodes.length
                ? level.nodes.map(renderFlowNode).join("")
                : '<div class="empty-hint">Уровень пуст.</div>') +
            '</section>';
    }

    function renderFlowNode(node) {
        // Compact card: only title, type badge, + button for non-END/missing nodes
        var cls = "flow-node"
            + (node.selected ? " selected" : "")
            + (node.isStart ? " start" : "")
            + (node.isEnd ? " end" : "")
            + (node.missing ? " missing" : "")
            + (node.isStartType ? " node-start-type" : "")
            + (node.isEndType ? " node-end-type" : "");

        var displayName = node.isStartType ? '▶ Start' : (node.isEndType ? '⏹ End' : esc(node.name));
        var typeBadge = node.missing
            ? '<span class="badge text-bg-warning">Missing</span>'
            : node.isStartType
                ? '<span class="badge text-bg-success">START</span>'
                : node.isEndType
                    ? '<span class="badge text-bg-danger">END</span>'
                    : '<span class="badge text-bg-light">' + esc(node.type) + '</span>';

        // Hidden anchors for SVG line positioning
        var anchorHtml = node.outputs.map(function(o) {
            if (o.isBackRef) return '';
            return '<span style="display:none" data-output-anchor="' + escA(node.id + '::' + o.order) + '"></span>';
        }).join('');

        var infoChips = [];
        if (node.connection) {
            infoChips.push('<span class="node-info-chip">🔌 ' + esc(node.connection) + '</span>');
        }
        var outCount = node.outputs ? node.outputs.filter(function(o) { return !o.isBackRef; }).length : 0;
        if (outCount > 0) {
            infoChips.push('<span class="node-info-chip">' + outCount + ' out</span>');
        }
        if (!node.missing && !node.isStartType && !node.isEndType) {
            var exType = (node.exception && node.exception.type) || 'break';
            var exIconCls = exType === 'ignore' ? 'bi-skip-forward-fill' : exType === 'user' ? 'bi-person-fill' : exType === 'goto' ? 'bi-arrow-return-left' : 'bi-x-octagon-fill';
            infoChips.push('<span class="node-info-chip exc-icon exc-' + escA(exType) + '" title="Исключение: ' + escA(exType) + '"><i class="bi ' + exIconCls + '"></i></span>');
        }
        var infoRow = infoChips.length ? '<div class="node-info-row">' + infoChips.join('') + '</div>' : '<div></div>';

        var addBtn = (node.missing || node.isEndType)
            ? (infoChips.length ? '<div class="node-info-row mt-2">' + infoChips.join('') + '</div>' : '')
            : '<div class="d-flex justify-content-between align-items-center mt-2">' +
              infoRow +
              '<button type="button" class="btn btn-primary btn-sm add-next-step-btn" data-action="add-next" data-id="' + escA(node.id) + '" title="Добавить шаг">+</button>' +
              '</div>';

        var backRefRowsHtml = node.outputs
            .filter(function(o) { return o.isBackRef; })
            .map(function(o) {
                var kindHtml = '<span class="node-output-kind conditional" style="color:#9b59b6;background:rgba(155,89,182,0.10);border-color:rgba(155,89,182,0.22)">'
                    + (o.condition ? 'when' : 'back') + '</span>';
                return '<div class="node-output-row node-backref-row">'
                    + '<div class="node-output-copy"><strong>' + esc(o.to) + '</strong>'
                    + (o.condition ? '<span> ' + esc(o.condition) + '</span>' : '') + '</div>'
                    + kindHtml
                    + '</div>';
            }).join('');

        return '<article class="' + cls + '" data-flow-node="' + escA(node.id) + '" data-step-id="' + escA(node.realStepId || "") + '" data-level="' + escA(node.level == null ? 0 : node.level) + '">' +
            '<div class="flow-node-title"><div><strong>' + displayName + '</strong><code>' + esc(node.id) + '</code></div>' +
            '<div class="d-flex flex-wrap gap-1 justify-content-end">' + typeBadge + '</div></div>' +
            anchorHtml +
            backRefRowsHtml +
            addBtn +
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
            '<marker id="arr-default" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#198754"/></marker>' +
            '<marker id="arr-conditional" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#0b7285"/></marker>' +
            '<marker id="arr-missing" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#b54708"/></marker>' +
            '<marker id="arr-exc-goto" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#e07b00"/></marker>' +
            '<marker id="arr-backref" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#9b59b6"/></marker>' +
            '</defs>';

        var parts = [defs];
        renderedLines.forEach(function(line) {
            var fromNode = nodesById[line.from];
            var toNode = nodesById[line.to];
            if (!fromNode || !toNode) return;

            var fromNodeRect = fromNode.getBoundingClientRect();
            var toRect = toNode.getBoundingClientRect();

            var stroke = line.backRef ? "#9b59b6" : line.exceptionGoto ? "#e07b00" : line.missing ? "#b54708" : line.conditional ? "#0b7285" : "#198754";
            var dash = line.backRef ? 'stroke-dasharray="5,4"' : line.exceptionGoto ? 'stroke-dasharray="6,4"' : "";
            var sx, sy, ex, ey, path, lx, ly;

            if (line.backRef) {
                var toRect2 = toNode.getBoundingClientRect();
                sx = fromNodeRect.right - innerRect.left - 5;
                sy = fromNodeRect.top   - innerRect.top  + fromNodeRect.height / 2;
                ex = toRect2.right - innerRect.left - 5;
                ey = toRect2.top   - innerRect.top  + toRect2.height / 2;
                var bulge = Math.max(60, Math.abs(sy - ey) / 3);
                path = "M " + sx + " " + sy
                     + " C " + (sx + bulge) + " " + sy
                     + " " + (ex + bulge) + " " + ey
                     + " " + ex + " " + ey;
                lx = Math.max(sx, ex) + bulge / 2 + 4;
                ly = (sy + ey) / 2;
            } else if (line.exceptionGoto) {
                // Exception→goto: exit left side of from-card, loop left, enter left side of to-card
                sx = fromNodeRect.left - innerRect.left + 5;
                sy = fromNodeRect.top  - innerRect.top  + fromNodeRect.height / 2;
                ex = toRect.left - innerRect.left + 5;
                ey = toRect.top  - innerRect.top  + toRect.height / 2;
                var excBulge = Math.max(60, Math.abs(sy - ey) / 3);
                path = "M " + sx + " " + sy
                     + " C " + (sx - excBulge) + " " + sy
                     + " " + (ex - excBulge) + " " + ey
                     + " " + ex + " " + ey;
                lx = Math.min(sx, ex) - excBulge / 2 - 4;
                ly = (sy + ey) / 2;
            } else if (line.sameLevel) {
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

            var markerId = line.backRef ? 'arr-backref' : line.exceptionGoto ? 'arr-exc-goto' : line.missing ? 'arr-missing' : line.conditional ? 'arr-conditional' : 'arr-default';
            parts.push('<path d="' + path + '" fill="none" stroke="' + stroke + '" stroke-width="2.5" stroke-linecap="round"' + (dash ? ' ' + dash : '') + ' marker-end="url(#' + markerId + ')"/>');
            parts.push('<text x="' + lx + '" y="' + ly + '" class="line-label">' + esc(shorten(line.label, 34)) + '</text>');
            parts.push('<g class="line-tooltip-group" style="pointer-events:all;cursor:pointer"><circle cx="' + sx + '" cy="' + sy + '" r="6" fill="' + stroke + '" opacity="0.85"/><title>' + esc(line.label) + '</title></g>');
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
