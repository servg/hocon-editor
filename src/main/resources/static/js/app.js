/**
 * App — main entry point, state management, event bindings
 */
$(function() {
    'use strict';

    // ── State ──────────────────────────────────────────────────────────
    var state = {
        processDraft: { variables: [], steps: [], selectedStepId: null },
        stepEditorDraft: null,
        sourceEditorDraft: '',
        parserState: 'Idle',
        message: { text: 'Редактор готов. Загрузите файл, пример или добавьте шаг.', type: 'secondary' },
        renderedFlowLines: []
    };

    // ── DOM refs ───────────────────────────────────────────────────────
    var $flowMapEmpty = $('#flow-map-empty');
    var $flowMapShell = $('#flow-map-shell');
    var $flowMapInner = $('#flow-map-inner');
    var $flowMapLines = $('#flow-map-lines');
    var $flowMapColumns = $('#flow-map-columns');
    var $outputHocon = $('#output-hocon');
    var $globalMsg = $('#global-message');
    var $stepsCount = $('#steps-count');
    var $transitionsCount = $('#transitions-count');
    var $startStepsCount = $('#start-steps-count');
    var $parserState = $('#parser-state');
    var $sourceHocon = $('#source-hocon');
    var $sourceMsg = $('#source-modal-message');
    var $stepEditorBody = $('#step-editor-body');
    var $stepModalTitle = $('#step-modal-title');
    var $stepModalSubtitle = $('#step-modal-subtitle');
    var $stepModalMsg = $('#step-modal-message');
    var $variablesContainer = $('#variables-table-container');

    var stepModalEl = document.getElementById('step-modal');
    var sourceModalEl = document.getElementById('source-modal');
    var stepModal = new bootstrap.Modal(stepModalEl);
    var sourceModal = new bootstrap.Modal(sourceModalEl);

    // ── Toolbar events ─────────────────────────────────────────────────
    $('#load-sample-btn').on('click', function() {
        $.get('/api/hocon/sample/sample-flow.conf').done(function(text) {
            applySourceText(text, { successMessage: 'Sample loaded.', keepSourceText: true });
        }).fail(function() { setMessage('Не удалось загрузить sample.', 'danger'); });
    });

    $('#file-input').on('change', function(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
            applySourceText(String(ev.target.result || ''), { successMessage: 'File parsed.', keepSourceText: true });
        };
        reader.readAsText(file, 'utf-8');
        e.target.value = '';
    });

    $('#open-source-btn').on('click', function() {
        $sourceHocon.val(state.sourceEditorDraft);
        setSourceMsg('Редактируйте HOCON и примените через Parse & apply.', 'info');
        sourceModal.show();
    });

    $('#add-step-btn').on('click', function() {
        openStepEditor(null, { startsAfterStepId: '', openAfterSave: false });
    });

    $('#export-btn').on('click', function() {
        renderExported();
        var blob = new Blob([$outputHocon.val()], { type: 'text/plain' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'flow.conf';
        a.click();
        URL.revokeObjectURL(a.href);
        setMessage('HOCON exported.', 'success');
    });

    $('#save-btn').on('click', function() {
        state.processDraft.variables = VariablesEditor.readVariablesFromDom($variablesContainer);
        $.ajax({
            url: '/api/hocon/save',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(state.processDraft)
        }).done(function(resp) {
            setMessage(resp.message || 'Сохранено.', 'success');
        }).fail(function() {
            setMessage('Ошибка сохранения.', 'danger');
        });
    });

    $('#reset-btn').on('click', function() {
        if (!confirm('Сбросить все данные?')) return;
        state.processDraft = { variables: [], steps: [], selectedStepId: null };
        state.stepEditorDraft = null;
        state.sourceEditorDraft = '';
        state.parserState = 'Idle';
        $sourceHocon.val('');
        setMessage('Draft сброшен.', 'secondary');
        renderAll();
    });

    // Source modal
    $('#source-load-sample-btn').on('click', function() {
        $.get('/api/hocon/sample/sample-flow.conf').done(function(text) {
            state.sourceEditorDraft = text;
            $sourceHocon.val(text);
            setSourceMsg('Sample вставлен в source modal.', 'info');
        });
    });
    $('#clear-source-btn').on('click', function() {
        state.sourceEditorDraft = '';
        $sourceHocon.val('');
        setSourceMsg('Source cleared.', 'secondary');
    });
    $('#copy-exported-btn, #copy-output-to-source-btn').on('click', function() {
        state.sourceEditorDraft = HoconSerializer.serializeHocon(state.processDraft);
        $sourceHocon.val(state.sourceEditorDraft);
        setMessage('HOCON скопирован в source modal.', 'success');
        setSourceMsg('Exported HOCON скопирован.', 'success');
    });
    $('#parse-source-btn').on('click', function() {
        applySourceText($sourceHocon.val(), { successMessage: 'HOCON parsed & applied.', keepSourceText: true, closeModal: true });
    });
    $sourceHocon.on('input', function() { state.sourceEditorDraft = $sourceHocon.val(); });

    // Step modal save
    $('#save-step-btn').on('click', saveStepEditorDraft);

    // Flow map clicks
    $flowMapColumns.on('click', '[data-action]', function() {
        var action = $(this).data('action');
        var id = $(this).data('id');
        if (action === 'edit') openStepEditor(id);
        else if (action === 'duplicate') duplicateStep(id);
        else if (action === 'delete') deleteStep(id);
        else if (action === 'add-next') {
            var parentLevel = parseInt($flowMapColumns.find('[data-flow-node="' + id + '"]').attr('data-level') || '0', 10);
            openStepEditor(null, { startsAfterStepId: id, openAfterSave: true, suggestedLevel: parentLevel + 1 });
        }
    });
    $flowMapColumns.on('click', '[data-flow-node]', function(e) {
        if ($(e.target).closest('[data-action]').length) return;
        var sid = $(this).data('step-id');
        if (sid) selectStep(sid);
    });
    $flowMapColumns.on('dblclick', '[data-flow-node]', function() {
        var sid = $(this).data('step-id');
        if (sid) openStepEditor(sid);
    });
    $flowMapColumns.on('click', '.backref-jump-btn', function(e) {
        e.stopPropagation();
        var targetId = $(this).data('target');
        var $node = $flowMapColumns.find('[data-flow-node="' + targetId + '"]');
        if ($node.length) {
            $node[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            selectStep(targetId);
        }
    });

    // Variables
    $variablesContainer.on('click', '.delete-var-btn', function() {
        var idx = Number($(this).data('idx'));
        state.processDraft.variables = VariablesEditor.readVariablesFromDom($variablesContainer);
        state.processDraft.variables.splice(idx, 1);
        VariablesEditor.renderVariablesTable($variablesContainer, state.processDraft.variables);
        renderExported();
    });
    $('#add-variable-btn').on('click', function() {
        state.processDraft.variables = VariablesEditor.readVariablesFromDom($variablesContainer);
        state.processDraft.variables.push({ name: '', type: 'string', value: '', description: '', required: false, constraint: null });
        VariablesEditor.renderVariablesTable($variablesContainer, state.processDraft.variables);
    });

    // On variable change, update export
    $variablesContainer.on('change input', 'input, select', function() {
        state.processDraft.variables = VariablesEditor.readVariablesFromDom($variablesContainer);
        renderExported();
    });

    $(window).on('resize', redrawLines);

    // ── Core functions ─────────────────────────────────────────────────

    function applySourceText(text, opts) {
        opts = $.extend({ successMessage: 'Parsed.', keepSourceText: true, closeModal: false }, opts);
        state.sourceEditorDraft = text;
        $sourceHocon.val(text);

        if (!text.trim()) {
            state.parserState = 'Empty';
            setMessage('Source пуст.', 'danger');
            setSourceMsg('Source пуст.', 'danger');
            renderAll();
            return;
        }

        try {
            var parsed = HoconParser.parseHocon(text);
            state.parserState = 'Parsed';
            state.processDraft = {
                variables: parsed.variables || [],
                steps: (parsed.steps || []).map(normalizeStep),
                selectedStepId: parsed.steps.length ? parsed.steps[0].id : null
            };
            renderAll();
            setMessage(opts.successMessage, 'success');
            setSourceMsg(opts.successMessage, 'success');
            if (opts.closeModal) sourceModal.hide();
        } catch (err) {
            state.parserState = 'Error';
            setMessage(err.message, 'danger');
            setSourceMsg(err.message, 'danger');
            renderAll();
        }
    }

    function renderAll() {
        renderStatusBar();
        renderGlobalMsg();
        renderVariables();
        renderFlowMap();
        renderExported();
    }

    function renderStatusBar() {
        var transitions = FlowRenderer.getTransitions(state.processDraft.steps);
        var incoming = FlowRenderer.getIncomingCounts(state.processDraft.steps);
        var startSteps = state.processDraft.steps.filter(function(s) { return !incoming[s.id]; });
        $stepsCount.text(state.processDraft.steps.length);
        $transitionsCount.text(transitions.length);
        $startStepsCount.text(startSteps.length);
        $parserState.text(state.parserState);
    }

    function renderGlobalMsg() {
        $globalMsg.attr('class', 'alert alert-' + state.message.type + ' mb-3').text(state.message.text);
    }

    function renderVariables() {
        VariablesEditor.renderVariablesTable($variablesContainer, state.processDraft.variables);
    }

    function renderFlowMap() {
        if (!state.processDraft.steps.length) {
            state.renderedFlowLines = [];
            $flowMapEmpty.removeClass('d-none');
            $flowMapShell.addClass('d-none');
            $flowMapColumns.empty();
            $flowMapLines.empty();
            return;
        }

        $flowMapEmpty.addClass('d-none');
        $flowMapShell.removeClass('d-none');

        var graph = FlowRenderer.buildFlowMapModel(state.processDraft.steps, state.processDraft.selectedStepId);
        state.renderedFlowLines = graph.lines;
        $flowMapColumns.html(graph.levels.map(FlowRenderer.renderFlowLevel).join(''));
        requestAnimationFrame(redrawLines);
    }

    function redrawLines() {
        if (!state.processDraft.steps.length) return;
        FlowRenderer.redrawFlowLines(
            state.renderedFlowLines,
            $flowMapInner[0], $flowMapShell[0], $flowMapColumns[0], $flowMapLines[0]
        );
    }

    function renderExported() {
        state.processDraft.variables = VariablesEditor.readVariablesFromDom($variablesContainer);
        $outputHocon.val(HoconSerializer.serializeHocon(state.processDraft));
    }

    function setMessage(text, type) {
        state.message = { text: text, type: type || 'secondary' };
        renderGlobalMsg();
    }

    function setSourceMsg(text, type) {
        $sourceMsg.attr('class', 'alert alert-' + type + ' mb-3').text(text);
    }

    function setStepMsg(text, type) {
        $stepModalMsg.attr('class', 'alert alert-' + type + ' mb-3').text(text);
    }

    // ── Step editing ───────────────────────────────────────────────────

    function normalizeStep(step) {
        var lvl = step.uiLevel;
        return {
            id: String(step.id || '').trim(),
            name: String(step.name || '').trim(),
            type: step.type || 'EMPTY',
            connection: String(step.connection || '').trim(),
            maxRetries: Math.max(0, Number(step.maxRetries) || 0),
            retryDelayMs: Math.max(0, Number(step.retryDelayMs) || 0),
            uiLevel: (lvl != null && Number.isFinite(Number(lvl))) ? Math.max(0, Math.round(Number(lvl))) : null,
            config: Object.fromEntries(
                Object.entries(step.config || {})
                    .map(function(e) { return [String(e[0]).trim(), String(e[1] == null ? '' : e[1])]; })
                    .filter(function(e) { return e[0]; })
            ),
            outputs: Array.isArray(step.outputs)
                ? step.outputs.map(function(o, i) {
                    return { to: String(o.to || '').trim(), condition: String(o.condition || '').trim(), order: Number.isFinite(o.order) ? o.order : i };
                }).filter(function(o) { return o.to; })
                : []
        };
    }

    function createEditorDraft(step, originalId, options) {
        var n = normalizeStep(step);
        var opts = $.extend({ startsAfterStepId: '', openAfterSave: false, suggestedLevel: null }, options);
        // Auto-set uiLevel for new steps created via "add-next"
        if (originalId == null && opts.suggestedLevel != null && n.uiLevel == null) {
            n.uiLevel = Math.max(0, Math.round(Number(opts.suggestedLevel)));
        }
        return {
            originalId: originalId || null,
            step: n,
            startsAfterStepId: String(opts.startsAfterStepId || '').trim(),
            openAfterSave: Boolean(opts.openAfterSave),
            configRows: Object.entries(n.config).map(function(e) { return { key: e[0], value: e[1] }; }),
            outputRows: n.outputs.slice().sort(function(a, b) { return a.order - b.order; }).map(function(o) { return { to: o.to, condition: o.condition || '' }; })
        };
    }

    function openStepEditor(stepId, options) {
        if (stepId) {
            var step = FlowRenderer.getStepById(state.processDraft.steps, stepId);
            if (!step) return;
            state.processDraft.selectedStepId = stepId;
            state.stepEditorDraft = createEditorDraft(step, step.id, options);
        } else {
            var nextId = generateStepId('new_step');
            state.stepEditorDraft = createEditorDraft({ id: nextId, name: nextId.replace(/_/g, ' '), type: 'EMPTY', config: {}, outputs: [] }, null, options);
        }
        setStepMsg('Изменения применяются после Save step.', 'secondary');
        renderStepEditor();
        renderAll();
        stepModal.show();
    }

    function renderStepEditor() {
        var draft = state.stepEditorDraft;
        if (!draft) { $stepEditorBody.html('<div class="empty-hint">Нет данных.</div>'); return; }

        $stepModalTitle.text(draft.originalId ? 'Step · ' + draft.step.id : 'Create Step');
        $stepModalSubtitle.text(draft.originalId ? 'Редактирование шага.' : 'Новый шаг.');

        StepEditor.loadStepType(draft.step.type, function(typeDesc) {
            var doRender = function(connections) {
                StepEditor.renderStepEditorModal($stepEditorBody, draft, state.processDraft.steps, typeDesc, connections);
                bindStepEditorEvents();
                // Initialize CodeMirror for SQL field
                var sqlTextarea = document.getElementById('config-api-sql');
                if (sqlTextarea && !sqlTextarea._cmEditor && typeof CodeMirror !== 'undefined') {
                    var cm = CodeMirror.fromTextArea(sqlTextarea, {
                        mode: 'text/x-sql', lineNumbers: true, theme: 'default', viewportMargin: Infinity
                    });
                    sqlTextarea._cmEditor = cm;
                    cm.on('change', function() { cm.save(); });
                }
            };
            if (typeDesc && typeDesc.requiresConnection) {
                StepEditor.loadConnections(doRender);
            } else {
                doRender([]);
            }
        });
    }

    function bindStepEditorEvents() {
        $('#step-type-input').off('change').on('change', function() {
            StepEditor.syncDraftFromDom(state.stepEditorDraft, $stepEditorBody);
            state.stepEditorDraft.step.type = $(this).val();
            renderStepEditor();
        });

        $('#add-config-row-btn').off('click').on('click', function() {
            StepEditor.syncDraftFromDom(state.stepEditorDraft, $stepEditorBody);
            state.stepEditorDraft.configRows.push({ key: '', value: '' });
            renderStepEditor();
        });

        $('#add-output-row-btn').off('click').on('click', function() {
            StepEditor.syncDraftFromDom(state.stepEditorDraft, $stepEditorBody);
            state.stepEditorDraft.outputRows.push({ to: '', condition: '' });
            renderStepEditor();
        });

        $stepEditorBody.off('click', '.delete-config-row-btn').on('click', '.delete-config-row-btn', function() {
            StepEditor.syncDraftFromDom(state.stepEditorDraft, $stepEditorBody);
            // Need to find the right extra-row index
            var idx = Number($(this).data('index'));
            // Extra rows start after API fields
            var apiKeys = [];
            $stepEditorBody.find('.config-api-field').each(function() { apiKeys.push($(this).data('key')); });
            var extraRows = state.stepEditorDraft.configRows.filter(function(r) { return apiKeys.indexOf(r.key) === -1; });
            var removed = extraRows[idx];
            if (removed) {
                var mainIdx = state.stepEditorDraft.configRows.indexOf(removed);
                if (mainIdx >= 0) state.stepEditorDraft.configRows.splice(mainIdx, 1);
            }
            renderStepEditor();
        });

        $stepEditorBody.off('click', '.delete-output-row-btn').on('click', '.delete-output-row-btn', function() {
            StepEditor.syncDraftFromDom(state.stepEditorDraft, $stepEditorBody);
            state.stepEditorDraft.outputRows.splice(Number($(this).data('index')), 1);
            renderStepEditor();
        });

        $stepEditorBody.off('click', '.create-step-btn').on('click', '.create-step-btn', function() {
            var idx = Number($(this).data('index'));
            var toId = $stepEditorBody.find('#output-rows-body tr').eq(idx).find('.output-to').val().trim();
            if (!toId || FlowRenderer.getStepById(state.processDraft.steps, toId)) return;
            var parentLvl = state.stepEditorDraft && state.stepEditorDraft.step.uiLevel != null ? state.stepEditorDraft.step.uiLevel : null;
            state.processDraft.steps.push(normalizeStep({ id: toId, name: toId, type: 'EMPTY', config: {}, outputs: [], uiLevel: parentLvl != null ? parentLvl + 1 : null }));
            setMessage("Шаг '" + toId + "' создан как EMPTY.", 'success');
            renderAll();
            renderStepEditor();
        });
    }

    function saveStepEditorDraft() {
        if (!state.stepEditorDraft) return;
        StepEditor.syncDraftFromDom(state.stepEditorDraft, $stepEditorBody);
        var draft = state.stepEditorDraft;

        var nextStep = normalizeStep({
            id: draft.step.id, name: draft.step.name, type: draft.step.type,
            connection: draft.step.connection,
            maxRetries: draft.step.maxRetries, retryDelayMs: draft.step.retryDelayMs,
            uiLevel: draft.step.uiLevel,
            config: Object.fromEntries(draft.configRows.filter(function(r) { return r.key.trim(); }).map(function(r) { return [r.key.trim(), r.value]; })),
            outputs: draft.outputRows.map(function(r, i) { return { to: r.to.trim(), condition: r.condition.trim(), order: i }; }).filter(function(o) { return o.to; })
        });

        // Auto-create missing output targets as EMPTY
        nextStep.outputs.forEach(function(out) {
            if (out.to && !FlowRenderer.getStepById(state.processDraft.steps, out.to) && out.to !== nextStep.id) {
                if (confirm("Шаг '" + out.to + "' не найден. Создать как EMPTY?")) {
                    state.processDraft.steps.push(normalizeStep({ id: out.to, name: out.to, type: 'EMPTY', config: {}, outputs: [] }));
                }
            }
        });

        // Validate
        if (!nextStep.id) { setStepMsg('Step ID обязателен.', 'danger'); return; }
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(nextStep.id)) { setStepMsg('Step ID: допустимы буквы, цифры, _, -.', 'danger'); return; }
        var existing = FlowRenderer.getStepById(state.processDraft.steps, nextStep.id);
        if (existing && nextStep.id !== draft.originalId) { setStepMsg('Шаг с таким ID уже существует.', 'danger'); return; }

        if (draft.originalId) {
            var idx = state.processDraft.steps.findIndex(function(s) { return s.id === draft.originalId; });
            if (idx === -1) { setStepMsg('Исходный шаг не найден.', 'danger'); return; }
            state.processDraft.steps[idx] = nextStep;
            if (draft.originalId !== nextStep.id) {
                state.processDraft.steps.forEach(function(s) {
                    s.outputs.forEach(function(o) { if (o.to === draft.originalId) o.to = nextStep.id; });
                });
            }
        } else {
            state.processDraft.steps.push(nextStep);
            if (draft.startsAfterStepId) {
                var parent = FlowRenderer.getStepById(state.processDraft.steps, draft.startsAfterStepId);
                if (parent) {
                    parent.outputs.push({ to: nextStep.id, condition: '', order: parent.outputs.length });
                }
            }
        }

        state.processDraft.selectedStepId = nextStep.id;
        setMessage("Шаг '" + nextStep.id + "' сохранен.", 'success');
        renderAll();

        if (!draft.originalId && draft.openAfterSave) {
            state.stepEditorDraft = createEditorDraft(nextStep, nextStep.id);
            setStepMsg('Шаг создан и связан. Продолжите редактирование.', 'success');
            renderStepEditor();
            return;
        }

        state.stepEditorDraft = null;
        stepModal.hide();
    }

    function selectStep(stepId) {
        if (!FlowRenderer.getStepById(state.processDraft.steps, stepId)) return;
        state.processDraft.selectedStepId = stepId;
        renderAll();
    }

    function duplicateStep(stepId) {
        var step = FlowRenderer.getStepById(state.processDraft.steps, stepId);
        if (!step) return;
        var copy = JSON.parse(JSON.stringify(step));
        copy.id = generateStepId(step.id + '_copy');
        copy.name = (copy.name || copy.id) + ' Copy';
        state.processDraft.steps.push(normalizeStep(copy));
        state.processDraft.selectedStepId = copy.id;
        setMessage("Шаг '" + copy.id + "' создан как копия.", 'success');
        renderAll();
    }

    function deleteStep(stepId) {
        if (!confirm("Удалить шаг '" + stepId + "'?")) return;
        state.processDraft.steps = state.processDraft.steps.filter(function(s) { return s.id !== stepId; });
        state.processDraft.steps.forEach(function(s) {
            s.outputs = s.outputs.filter(function(o) { return o.to !== stepId; })
                .map(function(o, i) { return { to: o.to, condition: o.condition, order: i }; });
        });
        if (state.processDraft.selectedStepId === stepId) {
            state.processDraft.selectedStepId = state.processDraft.steps.length ? state.processDraft.steps[0].id : null;
        }
        setMessage("Шаг '" + stepId + "' удален.", 'success');
        renderAll();
    }

    function generateStepId(baseId) {
        var n = String(baseId || 'step').trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+/, '').replace(/_+$/, '');
        if (!n) n = 'step';
        if (!/^[A-Za-z_]/.test(n)) n = 'step_' + n;
        var candidate = n, suffix = 1;
        while (FlowRenderer.getStepById(state.processDraft.steps, candidate)) {
            candidate = n + '_' + suffix;
            suffix++;
        }
        return candidate;
    }

    // ── Init ───────────────────────────────────────────────────────────
    renderAll();
});
