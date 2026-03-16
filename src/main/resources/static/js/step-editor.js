/**
 * Step Editor — modal for editing a single step with dynamic API-driven config fields
 */
const StepEditor = (function() {
    'use strict';

    var _stepTypesCache = {};
    var _connectionsCache = null;

    function loadConnections(callback) {
        if (_connectionsCache) { callback(_connectionsCache); return; }
        $.get('/api/connections').done(function(data) {
            _connectionsCache = data;
            callback(data);
        }).fail(function() { callback([]); });
    }

    function loadStepType(type, callback) {
        if (_stepTypesCache[type]) {
            callback(_stepTypesCache[type]);
            return;
        }
        $.get("/api/step-types/" + encodeURIComponent(type))
            .done(function(data) {
                _stepTypesCache[type] = data;
                callback(data);
            })
            .fail(function() {
                callback(null);
            });
    }

    function loadStepTypesList(callback) {
        $.get("/api/step-types").done(callback).fail(function() { callback([]); });
    }

    function renderStepEditorModal($body, draft, allSteps, typeDescriptor, connections) {
        var step = draft.step;
        var configRows = draft.configRows;
        var outputRows = draft.outputRows;

        var typeOptions = '';
        // Build type options from known types
        var knownTypes = ["START", "END", "ORACLE_PLSQL", "HTTP", "EMAIL", "EMPTY"];
        knownTypes.forEach(function(t) {
            typeOptions += '<option value="' + esc(t) + '"' + (t === step.type ? ' selected' : '') + '>' + esc(t) + '</option>';
        });

        var configHint = typeDescriptor
            ? esc(typeDescriptor.description || '')
            : 'Используйте config для adapter-specific key/value пар.';

        // Build dynamic config fields from type descriptor
        var dynamicFieldsHtml = '';
        var apiFieldKeys = [];
        if (typeDescriptor && typeDescriptor.fields && typeDescriptor.fields.length) {
            dynamicFieldsHtml = '<div class="mb-3">';
            typeDescriptor.fields.forEach(function(field) {
                apiFieldKeys.push(field.key);
                var currentValue = '';
                // find value in configRows
                for (var i = 0; i < configRows.length; i++) {
                    if (configRows[i].key === field.key) { currentValue = configRows[i].value; break; }
                }
                dynamicFieldsHtml += renderDynamicField(field, currentValue);
            });
            dynamicFieldsHtml += '</div>';
        }

        // Extra config rows (not in API fields)
        var extraRows = configRows.filter(function(r) {
            return apiFieldKeys.indexOf(r.key) === -1;
        });

        // Starts after (for new steps)
        var startsAfterHtml = '';
        if (!draft.originalId) {
            var opts = '<option value="">Independent start step</option>';
            allSteps.forEach(function(s) {
                opts += '<option value="' + esc(s.id) + '"' + (s.id === draft.startsAfterStepId ? ' selected' : '') + '>' + esc(s.id) + '</option>';
            });
            startsAfterHtml = '<div class="col-md-6"><label class="form-label" for="step-starts-after-input">Starts after</label>' +
                '<select class="form-select" id="step-starts-after-input">' + opts + '</select></div>';
        }

        // Connection field visibility
        var showConnection = typeDescriptor ? typeDescriptor.requiresConnection : true;
        var showRetry = typeDescriptor ? typeDescriptor.supportsRetry : true;
        var isStartOrEnd = (step.type === 'START' || step.type === 'END');
        var isEnd = step.type === 'END';

        // Type hints (kept for internal use but not rendered as section)
        var hintsHtml = '';
        if (typeDescriptor && typeDescriptor.hints && typeDescriptor.hints.length) {
            hintsHtml = typeDescriptor.hints.map(function(h) {
                return '<div class="note-card">' + esc(h) + '</div>';
            }).join('');
        }

        $body.html(
            '<div class="editor-grid">' +
            // Base fields
            '<section class="editor-section"><h3>Base fields</h3><p>Основные поля шага.</p>' +
            '<div class="row g-3">' +
            inputField("Step ID", "step-id-input", step.id, "text", "new_step") +
            inputField("Name", "step-name-input", step.name, "text", "Human readable name") +
            '<div class="col-md-6"><label class="form-label" for="step-ui-level-input">UI Level</label>' +
            '<input class="form-control" id="step-ui-level-input" type="number" min="0" value="' + (step.uiLevel != null ? esc(String(step.uiLevel)) : '') + '" placeholder="auto">' +
            '<div class="form-text">Оставьте пустым для автовычисления по топологии графа.</div></div>' +
            '<div class="col-md-6"><label class="form-label" for="step-type-input">Type</label>' +
            '<select class="form-select" id="step-type-input">' + typeOptions + '</select></div>' +
            (showConnection ? buildConnectionField(step.connection, connections) : '<input type="hidden" id="step-connection-input" value="">') +
            (showRetry ? inputField("Max retries", "step-retries-input", String(step.maxRetries), "number", "0") : '<input type="hidden" id="step-retries-input" value="0">') +
            (showRetry ? inputField("Retry delay ms", "step-delay-input", String(step.retryDelayMs), "number", "0") : '<input type="hidden" id="step-delay-input" value="0">') +
            startsAfterHtml +
            '</div></section>' +

            // Config section (hidden for START/END)
            (!isStartOrEnd ?
                '<section class="editor-section">' +
                '<div class="d-flex flex-wrap justify-content-between align-items-start gap-2">' +
                '<div><h3>Config</h3><p>' + configHint + '</p></div>' +
                '<button type="button" class="btn btn-sm btn-outline-secondary" id="add-config-row-btn">Добавить поле</button>' +
                '</div>' +
                dynamicFieldsHtml +
                (extraRows.length ? renderExtraConfigTable(extraRows) : '<table class="editor-table"><thead><tr><th>Key</th><th>Value</th><th></th></tr></thead><tbody id="config-rows-body"></tbody></table>') +
                '</section>'
            : '') +

            // Outputs section (hidden for END)
            (!isEnd ?
                '<section class="editor-section">' +
                '<div class="d-flex flex-wrap justify-content-between align-items-start gap-2">' +
                '<div><h3>Outputs</h3><p>Условный переход задается через <code>condition</code>. Пустое условие — fallback.</p></div>' +
                '<button type="button" class="btn btn-sm btn-outline-secondary" id="add-output-row-btn">Add output</button>' +
                '</div>' +
                renderOutputTable(outputRows, allSteps) +
                '</section>'
            : '') +

            // Exception section (hidden for START/END)
            (!isStartOrEnd ? renderExceptionSection(step, allSteps) : '') +

            // Delete / Duplicate actions (hidden for START/END and new steps)
            (draft.originalId && !isStartOrEnd ?
                '<div class="d-flex gap-2 mt-1">' +
                '<button type="button" class="btn btn-outline-secondary btn-sm" id="duplicate-step-modal-btn">Копировать</button>' +
                '<button type="button" class="btn btn-outline-danger btn-sm" id="delete-step-modal-btn">Удалить</button>' +
                '</div>'
            : '') +

            '</div>'
        );

        if (isStartOrEnd) {
            $('#step-id-input').prop('readonly', true);
            $('#step-type-input').prop('disabled', true);
        }

        if (!isStartOrEnd) {
            bindExceptionToggle($body);
        }
    }

    function renderExceptionSection(step, allSteps) {
        var ex = step.exception || { type: 'break', userForm: ['break', 'next'], gotoStep: '' };
        var excTypeOptions = [
            { val: 'break',  label: '1. Прерывание всего процесса' },
            { val: 'ignore', label: '2. Игнорирование (следующий шаг)' },
            { val: 'user',   label: '3. Запрос пользователя' },
            { val: 'goto',   label: '4. Переход на шаг' }
        ].map(function(o) {
            return '<option value="' + esc(o.val) + '"' + (ex.type === o.val ? ' selected' : '') + '>' + esc(o.label) + '</option>';
        }).join('');

        var userBreakChecked = (ex.userForm || []).indexOf('break') >= 0 ? ' checked' : '';
        var userNextChecked  = (ex.userForm || []).indexOf('next')  >= 0 ? ' checked' : '';

        var stepOpts = (allSteps || []).map(function(s) {
            return '<option value="' + esc(s.id) + '">' + esc(s.name || s.id) + '</option>';
        }).join('');

        return '<section class="editor-section" id="exception-section">' +
            '<h3>Обработка исключений</h3>' +
            '<p>Реакция процесса при ошибке выполнения шага.</p>' +
            '<div class="mb-2"><label class="form-label" for="exc-type">Тип реакции</label>' +
            '<select class="form-select" id="exc-type">' + excTypeOptions + '</select></div>' +
            '<div id="exc-user-opts" class="mb-2">' +
            '<label class="form-label">Варианты для пользователя</label>' +
            '<div class="form-check"><input class="form-check-input" type="checkbox" id="exc-user-break"' + userBreakChecked + '>' +
            '<label class="form-check-label" for="exc-user-break">Прервать процесс</label></div>' +
            '<div class="form-check"><input class="form-check-input" type="checkbox" id="exc-user-next"' + userNextChecked + '>' +
            '<label class="form-check-label" for="exc-user-next">Продолжить</label></div></div>' +
            '<div id="exc-goto-wrap" class="mb-2">' +
            '<label class="form-label" for="exc-goto">Шаг для перехода</label>' +
            '<input class="form-control" id="exc-goto" list="exc-goto-list" value="' + esc(ex.gotoStep) + '" placeholder="step_id">' +
            '<datalist id="exc-goto-list">' + stepOpts + '</datalist></div>' +
            '</section>';
    }

    function bindExceptionToggle($body) {
        function update() {
            var t = $body.find('#exc-type').val();
            $body.find('#exc-user-opts').toggle(t === 'user');
            $body.find('#exc-goto-wrap').toggle(t === 'goto');
        }
        $body.find('#exc-type').on('change', update);
        update();
    }

    function renderDynamicField(field, value) {
        var id = 'config-api-' + field.key;
        var req = field.required ? ' <span class="text-danger">*</span>' : '';
        var hint = field.hint ? '<div class="form-text">' + esc(field.hint) + '</div>' : '';

        if (field.type === 'textarea') {
            var extraCls = field.key === 'sql' ? ' config-sql-editor' : '';
            return '<div class="mb-2"><label class="form-label" for="' + id + '">' + esc(field.label) + req + '</label>' +
                '<textarea class="form-control form-control-sm config-api-field' + extraCls + '" id="' + id + '" data-key="' + esc(field.key) + '" rows="3" placeholder="' + esc(field.placeholder || '') + '">' + esc(value) + '</textarea>' +
                hint + '</div>';
        }
        if (field.type === 'select' && field.options) {
            var opts = '<option value="">—</option>';
            field.options.forEach(function(o) {
                opts += '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>';
            });
            return '<div class="mb-2"><label class="form-label" for="' + id + '">' + esc(field.label) + req + '</label>' +
                '<select class="form-select form-select-sm config-api-field" id="' + id + '" data-key="' + esc(field.key) + '">' + opts + '</select>' +
                hint + '</div>';
        }
        if (field.type === 'number') {
            return '<div class="mb-2"><label class="form-label" for="' + id + '">' + esc(field.label) + req + '</label>' +
                '<input class="form-control form-control-sm config-api-field" id="' + id + '" data-key="' + esc(field.key) + '" type="number" value="' + esc(value) + '" placeholder="' + esc(field.placeholder || '') + '">' +
                hint + '</div>';
        }
        // default: text
        return '<div class="mb-2"><label class="form-label" for="' + id + '">' + esc(field.label) + req + '</label>' +
            '<input class="form-control form-control-sm config-api-field" id="' + id + '" data-key="' + esc(field.key) + '" type="text" value="' + esc(value) + '" placeholder="' + esc(field.placeholder || '') + '">' +
            hint + '</div>';
    }

    function renderExtraConfigTable(extraRows) {
        return '<table class="editor-table"><thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>' +
            '<tbody id="config-rows-body">' +
            extraRows.map(function(row, i) {
                return '<tr><td><input class="form-control form-control-sm config-key" data-index="' + i + '" value="' + esc(row.key) + '" placeholder="key"></td>' +
                    '<td><input class="form-control form-control-sm config-value" data-index="' + i + '" value="' + esc(row.value) + '" placeholder="value"></td>' +
                    '<td><button type="button" class="btn btn-sm btn-outline-danger delete-config-row-btn" data-index="' + i + '">×</button></td></tr>';
            }).join('') +
            '</tbody></table>';
    }

    function renderOutputTable(outputRows, allSteps) {
        if (!outputRows.length) {
            return '<div class="empty-hint mb-3">Переходы пока не заданы.</div>' +
                '<table class="editor-table"><thead><tr><th>To</th><th>Condition</th><th></th></tr></thead><tbody id="output-rows-body"></tbody></table>';
        }
        return '<table class="editor-table"><thead><tr><th>To</th><th>Condition</th><th></th></tr></thead>' +
            '<tbody id="output-rows-body">' +
            outputRows.map(function(row, i) {
                var stepExists = !row.to || (allSteps && allSteps.some(function(s) { return s.id === row.to; }));
                var createBtn = (!stepExists && row.to)
                    ? '<button type="button" class="btn btn-sm btn-outline-success create-step-btn" data-index="' + i + '" title="Создать шаг как EMPTY">+</button>'
                    : '';
                return '<tr><td><input class="form-control form-control-sm output-to" data-index="' + i + '" value="' + esc(row.to) + '" placeholder="next_step"></td>' +
                    '<td><input class="form-control form-control-sm output-condition" data-index="' + i + '" value="' + esc(row.condition) + '" placeholder="condition"></td>' +
                    '<td class="d-flex gap-1">' + createBtn + '<button type="button" class="btn btn-sm btn-outline-danger delete-output-row-btn" data-index="' + i + '">×</button></td></tr>';
            }).join('') +
            '</tbody></table>';
    }

    function buildConnectionField(currentValue, connections) {
        if (connections && connections.length) {
            var opts = '<option value="">— выбрать подключение —</option>';
            connections.forEach(function(c) {
                opts += '<option value="' + esc(c) + '"' + (c === currentValue ? ' selected' : '') + '>' + esc(c) + '</option>';
            });
            return '<div class="col-md-6"><label class="form-label" for="step-connection-input">Connection</label>' +
                '<select class="form-select" id="step-connection-input">' + opts + '</select></div>';
        }
        return inputField("Connection", "step-connection-input", currentValue, "text", "oracle-main");
    }

    function syncDraftFromDom(draft, $body) {
        draft.step.id = $('#step-id-input').val().trim();
        draft.step.name = $('#step-name-input').val().trim();
        var lvlRaw = $('#step-ui-level-input').val().trim();
        draft.step.uiLevel = lvlRaw === '' ? null : Math.max(0, Math.round(Number(lvlRaw)));
        draft.step.type = $('#step-type-input').val();
        draft.step.connection = $('#step-connection-input').val().trim();
        draft.step.maxRetries = Math.max(0, Number($('#step-retries-input').val() || 0));
        draft.step.retryDelayMs = Math.max(0, Number($('#step-delay-input').val() || 0));

        if (!draft.originalId) {
            var $sa = $('#step-starts-after-input');
            draft.startsAfterStepId = $sa.length ? $sa.val().trim() : "";
        }

        // Save CodeMirror editors back to textareas before reading values
        if (typeof CodeMirror !== 'undefined') {
            $body.find('.config-sql-editor').each(function() {
                if (this._cmEditor) this._cmEditor.save();
            });
        }

        // Merge API fields + extra config rows
        var configRows = [];
        $body.find('.config-api-field').each(function() {
            var key = $(this).data('key');
            var val = $(this).val();
            if (key) configRows.push({ key: key, value: val });
        });
        $body.find('#config-rows-body tr').each(function() {
            var $row = $(this);
            configRows.push({
                key: $row.find('.config-key').val() || '',
                value: $row.find('.config-value').val() || ''
            });
        });
        draft.configRows = configRows;

        draft.outputRows = [];
        $body.find('#output-rows-body tr').each(function() {
            var $row = $(this);
            draft.outputRows.push({
                to: $row.find('.output-to').val() || '',
                condition: $row.find('.output-condition').val() || ''
            });
        });

        var excType = $body.find('#exc-type').val() || 'break';
        var excUserForm = [];
        if ($body.find('#exc-user-break').prop('checked')) excUserForm.push('break');
        if ($body.find('#exc-user-next').prop('checked')) excUserForm.push('next');
        draft.step.exception = {
            type: excType,
            userForm: excType === 'user' ? excUserForm : ['break', 'next'],
            gotoStep: excType === 'goto' ? $body.find('#exc-goto').val().trim() : ''
        };
    }

    function inputField(label, id, value, type, placeholder) {
        return '<div class="col-md-6"><label class="form-label" for="' + id + '">' + esc(label) + '</label>' +
            '<input class="form-control" id="' + id + '" type="' + type + '" value="' + esc(value) + '" placeholder="' + esc(placeholder || '') + '"></div>';
    }

    function esc(v) {
        return String(v == null ? "" : v)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    return {
        loadStepType: loadStepType,
        loadStepTypesList: loadStepTypesList,
        loadConnections: loadConnections,
        renderStepEditorModal: renderStepEditorModal,
        syncDraftFromDom: syncDraftFromDom
    };
})();
