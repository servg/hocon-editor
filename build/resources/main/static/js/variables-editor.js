/**
 * Variables Editor — renders and manages the variables table
 */
const VariablesEditor = (function() {
    'use strict';

    const VAR_TYPES = ["string", "integer", "list_string", "list_integer", "binary_file"];

    function renderVariablesTable($container, variables) {
        if (!variables || !variables.length) {
            $container.html(
                '<div class="empty-hint mb-2">Переменные не заданы. Нажмите «Добавить переменную».</div>' +
                '<table class="editor-table d-none"><thead><tr><th>Имя</th><th>Тип</th><th>Значение</th><th>Описание</th><th>Обяз.</th><th>Constraint</th><th></th></tr></thead>' +
                '<tbody id="variables-body"></tbody></table>'
            );
            return;
        }

        var rows = variables.map(function(v, i) {
            var typeOptions = VAR_TYPES.map(function(t) {
                return '<option value="' + t + '"' + (t === v.type ? ' selected' : '') + '>' + t + '</option>';
            }).join('');

            return '<tr>' +
                '<td><input class="form-control form-control-sm var-name" data-idx="' + i + '" value="' + escA(v.name) + '" placeholder="varName"></td>' +
                '<td><select class="form-select form-select-sm var-type var-type-select" data-idx="' + i + '">' + typeOptions + '</select></td>' +
                '<td><input class="form-control form-control-sm var-value" data-idx="' + i + '" value="' + escA(v.value) + '" placeholder="value"></td>' +
                '<td><input class="form-control form-control-sm var-desc" data-idx="' + i + '" value="' + escA(v.description || '') + '" placeholder="Описание"></td>' +
                '<td class="text-center"><input class="form-check-input var-required" data-idx="' + i + '" type="checkbox"' + (v.required ? ' checked' : '') + '></td>' +
                '<td><input class="form-control form-control-sm var-constraint" data-idx="' + i + '" value="' + escA(v.constraint && v.constraint.regex ? v.constraint.regex : '') + '" placeholder="regex"></td>' +
                '<td><button type="button" class="btn btn-sm btn-outline-danger delete-var-btn" data-idx="' + i + '">×</button></td>' +
                '</tr>';
        }).join('');

        $container.html(
            '<table class="editor-table">' +
            '<thead><tr><th>Имя</th><th>Тип</th><th>Значение</th><th>Описание</th><th>Обяз.</th><th>Constraint</th><th></th></tr></thead>' +
            '<tbody id="variables-body">' + rows + '</tbody></table>'
        );
    }

    function readVariablesFromDom($container) {
        var vars = [];
        $container.find('#variables-body tr').each(function() {
            var $row = $(this);
            var name = $row.find('.var-name').val().trim();
            if (!name) return;
            var constraintRegex = $row.find('.var-constraint').val().trim();
            vars.push({
                name: name,
                type: $row.find('.var-type').val() || 'string',
                value: $row.find('.var-value').val(),
                description: $row.find('.var-desc').val().trim(),
                required: $row.find('.var-required').is(':checked'),
                constraint: constraintRegex ? { regex: constraintRegex } : null
            });
        });
        return vars;
    }

    function escA(v) {
        return String(v == null ? "" : v)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    return {
        VAR_TYPES: VAR_TYPES,
        renderVariablesTable: renderVariablesTable,
        readVariablesFromDom: readVariablesFromDom
    };
})();
