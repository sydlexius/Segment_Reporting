/*
Copyright(C) 2024

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see<http://www.gnu.org/licenses/>.
*/

define([Dashboard.getConfigurationResourceUrl('segment_reporting_helpers.js')], function () {
    'use strict';

    return function (view, params) {

        var helpers = getSegmentReportingHelpers();
        var currentResults = [];
        var currentColumns = [];
        var currentCapabilities = null;
        var editingRow = null;
        var selectedRows = {};
        var creditsDetectorAvailable = false;
        var listenersAttached = false;

        // ===== COLUMN AUTO-DETECTION =====

        var TICK_COLUMNS = ['IntroStartTicks', 'IntroEndTicks', 'CreditsStartTicks'];

        function detectCapabilities(columns) {
            var hasItemId = columns.indexOf('ItemId') >= 0;
            var editableColumns = [];
            for (var i = 0; i < columns.length; i++) {
                if (TICK_COLUMNS.indexOf(columns[i]) >= 0) {
                    editableColumns.push(columns[i]);
                }
            }
            var canEdit = hasItemId && editableColumns.length > 0;
            var canDelete = hasItemId; // Delete only needs ItemId — marker type chosen from menu
            var canPlayback = hasItemId && editableColumns.length > 0;
            return {
                canEdit: canEdit,
                canDelete: canDelete,
                canPlayback: canPlayback,
                editableColumns: editableColumns
            };
        }

        // ===== QUERY BUILDER: Field & Operator Definitions =====

        var BUILDER_FIELDS = [
            { name: 'ItemName', label: 'Item Name', type: 'text' },
            { name: 'ItemType', label: 'Item Type', type: 'autocomplete' },
            { name: 'SeriesName', label: 'Series Name', type: 'autocomplete' },
            { name: 'SeasonName', label: 'Season Name', type: 'text' },
            { name: 'SeasonNumber', label: 'Season #', type: 'integer' },
            { name: 'EpisodeNumber', label: 'Episode #', type: 'integer' },
            { name: 'LibraryName', label: 'Library Name', type: 'autocomplete' },
            { name: 'IntroStartTicks', label: 'Intro Start', type: 'ticks' },
            { name: 'IntroEndTicks', label: 'Intro End', type: 'ticks' },
            { name: 'CreditsStartTicks', label: 'Credits Start', type: 'ticks' },
            { name: 'HasIntro', label: 'Has Intro', type: 'boolean' },
            { name: 'HasCredits', label: 'Has Credits', type: 'boolean' },
            { name: 'ItemId', label: 'Item ID', type: 'text' },
            { name: 'SeriesId', label: 'Series ID', type: 'text' },
            { name: 'SeasonId', label: 'Season ID', type: 'text' },
            { name: 'LibraryId', label: 'Library ID', type: 'text' }
        ];

        var BUILDER_OPS = {
            text: [
                { v: '=', l: 'equals' },
                { v: '!=', l: 'not equals' },
                { v: 'LIKE', l: 'contains' },
                { v: 'NOT LIKE', l: 'does not contain' },
                { v: 'IS NULL', l: 'is empty' },
                { v: 'IS NOT NULL', l: 'is not empty' }
            ],
            integer: [
                { v: '=', l: '=' },
                { v: '!=', l: '!=' },
                { v: '<', l: '<' },
                { v: '>', l: '>' },
                { v: '<=', l: '<=' },
                { v: '>=', l: '>=' },
                { v: 'BETWEEN', l: 'between' },
                { v: 'IS NULL', l: 'is empty' },
                { v: 'IS NOT NULL', l: 'is not empty' }
            ],
            ticks: [
                { v: '=', l: '=' },
                { v: '!=', l: '!=' },
                { v: '<', l: '<' },
                { v: '>', l: '>' },
                { v: '<=', l: '<=' },
                { v: '>=', l: '>=' },
                { v: 'BETWEEN', l: 'between' },
                { v: 'IS NULL', l: 'is empty' },
                { v: 'IS NOT NULL', l: 'is not empty' }
            ],
            'boolean': [
                { v: '=', l: 'equals' }
            ],
            autocomplete: [
                { v: '=', l: 'equals' },
                { v: '!=', l: 'not equals' },
                { v: 'IN', l: 'is any of' },
                { v: 'NOT IN', l: 'is none of' },
                { v: 'LIKE', l: 'contains' },
                { v: 'NOT LIKE', l: 'does not contain' },
                { v: 'IS NULL', l: 'is empty' },
                { v: 'IS NOT NULL', l: 'is not empty' }
            ],
        };

        // Shared inline styles
        var S_INPUT = 'padding:0.4em 0.5em;border-radius:4px;border:1px solid rgba(128,128,128,0.3);background:rgba(0,0,0,0.2);color:inherit;font-size:inherit;';
        var S_ROW = 'display:flex;align-items:center;gap:0.5em;margin-bottom:0.5em;flex-wrap:wrap;';
        var S_REMOVE = 'background:transparent;border:1px solid rgba(128,128,128,0.3);color:#F44336;border-radius:4px;cursor:pointer;padding:0.2em 0.55em;font-size:1em;line-height:1;';
        var S_ADD = 'background:transparent;border:1px solid rgba(128,128,128,0.3);border-radius:4px;cursor:pointer;padding:0.3em 0.8em;color:inherit;font-size:0.85em;margin-right:0.5em;';
        var S_PILL = 'display:inline-flex;align-items:center;padding:0.3em 0.7em;border-radius:16px;font-size:0.85em;cursor:grab;user-select:none;white-space:nowrap;transition:opacity 0.15s;';
        var S_PILL_OFF = S_PILL + 'background:transparent;border:1px dashed rgba(128,128,128,0.3);color:inherit;opacity:0.5;';
        var _accentHex = null;

        function getPillOnStyle() {
            if (!_accentHex) _accentHex = helpers.detectAccentColor(view) || '#52b54b';
            var rgb = helpers.hexToRgb(_accentHex);
            return S_PILL + 'background:rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.2);border:1px solid rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.5);color:inherit;';
        }

        // ===== QUERY BUILDER: State =====

        var _nextId = 1;
        var builderState = {
            columnOrder: BUILDER_FIELDS.map(function (f) { return f.name; }),
            selectedColumns: BUILDER_FIELDS.map(function (f) { return f.name; }),
            rootConnector: 'AND',
            items: [],
            orderByField: '',
            orderByDir: 'ASC',
            limit: 100
        };
        var builderVisible = false;

        // ===== AUTOCOMPLETE: Cache & Fetch =====

        var _autocompleteCache = {};
        var _acDropdownIdx = -1; // keyboard-highlighted index in dropdown

        function fetchAutocompleteValues(fieldName, callback) {
            if (_autocompleteCache[fieldName]) {
                callback(_autocompleteCache[fieldName]);
                return;
            }
            helpers.apiCall('distinct_values?field=' + encodeURIComponent(fieldName), 'GET')
                .then(function (data) {
                    var vals = (data && data.values) || (data && data.Values) || [];
                    if (Array.isArray(data) && !data.values && !data.Values) {
                        vals = data;
                    }
                    _autocompleteCache[fieldName] = vals;
                    callback(vals);
                })
                .catch(function (err) {
                    console.error('distinct_values fetch failed for ' + fieldName + ':', err);
                    // Don't cache failures — allow retry on next focus
                    callback([]);
                });
        }

        function filterSuggestions(allValues, query, excludeValues) {
            var q = (query || '').toLowerCase();
            return allValues.filter(function (v) {
                if (excludeValues && excludeValues.indexOf(v) >= 0) return false;
                return !q || v.toLowerCase().indexOf(q) >= 0;
            });
        }

        function getFieldDef(name) {
            for (var i = 0; i < BUILDER_FIELDS.length; i++) {
                if (BUILDER_FIELDS[i].name === name) return BUILDER_FIELDS[i];
            }
            return BUILDER_FIELDS[0];
        }

        function getOpsForType(type) {
            return BUILDER_OPS[type] || BUILDER_OPS.text;
        }

        var escHtml = helpers.escHtml;

        function mkCondition() {
            return { id: _nextId++, type: 'condition', field: BUILDER_FIELDS[0].name, operator: '=', value: '', value2: '', values: [] };
        }

        function mkGroup() {
            return { id: _nextId++, type: 'group', connector: 'AND', conditions: [mkCondition()] };
        }

        function findInItems(items, id) {
            for (var i = 0; i < items.length; i++) {
                if (items[i].id === id) return items[i];
                if (items[i].type === 'group') {
                    var found = findInItems(items[i].conditions, id);
                    if (found) return found;
                }
            }
            return null;
        }

        function removeFromItems(items, id) {
            for (var i = 0; i < items.length; i++) {
                if (items[i].id === id) {
                    items.splice(i, 1);
                    return true;
                }
                if (items[i].type === 'group' && removeFromItems(items[i].conditions, id)) {
                    return true;
                }
            }
            return false;
        }

        // ===== QUERY BUILDER: Rendering =====

        function renderBuilder() {
            var panel = view.querySelector('#queryBuilderPanel');
            if (!panel) return;

            var html = '';

            // Root connector
            html += '<div style="' + S_ROW + 'margin-bottom:0.8em;">';
            html += '<label style="font-weight:bold;">Match</label>';
            html += '<select data-action="root-connector" style="' + S_INPUT + '">';
            html += '<option value="AND"' + (builderState.rootConnector === 'AND' ? ' selected' : '') + '>ALL conditions (AND)</option>';
            html += '<option value="OR"' + (builderState.rootConnector === 'OR' ? ' selected' : '') + '>ANY condition (OR)</option>';
            html += '</select>';
            html += '</div>';

            // Column picker (draggable pills)
            html += '<div style="margin-bottom:1em;border-bottom:1px solid rgba(128,128,128,0.2);padding-bottom:1em;">';
            html += '<div style="' + S_ROW + 'margin-bottom:0.5em;">';
            html += '<label style="font-weight:bold;">Columns</label>';
            html += '<span style="font-size:0.8em;opacity:0.6;">drag to reorder, click to toggle</span>';
            html += '<button data-action="select-all-cols" style="' + S_ADD + 'font-size:0.8em;padding:0.2em 0.6em;margin-left:auto;">Enable All</button>';
            html += '<button data-action="select-none-cols" style="' + S_ADD + 'font-size:0.8em;padding:0.2em 0.6em;">Disable All</button>';
            html += '</div>';
            html += '<div id="columnPicker" style="display:flex;flex-wrap:wrap;gap:0.4em;">';
            for (var c = 0; c < builderState.columnOrder.length; c++) {
                var colName = builderState.columnOrder[c];
                var colDef = getFieldDef(colName);
                var isEnabled = builderState.selectedColumns.indexOf(colName) >= 0;
                html += '<div data-action="column-pill" data-col="' + colName + '" style="' + (isEnabled ? getPillOnStyle() : S_PILL_OFF) + 'touch-action:none;">';
                html += escHtml(colDef.label);
                html += '</div>';
            }
            html += '</div>';
            html += '</div>';

            // Conditions & groups
            for (var i = 0; i < builderState.items.length; i++) {
                var item = builderState.items[i];
                if (item.type === 'condition') {
                    html += renderConditionRow(item, '');
                } else if (item.type === 'group') {
                    html += renderGroupBlock(item);
                }
            }

            // Add buttons
            html += '<div style="margin-top:0.5em;margin-bottom:1em;">';
            html += '<button data-action="add-condition" data-parent="" style="' + S_ADD + '">+ Condition</button>';
            html += '<button data-action="add-group" data-parent="" style="' + S_ADD + '">+ Group</button>';
            html += '</div>';

            // Divider
            html += '<div style="border-top:1px solid rgba(128,128,128,0.2);padding-top:1em;margin-top:0.5em;">';

            // ORDER BY
            html += '<div style="' + S_ROW + 'margin-bottom:0.8em;">';
            html += '<label>Order by</label>';
            html += '<select data-action="order-field" style="' + S_INPUT + '">';
            html += '<option value="">None</option>';
            for (var f = 0; f < BUILDER_FIELDS.length; f++) {
                var sel = builderState.orderByField === BUILDER_FIELDS[f].name ? ' selected' : '';
                html += '<option value="' + BUILDER_FIELDS[f].name + '"' + sel + '>' + escHtml(BUILDER_FIELDS[f].label) + '</option>';
            }
            html += '</select>';
            html += '<select data-action="order-dir" style="' + S_INPUT + '">';
            html += '<option value="ASC"' + (builderState.orderByDir === 'ASC' ? ' selected' : '') + '>Ascending</option>';
            html += '<option value="DESC"' + (builderState.orderByDir === 'DESC' ? ' selected' : '') + '>Descending</option>';
            html += '</select>';
            html += '</div>';

            // LIMIT
            html += '<div style="' + S_ROW + '">';
            html += '<label>Limit</label>';
            html += '<input type="number" data-action="limit" value="' + builderState.limit + '" min="0" max="10000" style="' + S_INPUT + 'width:80px;">';
            html += '</div>';

            html += '</div>'; // end options div

            panel.innerHTML = html;
            syncToSQL();
        }

        function renderConditionRow(cond, parentId) {
            var fieldDef = getFieldDef(cond.field);
            var ops = getOpsForType(fieldDef.type);

            var html = '<div style="' + S_ROW + '">';

            // Field select
            html += '<select data-field="field" data-id="' + cond.id + '" data-parent="' + parentId + '" style="' + S_INPUT + '">';
            for (var i = 0; i < BUILDER_FIELDS.length; i++) {
                var sel = cond.field === BUILDER_FIELDS[i].name ? ' selected' : '';
                html += '<option value="' + BUILDER_FIELDS[i].name + '"' + sel + '>' + escHtml(BUILDER_FIELDS[i].label) + '</option>';
            }
            html += '</select>';

            // Operator select
            html += '<select data-field="operator" data-id="' + cond.id + '" data-parent="' + parentId + '" style="' + S_INPUT + '">';
            for (var o = 0; o < ops.length; o++) {
                var sel2 = cond.operator === ops[o].v ? ' selected' : '';
                html += '<option value="' + escHtml(ops[o].v) + '"' + sel2 + '>' + escHtml(ops[o].l) + '</option>';
            }
            html += '</select>';

            // Value input(s)
            html += getValueHtml(cond, fieldDef);

            // Remove button
            html += '<button data-action="remove" data-id="' + cond.id + '" style="' + S_REMOVE + '" title="Remove condition">&times;</button>';

            html += '</div>';
            return html;
        }

        function getValueHtml(cond, fieldDef) {
            var op = cond.operator;
            if (op === 'IS NULL' || op === 'IS NOT NULL') return '';

            if (fieldDef.type === 'boolean') {
                var html = '<select data-field="value" data-id="' + cond.id + '" style="' + S_INPUT + '">';
                html += '<option value="1"' + (cond.value === '1' || cond.value === '' ? ' selected' : '') + '>Yes (1)</option>';
                html += '<option value="0"' + (cond.value === '0' ? ' selected' : '') + '>No (0)</option>';
                html += '</select>';
                return html;
            }

            // Autocomplete fields: pill/chip UI for IN/NOT IN, autocomplete input for =/!=
            if (fieldDef.type === 'autocomplete') {
                if (op === 'IN' || op === 'NOT IN') {
                    return getPillContainerHtml(cond, fieldDef);
                }
                if (op === '=' || op === '!=') {
                    return getAutocompleteInputHtml(cond, fieldDef);
                }
                // LIKE / NOT LIKE: plain text input (no autocomplete for pattern matching)
                var h2 = '<input type="text" data-field="value" data-id="' + cond.id + '" ' +
                    'value="' + escHtml(cond.value) + '" placeholder="Type a pattern..." style="' + S_INPUT + 'width:200px;">';
                return h2;
            }

            var inputType = 'text';
            var placeholder = '';
            if (fieldDef.type === 'integer') {
                inputType = 'number';
            } else if (fieldDef.type === 'ticks') {
                placeholder = 'HH:MM:SS.fff';
            }

            var h = '<input type="' + inputType + '" data-field="value" data-id="' + cond.id + '" ' +
                'value="' + escHtml(cond.value) + '" placeholder="' + placeholder + '" style="' + S_INPUT + 'width:150px;">';

            if (op === 'BETWEEN') {
                h += '<span style="margin:0 0.3em;">and</span>';
                h += '<input type="' + inputType + '" data-field="value2" data-id="' + cond.id + '" ' +
                    'value="' + escHtml(cond.value2) + '" placeholder="' + placeholder + '" style="' + S_INPUT + 'width:150px;">';
            }

            return h;
        }

        function getPillContainerHtml(cond, fieldDef) {
            var vals = cond.values || [];
            var accentRgb = getAccentRgb();
            var html = '<div class="sr-pill-container" data-id="' + cond.id + '" data-field-name="' + fieldDef.name + '">';
            for (var i = 0; i < vals.length; i++) {
                html += '<span class="sr-chip" style="background:rgba(' + accentRgb + ',0.2);border:1px solid rgba(' + accentRgb + ',0.5);">';
                html += escHtml(vals[i]);
                html += '<span class="sr-chip-x" data-action="remove-chip" data-id="' + cond.id + '" data-idx="' + i + '">&times;</span>';
                html += '</span>';
            }
            html += '<input type="text" class="sr-pill-input" data-id="' + cond.id + '" data-field-name="' + fieldDef.name + '" placeholder="Type to search..." autocomplete="off">';
            html += '<div class="sr-ac-dropdown" data-id="' + cond.id + '" style="display:none;"></div>';
            html += '</div>';
            return html;
        }

        function getAutocompleteInputHtml(cond, fieldDef) {
            var html = '<div class="sr-ac-wrapper" data-id="' + cond.id + '" data-field-name="' + fieldDef.name + '">';
            html += '<input type="text" class="sr-ac-input" data-field="value" data-id="' + cond.id + '" data-field-name="' + fieldDef.name + '" ' +
                'value="' + escHtml(cond.value) + '" placeholder="Type to search..." style="' + S_INPUT + 'width:200px;" autocomplete="off">';
            html += '<div class="sr-ac-dropdown" data-id="' + cond.id + '" style="display:none;"></div>';
            html += '</div>';
            return html;
        }

        function getAccentRgb() {
            if (!_accentHex) _accentHex = helpers.detectAccentColor(view) || '#52b54b';
            var rgb = helpers.hexToRgb(_accentHex);
            return rgb.r + ',' + rgb.g + ',' + rgb.b;
        }

        function renderGroupBlock(group) {
            var html = '<div style="border-left:3px solid rgba(128,128,128,0.4);padding:0.5em 0 0.5em 1em;margin:0.5em 0;background:rgba(128,128,128,0.03);border-radius:0 4px 4px 0;">';

            // Group header: connector + remove
            html += '<div style="' + S_ROW + 'margin-bottom:0.5em;">';
            html += '<select data-action="group-connector" data-id="' + group.id + '" style="' + S_INPUT + '">';
            html += '<option value="AND"' + (group.connector === 'AND' ? ' selected' : '') + '>ALL (AND)</option>';
            html += '<option value="OR"' + (group.connector === 'OR' ? ' selected' : '') + '>ANY (OR)</option>';
            html += '</select>';
            html += '<button data-action="remove" data-id="' + group.id + '" style="' + S_REMOVE + '" title="Remove group">&times;</button>';
            html += '</div>';

            // Group children (conditions and nested groups)
            for (var i = 0; i < group.conditions.length; i++) {
                var child = group.conditions[i];
                if (child.type === 'group') {
                    html += renderGroupBlock(child);
                } else {
                    html += renderConditionRow(child, String(group.id));
                }
            }

            // Add condition/group to this group
            html += '<div style="margin-top:0.3em;">';
            html += '<button data-action="add-condition" data-parent="' + group.id + '" style="' + S_ADD + '">+ Condition</button>';
            html += '<button data-action="add-group" data-parent="' + group.id + '" style="' + S_ADD + '">+ Group</button>';
            html += '</div>';

            html += '</div>';
            return html;
        }

        // ===== QUERY BUILDER: SQL Parser (Import) =====

        function tokenize(sql) {
            var tokens = [];
            var i = 0;
            while (i < sql.length) {
                if (/\s/.test(sql[i])) { i++; continue; }

                // Multi-char operators
                var two = sql.substr(i, 2);
                if (two === '!=' || two === '<=' || two === '>=') {
                    tokens.push({ type: 'op', value: two }); i += 2; continue;
                }

                var ch = sql[i];

                // Single-char operators/symbols
                if (ch === '=' || ch === '<' || ch === '>') {
                    tokens.push({ type: 'op', value: ch }); i++; continue;
                }
                if (ch === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
                if (ch === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
                if (ch === ',') { tokens.push({ type: 'comma' }); i++; continue; }
                if (ch === '*') { tokens.push({ type: 'star' }); i++; continue; }

                // Quoted string (single quotes, '' for escaped quote)
                if (ch === "'") {
                    var j = i + 1;
                    var str = '';
                    while (j < sql.length) {
                        if (sql[j] === "'" && sql[j + 1] === "'") {
                            str += "'"; j += 2;
                        } else if (sql[j] === "'") {
                            break;
                        } else {
                            str += sql[j]; j++;
                        }
                    }
                    tokens.push({ type: 'string', value: str });
                    i = j + 1;
                    continue;
                }

                // Number
                if (/[0-9]/.test(ch) || (ch === '-' && i + 1 < sql.length && /[0-9]/.test(sql[i + 1]))) {
                    var numStr = '';
                    if (ch === '-') { numStr += '-'; i++; }
                    while (i < sql.length && /[0-9.]/.test(sql[i])) {
                        numStr += sql[i]; i++;
                    }
                    tokens.push({ type: 'number', value: numStr });
                    continue;
                }

                // Keyword or identifier
                if (/[a-zA-Z_]/.test(ch)) {
                    var ident = '';
                    while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) {
                        ident += sql[i]; i++;
                    }
                    var upper = ident.toUpperCase();
                    var KW = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IS', 'NULL', 'BETWEEN', 'LIKE', 'IN', 'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT'];
                    if (KW.indexOf(upper) >= 0) {
                        tokens.push({ type: 'keyword', value: upper });
                    } else {
                        tokens.push({ type: 'ident', value: ident });
                    }
                    continue;
                }

                i++; // skip unknown
            }
            return tokens;
        }

        function parseSQL(sql) {
            var tokens = tokenize(sql);
            var pos = 0;

            function peek() { return pos < tokens.length ? tokens[pos] : null; }
            function next() { return pos < tokens.length ? tokens[pos++] : null; }
            function match(type, value) {
                var t = peek();
                if (t && t.type === type && (!value || t.value === value)) { pos++; return t; }
                return null;
            }

            var result = { selectedColumns: [], rootConnector: 'AND', items: [], orderByField: '', orderByDir: 'ASC', limit: 0 };

            // Parse SELECT columns
            if (match('keyword', 'SELECT')) {
                if (peek() && peek().type === 'star') {
                    next(); // consume * — selectedColumns stays empty = all
                } else {
                    while (pos < tokens.length) {
                        var ct = peek();
                        if (!ct || (ct.type === 'keyword' && ct.value === 'FROM')) break;
                        if (ct.type === 'ident') {
                            result.selectedColumns.push(next().value);
                        } else {
                            next(); // skip commas, etc.
                        }
                    }
                }
            }

            // Skip FROM table_name to WHERE/ORDER/LIMIT
            while (pos < tokens.length) {
                var t = peek();
                if (t.type === 'keyword' && (t.value === 'WHERE' || t.value === 'ORDER' || t.value === 'LIMIT')) break;
                next();
            }

            // Parse WHERE clause
            if (match('keyword', 'WHERE')) {
                var parsed = parseOrExpr();
                result.rootConnector = parsed.connector;
                result.items = parsed.items;
            }

            // Parse ORDER BY
            if (match('keyword', 'ORDER')) {
                match('keyword', 'BY');
                var fieldTok = next();
                if (fieldTok && fieldTok.type === 'ident') {
                    result.orderByField = fieldTok.value;
                }
                var dirTok = match('keyword', 'ASC') || match('keyword', 'DESC');
                if (dirTok) result.orderByDir = dirTok.value;
            }

            // Parse LIMIT
            if (match('keyword', 'LIMIT')) {
                var numTok = next();
                if (numTok && numTok.type === 'number') {
                    result.limit = parseInt(numTok.value, 10);
                }
            }

            return result;

            // --- Recursive descent with proper AND/OR precedence ---
            // OR has lower precedence than AND (standard SQL)

            function parseOrExpr() {
                var groups = [parseAndExpr()];

                while (peek() && peek().type === 'keyword' && peek().value === 'OR') {
                    next(); // consume OR
                    groups.push(parseAndExpr());
                }

                if (groups.length === 1) {
                    // Single AND-expression: flatten its items at root
                    return { connector: 'AND', items: groups[0] };
                }

                // Multiple OR-connected AND-groups
                var items = [];
                for (var g = 0; g < groups.length; g++) {
                    if (groups[g].length === 1) {
                        items.push(groups[g][0]);
                    } else {
                        items.push({ id: _nextId++, type: 'group', connector: 'AND', conditions: groups[g] });
                    }
                }
                return { connector: 'OR', items: items };
            }

            function parseAndExpr() {
                // Returns an array of terms connected by AND
                var terms = [parseTerm()];

                while (peek() && peek().type === 'keyword' && peek().value === 'AND') {
                    next(); // consume AND
                    terms.push(parseTerm());
                }

                return terms;
            }

            function parseTerm() {
                // Parenthesized sub-expression or single condition
                if (peek() && peek().type === 'lparen') {
                    next(); // consume (
                    var inner = parseOrExpr();
                    match('rparen');
                    return { id: _nextId++, type: 'group', connector: inner.connector, conditions: inner.items };
                }
                return parseCondition();
            }

            function parseCondition() {
                var cond = { id: _nextId++, type: 'condition', field: '', operator: '=', value: '', value2: '', values: [] };

                var fieldTok = next();
                if (!fieldTok) return cond;
                cond.field = fieldTok.value;
                var fieldDef = getFieldDef(cond.field);

                // IS [NOT] NULL
                if (peek() && peek().type === 'keyword' && peek().value === 'IS') {
                    next();
                    if (match('keyword', 'NOT')) {
                        match('keyword', 'NULL');
                        cond.operator = 'IS NOT NULL';
                    } else {
                        match('keyword', 'NULL');
                        cond.operator = 'IS NULL';
                    }
                    return cond;
                }

                // NOT IN (...) or NOT LIKE
                if (peek() && peek().type === 'keyword' && peek().value === 'NOT') {
                    next();
                    if (match('keyword', 'IN')) {
                        cond.operator = 'NOT IN';
                        cond.values = parseInList();
                        return cond;
                    }
                    match('keyword', 'LIKE');
                    cond.operator = 'NOT LIKE';
                    var v = next();
                    cond.value = v ? stripWildcards(v.value) : '';
                    return cond;
                }

                // IN (...)
                if (match('keyword', 'IN')) {
                    cond.operator = 'IN';
                    cond.values = parseInList();
                    return cond;
                }

                // LIKE
                if (match('keyword', 'LIKE')) {
                    cond.operator = 'LIKE';
                    var lv = next();
                    cond.value = lv ? stripWildcards(lv.value) : '';
                    return cond;
                }

                // BETWEEN val1 AND val2
                if (match('keyword', 'BETWEEN')) {
                    cond.operator = 'BETWEEN';
                    cond.value = parsedToBuilderValue(fieldDef, next());
                    match('keyword', 'AND');
                    cond.value2 = parsedToBuilderValue(fieldDef, next());
                    return cond;
                }

                // Standard comparison operator
                var opTok = next();
                if (opTok && opTok.type === 'op') {
                    cond.operator = opTok.value;
                }
                cond.value = parsedToBuilderValue(fieldDef, next());
                return cond;
            }

            function parseInList() {
                var values = [];
                match('lparen');
                while (pos < tokens.length) {
                    var t = peek();
                    if (!t || t.type === 'rparen') break;
                    if (t.type === 'comma') { next(); continue; }
                    var valTok = next();
                    if (valTok && (valTok.type === 'string' || valTok.type === 'number' || valTok.type === 'ident')) {
                        values.push(String(valTok.value));
                    }
                }
                match('rparen');
                return values;
            }

            function stripWildcards(val) {
                if (!val) return '';
                if (val.charAt(0) === '%') val = val.substring(1);
                if (val.length > 0 && val.charAt(val.length - 1) === '%') val = val.substring(0, val.length - 1);
                return val;
            }

            function parsedToBuilderValue(fieldDef, token) {
                if (!token) return '';
                var val = token.value !== undefined ? String(token.value) : '';
                // Convert tick numbers back to HH:MM:SS.fff
                if (fieldDef.type === 'ticks' && token.type === 'number') {
                    var ticks = parseInt(val, 10);
                    if (ticks > 0) return helpers.ticksToTime(ticks);
                }
                return val;
            }
        }

        function importSQL() {
            var sql = view.querySelector('#sqlInput').value.trim();
            if (!sql) return false;

            try {
                var parsed = parseSQL(sql);
                builderState.rootConnector = parsed.rootConnector || 'AND';
                builderState.items = parsed.items || [];
                builderState.orderByField = parsed.orderByField || '';
                builderState.orderByDir = parsed.orderByDir || 'ASC';
                builderState.limit = parsed.limit || 0;

                // Set selected columns and order (empty from parser means SELECT * = all)
                if (parsed.selectedColumns && parsed.selectedColumns.length > 0) {
                    var validCols = parsed.selectedColumns.filter(function (col) {
                        for (var i = 0; i < BUILDER_FIELDS.length; i++) {
                            if (BUILDER_FIELDS[i].name === col) return true;
                        }
                        return false;
                    });
                    if (validCols.length > 0) {
                        builderState.selectedColumns = validCols.slice();
                        // Selected columns first (in SQL order), then remaining in default order
                        var remaining = BUILDER_FIELDS.map(function (f) { return f.name; }).filter(function (n) {
                            return validCols.indexOf(n) < 0;
                        });
                        builderState.columnOrder = validCols.concat(remaining);
                    } else {
                        builderState.selectedColumns = BUILDER_FIELDS.map(function (f) { return f.name; });
                        builderState.columnOrder = BUILDER_FIELDS.map(function (f) { return f.name; });
                    }
                } else {
                    builderState.selectedColumns = BUILDER_FIELDS.map(function (f) { return f.name; });
                    builderState.columnOrder = BUILDER_FIELDS.map(function (f) { return f.name; });
                }

                if (builderState.items.length === 0) {
                    builderState.items.push(mkCondition());
                }

                renderBuilder();
                return true;
            } catch (e) {
                console.error('SQL parse error:', e);
                return false;
            }
        }

        // ===== QUERY BUILDER: SQL Generation =====

        function fmtValue(fieldDef, op, val) {
            if (!val && val !== '0' && val !== 0) return "''";

            switch (fieldDef.type) {
                case 'text':
                case 'autocomplete':
                    if (op === 'LIKE' || op === 'NOT LIKE') {
                        return "'%" + String(val).replace(/'/g, "''") + "%'";
                    }
                    return "'" + String(val).replace(/'/g, "''") + "'";
                case 'integer':
                    return String(parseInt(val, 10) || 0);
                case 'ticks':
                    return String(helpers.timeToTicks(val));
                case 'boolean':
                    return val === '1' ? '1' : '0';
                default:
                    return "'" + String(val).replace(/'/g, "''") + "'";
            }
        }

        function fmtCondition(cond) {
            var fieldDef = getFieldDef(cond.field);
            var op = cond.operator;

            if (op === 'IS NULL') return cond.field + ' IS NULL';
            if (op === 'IS NOT NULL') return cond.field + ' IS NOT NULL';

            if (op === 'IN' || op === 'NOT IN') {
                var vals = (cond.values || []).map(function (v) {
                    return "'" + String(v).replace(/'/g, "''") + "'";
                });
                if (vals.length === 0) return '1=1';
                return cond.field + ' ' + op + ' (' + vals.join(', ') + ')';
            }

            var val = fmtValue(fieldDef, op, cond.value);

            if (op === 'BETWEEN') {
                var val2 = fmtValue(fieldDef, op, cond.value2);
                return cond.field + ' BETWEEN ' + val + ' AND ' + val2;
            }

            return cond.field + ' ' + op + ' ' + val;
        }

        function buildWhere(items, connector) {
            var parts = [];
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (item.type === 'condition' && item.field) {
                    parts.push(fmtCondition(item));
                } else if (item.type === 'group' && item.conditions.length > 0) {
                    var sub = buildWhere(item.conditions, item.connector);
                    if (sub) parts.push('(' + sub + ')');
                }
            }
            return parts.join(' ' + connector + ' ');
        }

        function buildSQL() {
            // Build column list respecting user's drag order
            var orderedSelected = builderState.columnOrder.filter(function (name) {
                return builderState.selectedColumns.indexOf(name) >= 0;
            });
            var allInDefaultOrder = orderedSelected.length === BUILDER_FIELDS.length &&
                BUILDER_FIELDS.every(function (f, i) { return f.name === orderedSelected[i]; });

            // Auto-include ItemId when any tick column is selected (enables edit/delete buttons)
            var hasTickCol = false;
            for (var i = 0; i < orderedSelected.length; i++) {
                if (TICK_COLUMNS.indexOf(orderedSelected[i]) >= 0) { hasTickCol = true; break; }
            }
            if (hasTickCol && orderedSelected.indexOf('ItemId') < 0) {
                orderedSelected.unshift('ItemId');
            }

            var colList;
            if (orderedSelected.length === 0 || allInDefaultOrder) {
                colList = '*';
            } else {
                colList = orderedSelected.join(', ');
            }
            var sql = 'SELECT ' + colList + ' FROM MediaSegments';

            var where = buildWhere(builderState.items, builderState.rootConnector);
            if (where) sql += '\nWHERE ' + where;

            if (builderState.orderByField) {
                sql += '\nORDER BY ' + builderState.orderByField + ' ' + builderState.orderByDir;
            }

            if (builderState.limit > 0) {
                sql += '\nLIMIT ' + builderState.limit;
            }

            return sql;
        }

        // ===== QUERY BUILDER: Live Sync =====

        function syncToSQL() {
            if (!builderVisible) return;
            var sqlInput = view.querySelector('#sqlInput');
            if (sqlInput) {
                sqlInput.value = buildSQL();
            }
        }

        // ===== QUERY BUILDER: Event Handling =====

        function onBuilderClick(e) {
            var rawTarget = e.target;

            // Handle autocomplete dropdown item clicks before data-action walk-up
            var acItem = rawTarget.closest ? rawTarget.closest('.sr-ac-item') : null;
            if (acItem) {
                var acVal = acItem.getAttribute('data-value');
                var acCondId = parseInt(acItem.getAttribute('data-id'), 10);
                var acCond = findInItems(builderState.items, acCondId);
                if (acCond && acVal !== null) {
                    var container = acItem.closest('.sr-pill-container');
                    if (container) {
                        if (!acCond.values) acCond.values = [];
                        if (acCond.values.indexOf(acVal) < 0) {
                            acCond.values.push(acVal);
                        }
                        renderBuilder();
                        syncToSQL();
                        setTimeout(function () {
                            var newInput = view.querySelector('.sr-pill-input[data-id="' + acCondId + '"]');
                            if (newInput) newInput.focus();
                        }, 0);
                    } else {
                        acCond.value = acVal;
                        var acInput = view.querySelector('.sr-ac-input[data-id="' + acCondId + '"]');
                        if (acInput) acInput.value = acVal;
                        closeAllDropdowns();
                        syncToSQL();
                    }
                }
                return;
            }

            // Handle chip remove clicks
            var chipX = rawTarget.closest ? rawTarget.closest('.sr-chip-x') : null;
            if (chipX) {
                var chipCondId = parseInt(chipX.getAttribute('data-id'), 10);
                var chipIdx = parseInt(chipX.getAttribute('data-idx'), 10);
                var chipCond = findInItems(builderState.items, chipCondId);
                if (chipCond && chipCond.values && chipIdx >= 0 && chipIdx < chipCond.values.length) {
                    chipCond.values.splice(chipIdx, 1);
                    renderBuilder();
                    syncToSQL();
                }
                return;
            }

            var target = rawTarget;
            // Walk up to find the element with data-action (handle clicks on button text)
            while (target && target !== e.currentTarget && !target.getAttribute('data-action')) {
                target = target.parentElement;
            }
            if (!target || !target.getAttribute('data-action')) return;

            var action = target.getAttribute('data-action');
            var id = parseInt(target.getAttribute('data-id'), 10);
            var parentId = target.getAttribute('data-parent');

            switch (action) {
                case 'add-condition':
                    if (parentId && parentId !== '') {
                        var group = findInItems(builderState.items, parseInt(parentId, 10));
                        if (group && group.type === 'group') {
                            group.conditions.push(mkCondition());
                        }
                    } else {
                        builderState.items.push(mkCondition());
                    }
                    renderBuilder();
                    break;

                case 'add-group':
                    if (parentId && parentId !== '') {
                        var parentGroup = findInItems(builderState.items, parseInt(parentId, 10));
                        if (parentGroup && parentGroup.type === 'group') {
                            parentGroup.conditions.push(mkGroup());
                        }
                    } else {
                        builderState.items.push(mkGroup());
                    }
                    renderBuilder();
                    break;

                case 'remove':
                    removeFromItems(builderState.items, id);
                    renderBuilder();
                    break;

                case 'column-pill':
                    if (_wasDragging) break; // Don't toggle after a drag
                    var pillCol = target.getAttribute('data-col');
                    var pillIdx = builderState.selectedColumns.indexOf(pillCol);
                    if (pillIdx >= 0) {
                        builderState.selectedColumns.splice(pillIdx, 1);
                    } else {
                        builderState.selectedColumns.push(pillCol);
                    }
                    renderBuilder();
                    break;

                case 'select-all-cols':
                    builderState.selectedColumns = BUILDER_FIELDS.map(function (f) { return f.name; });
                    renderBuilder();
                    break;

                case 'select-none-cols':
                    builderState.selectedColumns = [];
                    renderBuilder();
                    break;
            }
        }

        function onBuilderChange(e) {
            var target = e.target;

            // Skip autocomplete inputs — handled by onAcInput
            if (target.classList && (target.classList.contains('sr-pill-input') || target.classList.contains('sr-ac-input'))) return;

            var action = target.getAttribute('data-action');
            var fieldAttr = target.getAttribute('data-field');
            var id = parseInt(target.getAttribute('data-id'), 10);

            // Root connector
            if (action === 'root-connector') {
                builderState.rootConnector = target.value;
                syncToSQL();
                return;
            }

            // Group connector
            if (action === 'group-connector') {
                var group = findInItems(builderState.items, id);
                if (group) group.connector = target.value;
                syncToSQL();
                return;
            }

            // Order by
            if (action === 'order-field') {
                builderState.orderByField = target.value;
                syncToSQL();
                return;
            }
            if (action === 'order-dir') {
                builderState.orderByDir = target.value;
                syncToSQL();
                return;
            }

            // Limit
            if (action === 'limit') {
                builderState.limit = parseInt(target.value, 10) || 0;
                syncToSQL();
                return;
            }

            // Condition field/operator/value changes
            if (fieldAttr && id) {
                var cond = findInItems(builderState.items, id);
                if (!cond) return;

                if (fieldAttr === 'field') {
                    var oldType = getFieldDef(cond.field).type;
                    cond.field = target.value;
                    var newType = getFieldDef(cond.field).type;

                    // Reset operator if type changed and current op is invalid
                    if (oldType !== newType) {
                        var newOps = getOpsForType(newType);
                        var opValid = false;
                        for (var i = 0; i < newOps.length; i++) {
                            if (newOps[i].v === cond.operator) { opValid = true; break; }
                        }
                        if (!opValid) cond.operator = newOps[0].v;
                        cond.value = '';
                        cond.value2 = '';
                        cond.values = [];
                    }
                    renderBuilder();
                } else if (fieldAttr === 'operator') {
                    cond.operator = target.value;
                    if (cond.operator === 'IS NULL' || cond.operator === 'IS NOT NULL') {
                        cond.value = '';
                        cond.value2 = '';
                        cond.values = [];
                    }
                    renderBuilder();
                } else if (fieldAttr === 'value') {
                    cond.value = target.value;
                    syncToSQL();
                } else if (fieldAttr === 'value2') {
                    cond.value2 = target.value;
                    syncToSQL();
                }
            }
        }

        // ===== AUTOCOMPLETE: Event Handlers =====

        function closeAllDropdowns() {
            var dds = view.querySelectorAll('.sr-ac-dropdown');
            for (var i = 0; i < dds.length; i++) {
                dds[i].style.display = 'none';
                dds[i].innerHTML = '';
            }
            _acDropdownIdx = -1;
        }

        var _dropdownBg = null;

        function detectDropdownBg() {
            if (_dropdownBg) return _dropdownBg;
            _dropdownBg = helpers.detectDropdownBg(view);
            return _dropdownBg;
        }

        function showDropdown(dropdown, suggestions, condId) {
            dropdown.style.backgroundColor = detectDropdownBg();

            if (suggestions.length === 0) {
                dropdown.innerHTML = '<div class="sr-ac-empty">No matches</div>';
                dropdown.style.display = 'block';
                _acDropdownIdx = -1;
                return;
            }
            var html = '';
            for (var i = 0; i < suggestions.length && i < 50; i++) {
                html += '<div class="sr-ac-item" data-value="' + escHtml(suggestions[i]) + '" data-id="' + condId + '">' + escHtml(suggestions[i]) + '</div>';
            }
            if (suggestions.length > 50) {
                html += '<div class="sr-ac-empty">... ' + (suggestions.length - 50) + ' more (keep typing)</div>';
            }
            dropdown.innerHTML = html;
            dropdown.style.display = 'block';
            _acDropdownIdx = -1;
        }

        function highlightDropdownItem(dropdown, idx) {
            var items = dropdown.querySelectorAll('.sr-ac-item');
            for (var i = 0; i < items.length; i++) {
                items[i].classList.remove('sr-ac-active');
            }
            if (idx >= 0 && idx < items.length) {
                items[idx].classList.add('sr-ac-active');
                items[idx].scrollIntoView({ block: 'nearest' });
            }
        }

        function onAcFocusIn(e) {
            var target = e.target;
            if (!target.classList) return;

            var fieldName = target.getAttribute('data-field-name');
            var condId = parseInt(target.getAttribute('data-id'), 10);
            if (!fieldName || !condId) return;

            if (target.classList.contains('sr-pill-input') || target.classList.contains('sr-ac-input')) {
                fetchAutocompleteValues(fieldName, function (allValues) {
                    var query = target.value || '';
                    var cond = findInItems(builderState.items, condId);
                    var exclude = (cond && cond.values) ? cond.values : [];
                    var suggestions = filterSuggestions(allValues, query, target.classList.contains('sr-pill-input') ? exclude : []);
                    var dropdown = target.parentElement.querySelector('.sr-ac-dropdown');
                    if (dropdown) showDropdown(dropdown, suggestions, condId);
                });
            }
        }

        var _acDebounceTimer = null;

        function onAcInput(e) {
            var target = e.target;
            if (!target.classList) return;

            if (target.classList.contains('sr-ac-input')) {
                // Single-value: update condition value live
                var condId = parseInt(target.getAttribute('data-id'), 10);
                var cond = findInItems(builderState.items, condId);
                if (cond) {
                    cond.value = target.value;
                    syncToSQL();
                }
            }

            if (target.classList.contains('sr-pill-input') || target.classList.contains('sr-ac-input')) {
                var fieldName = target.getAttribute('data-field-name');
                var acCondId = parseInt(target.getAttribute('data-id'), 10);
                if (!fieldName) return;

                clearTimeout(_acDebounceTimer);
                _acDebounceTimer = setTimeout(function () {
                    fetchAutocompleteValues(fieldName, function (allValues) {
                        var query = target.value || '';
                        var cond2 = findInItems(builderState.items, acCondId);
                        var exclude = (cond2 && cond2.values) ? cond2.values : [];
                        var suggestions = filterSuggestions(allValues, query, target.classList.contains('sr-pill-input') ? exclude : []);
                        var dropdown = target.parentElement.querySelector('.sr-ac-dropdown');
                        if (dropdown) showDropdown(dropdown, suggestions, acCondId);
                    });
                }, 150);
            }
        }

        function onAcKeydown(e) {
            var target = e.target;
            if (!target.classList) return;
            if (!target.classList.contains('sr-pill-input') && !target.classList.contains('sr-ac-input')) return;

            var dropdown = target.parentElement.querySelector('.sr-ac-dropdown');
            var items = dropdown ? dropdown.querySelectorAll('.sr-ac-item') : [];
            var condId = parseInt(target.getAttribute('data-id'), 10);

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    if (items.length > 0) {
                        _acDropdownIdx = Math.min(_acDropdownIdx + 1, items.length - 1);
                        highlightDropdownItem(dropdown, _acDropdownIdx);
                    }
                    break;

                case 'ArrowUp':
                    e.preventDefault();
                    if (items.length > 0) {
                        _acDropdownIdx = Math.max(_acDropdownIdx - 1, 0);
                        highlightDropdownItem(dropdown, _acDropdownIdx);
                    }
                    break;

                case 'Enter':
                    e.preventDefault();
                    var selectedVal = '';
                    if (_acDropdownIdx >= 0 && _acDropdownIdx < items.length) {
                        selectedVal = items[_acDropdownIdx].getAttribute('data-value');
                    } else if (target.value.trim()) {
                        selectedVal = target.value.trim();
                    }

                    if (selectedVal) {
                        var cond = findInItems(builderState.items, condId);
                        if (target.classList.contains('sr-pill-input') && cond) {
                            // Multi-value: add pill
                            if (!cond.values) cond.values = [];
                            if (cond.values.indexOf(selectedVal) < 0) {
                                cond.values.push(selectedVal);
                            }
                            renderBuilder();
                            syncToSQL();
                            setTimeout(function () {
                                var newInput = view.querySelector('.sr-pill-input[data-id="' + condId + '"]');
                                if (newInput) newInput.focus();
                            }, 0);
                        } else if (target.classList.contains('sr-ac-input') && cond) {
                            // Single-value: set and close
                            cond.value = selectedVal;
                            target.value = selectedVal;
                            closeAllDropdowns();
                            syncToSQL();
                        }
                    }
                    break;

                case 'Backspace':
                    if (target.value === '' && target.classList.contains('sr-pill-input')) {
                        var bsCond = findInItems(builderState.items, condId);
                        if (bsCond && bsCond.values && bsCond.values.length > 0) {
                            bsCond.values.pop();
                            renderBuilder();
                            syncToSQL();
                            setTimeout(function () {
                                var newInput = view.querySelector('.sr-pill-input[data-id="' + condId + '"]');
                                if (newInput) newInput.focus();
                            }, 0);
                        }
                    }
                    break;

                case 'Escape':
                    closeAllDropdowns();
                    break;
            }
        }

        function toggleBuilder() {
            var panel = view.querySelector('#queryBuilderPanel');
            var btn = view.querySelector('#btnToggleBuilder');
            if (!panel || !btn) return;

            builderVisible = !builderVisible;

            if (builderVisible) {
                // Try to import existing SQL, otherwise start with one empty condition
                var existingSQL = view.querySelector('#sqlInput').value.trim();
                if (existingSQL) {
                    importSQL();
                } else if (builderState.items.length === 0) {
                    builderState.items.push(mkCondition());
                }
                renderBuilder();
                panel.style.display = 'block';
                btn.querySelector('span').textContent = 'Hide Builder';
            } else {
                panel.style.display = 'none';
                btn.querySelector('span').textContent = 'Build Query';
            }
        }

        // ===== COLUMN DRAG (pointer-event-based, avoids Emby's dragDropTouch polyfill) =====

        var _draggedCol = null;
        var _draggedPill = null;
        var _wasDragging = false;
        var _dragStartX = 0;
        var _dragStartY = 0;
        var DRAG_THRESHOLD = 5; // px of movement before we commit to a drag

        function findPillFromPoint(x, y) {
            var el = document.elementFromPoint(x, y);
            if (!el) return null;
            if (el.nodeType === 3) el = el.parentElement;
            while (el && el.getAttribute && el.getAttribute('data-action') !== 'column-pill') {
                el = el.parentElement;
            }
            return (el && el.getAttribute) ? el : null;
        }

        function onPillPointerDown(e) {
            var el = e.target;
            if (el.nodeType === 3) el = el.parentElement;
            while (el && el.getAttribute && el.getAttribute('data-action') !== 'column-pill') {
                el = el.parentElement;
            }
            if (!el || !el.getAttribute) return;

            _dragStartX = e.clientX;
            _dragStartY = e.clientY;
            _draggedPill = el;
            _draggedCol = null; // not committed yet — wait for threshold
            _wasDragging = false;

            document.addEventListener('pointermove', onPillPointerMove);
            document.addEventListener('pointerup', onPillPointerUp);
        }

        function onPillPointerMove(e) {
            if (!_draggedPill) return;

            // Check threshold before committing to drag
            if (!_draggedCol) {
                var dx = e.clientX - _dragStartX;
                var dy = e.clientY - _dragStartY;
                if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
                // Commit to drag
                _draggedCol = _draggedPill.getAttribute('data-col');
                _wasDragging = true;
                _draggedPill.style.opacity = '0.4';
            }

            e.preventDefault();

            // Clear all indicators
            var allPills = view.querySelectorAll('[data-action="column-pill"]');
            for (var i = 0; i < allPills.length; i++) {
                allPills[i].style.boxShadow = '';
            }

            // Show drop indicator on target pill
            var pill = findPillFromPoint(e.clientX, e.clientY);
            if (!pill || pill.getAttribute('data-col') === _draggedCol) return;

            if (!_accentHex) _accentHex = helpers.detectAccentColor(view) || '#52b54b';
            var rect = pill.getBoundingClientRect();
            var midX = rect.left + rect.width / 2;
            if (e.clientX < midX) {
                pill.style.boxShadow = '-3px 0 0 0 ' + _accentHex;
            } else {
                pill.style.boxShadow = '3px 0 0 0 ' + _accentHex;
            }
        }

        function onPillPointerUp(e) {
            document.removeEventListener('pointermove', onPillPointerMove);
            document.removeEventListener('pointerup', onPillPointerUp);

            if (!_draggedCol) {
                // Threshold was never crossed — let the click handler toggle the pill
                _draggedPill = null;
                return;
            }

            // Find drop target
            var pill = findPillFromPoint(e.clientX, e.clientY);
            if (pill) {
                var targetCol = pill.getAttribute('data-col');
                if (targetCol && targetCol !== _draggedCol) {
                    var rect = pill.getBoundingClientRect();
                    var midX = rect.left + rect.width / 2;
                    var insertBefore = e.clientX < midX;

                    var order = builderState.columnOrder;
                    var fromIdx = order.indexOf(_draggedCol);
                    if (fromIdx >= 0) {
                        order.splice(fromIdx, 1);
                        var toIdx = order.indexOf(targetCol);
                        if (!insertBefore) toIdx++;
                        order.splice(toIdx, 0, _draggedCol);
                    }
                }
            }

            // Reset visual state
            var allPills = view.querySelectorAll('[data-action="column-pill"]');
            for (var i = 0; i < allPills.length; i++) {
                allPills[i].style.boxShadow = '';
                allPills[i].style.opacity = '';
            }

            _draggedCol = null;
            _draggedPill = null;
            renderBuilder();

            // Clear _wasDragging after a brief delay so the click handler sees it
            setTimeout(function () { _wasDragging = false; }, 100);
        }

        // ===== QUERIES: Unified Dropdown (Built-in + Saved) =====

        var builtInQueries = [];
        var savedQueries = [];

        function rebuildDropdown() {
            var dropdown = view.querySelector('#queriesDropdown');
            if (!dropdown) return;

            // Clear all but the first placeholder option
            while (dropdown.options.length > 1) {
                dropdown.remove(1);
            }

            // Built-in queries
            if (builtInQueries.length > 0) {
                var builtInGroup = document.createElement('optgroup');
                builtInGroup.label = 'Built-in Queries';
                builtInQueries.forEach(function (q) {
                    var opt = document.createElement('option');
                    opt.value = q.sql || '';
                    opt.textContent = q.name || 'Unnamed Query';
                    opt.setAttribute('data-builtin', 'true');
                    builtInGroup.appendChild(opt);
                });
                dropdown.appendChild(builtInGroup);
            }

            // Saved queries (from database)
            if (savedQueries.length > 0) {
                var savedGroup = document.createElement('optgroup');
                savedGroup.label = 'My Saved Queries';
                savedQueries.forEach(function (q) {
                    var opt = document.createElement('option');
                    opt.value = q.sql || '';
                    opt.textContent = q.name || 'Unnamed Query';
                    opt.setAttribute('data-saved-id', String(q.id));
                    savedGroup.appendChild(opt);
                });
                dropdown.appendChild(savedGroup);
            }
        }

        function loadQueries() {
            // Load built-in and saved queries in parallel
            var builtInPromise = helpers.apiCall('canned_queries', 'GET').catch(function () { return []; });
            var savedPromise = helpers.apiCall('saved_queries', 'GET').catch(function () { return []; });

            Promise.all([builtInPromise, savedPromise]).then(function (results) {
                builtInQueries = (results[0] && Array.isArray(results[0])) ? results[0] : [];
                savedQueries = (results[1] && Array.isArray(results[1])) ? results[1] : [];
                rebuildDropdown();
            });
        }

        function handleQuerySelect(event) {
            var dropdown = event.target;
            var selectedSql = dropdown.value;
            var selectedOption = dropdown.options[dropdown.selectedIndex];

            // Show/hide delete button (only for saved queries)
            var btnDelete = view.querySelector('#btnDeleteQuery');
            if (btnDelete) {
                var isSaved = selectedOption && selectedOption.hasAttribute('data-saved-id');
                btnDelete.style.display = isSaved ? 'inline-block' : 'none';
            }

            if (selectedSql) {
                view.querySelector('#sqlInput').value = selectedSql;
                if (builderVisible) {
                    importSQL();
                    renderBuilder();
                }
            }
        }

        function saveCurrentQuery() {
            var sql = view.querySelector('#sqlInput').value.trim();
            if (!sql) {
                helpers.showError('No query to save. Enter or build a query first.');
                return;
            }

            // Prompt for name
            var name = prompt('Enter a name for this query:');
            if (!name || !name.trim()) return;
            name = name.trim();

            // Check for duplicate name among saved queries
            var existingQuery = null;
            for (var i = 0; i < savedQueries.length; i++) {
                if (savedQueries[i].name === name) { existingQuery = savedQueries[i]; break; }
            }

            if (existingQuery) {
                if (!confirm('A saved query named "' + name + '" already exists. Overwrite it?')) return;
            }

            var payload = JSON.stringify({ name: name, sql: sql, id: existingQuery ? existingQuery.id : null });
            helpers.apiCall('saved_queries', 'POST', payload)
                .then(function () {
                    loadQueries();
                })
                .catch(function (error) {
                    console.error('Failed to save query:', error);
                    helpers.showError('Failed to save query.');
                });
        }

        function deleteSelectedQuery() {
            var dropdown = view.querySelector('#queriesDropdown');
            var selectedOption = dropdown.options[dropdown.selectedIndex];
            if (!selectedOption || !selectedOption.hasAttribute('data-saved-id')) return;

            var queryId = selectedOption.getAttribute('data-saved-id');
            var name = selectedOption.textContent;
            if (!confirm('Delete saved query "' + name + '"?')) return;

            helpers.apiCall('saved_queries/' + queryId, 'DELETE')
                .then(function () {
                    dropdown.selectedIndex = 0;
                    view.querySelector('#btnDeleteQuery').style.display = 'none';
                    loadQueries();
                })
                .catch(function (error) {
                    console.error('Failed to delete query:', error);
                    helpers.showError('Failed to delete query.');
                });
        }

        // ===== EXISTING: Query Execution =====

        /**
         * Auto-inject ItemId into SELECT queries on MediaSegments so that
         * delete/edit actions are always available, even when the user doesn't
         * explicitly include it in their column list.
         */
        function ensureItemIdInQuery(sql) {
            var match = sql.match(/^(\s*SELECT\s+)([\s\S]*?)(\s+FROM\s+MediaSegments\b)/i);
            if (!match) return sql;

            var colList = match[2].trim();
            if (colList === '*') return sql;

            // Check if ItemId is already present
            var cols = colList.split(',');
            for (var i = 0; i < cols.length; i++) {
                if (cols[i].trim().toUpperCase() === 'ITEMID') return sql;
            }

            // Inject ItemId at the start of the column list
            return match[1] + 'ItemId, ' + colList + match[3];
        }

        /**
         * Execute the SQL query
         */
        function executeQuery() {
            var sqlInput = view.querySelector('#sqlInput');
            var query = sqlInput.value.trim();

            if (!query) {
                helpers.showError('Please enter a SQL query.');
                return;
            }

            // Auto-include ItemId for action support
            query = ensureItemIdInQuery(query);

            helpers.showLoading();
            var btnExecute = view.querySelector('#btnExecute');
            btnExecute.disabled = true;
            btnExecute.querySelector('span').textContent = 'Executing...';

            var url = ApiClient.getUrl('segment_reporting/submit_custom_query?query=' + encodeURIComponent(query));

            ApiClient.ajax({
                type: 'POST',
                url: url,
                dataType: 'json'
            })
                .then(function (response) {
                    helpers.hideLoading();
                    btnExecute.disabled = false;
                    btnExecute.querySelector('span').textContent = 'Execute Query';

                    if (response && response.error) {
                        showError(response.error);
                        return;
                    }

                    if (response && response.Columns && response.Rows) {
                        if (response.Message && response.Message.startsWith('Error:')) {
                            showError(response.Message);
                            return;
                        }

                        var results = [];
                        var columns = response.Columns;

                        // Columns whose values should be treated as numbers
                        var numericCols = {};
                        columns.forEach(function (col) {
                            if (col.endsWith('Ticks') || col === 'HasIntro' || col === 'HasCredits' ||
                                col === 'SeasonNumber' || col === 'EpisodeNumber') {
                                numericCols[col] = true;
                            }
                        });

                        response.Rows.forEach(function (row) {
                            var obj = {};
                            columns.forEach(function (col, idx) {
                                var val = row[idx];
                                if (val !== null && val !== undefined && numericCols[col]) {
                                    var num = Number(val);
                                    obj[col] = isNaN(num) ? val : num;
                                } else {
                                    obj[col] = val;
                                }
                            });
                            results.push(obj);
                        });

                        currentResults = results;
                        currentColumns = columns;

                        if (results.length > 0) {
                            displayResults(results);
                            view.querySelector('#btnExportCsv').style.display = 'inline-block';
                        } else {
                            displayNoResults();
                        }
                    } else {
                        showError('Unexpected response format from server');
                    }
                })
                .catch(function (error) {
                    console.error('Query execution failed:', error);
                    helpers.hideLoading();
                    btnExecute.disabled = false;
                    btnExecute.querySelector('span').textContent = 'Execute Query';
                    showError('Query execution failed: ' + error);
                });
        }

        // ===== INLINE EDITING =====

        function columnToMarker(colName) {
            // IntroStartTicks -> IntroStart
            return colName.replace(/Ticks$/, '');
        }

        function setActionButtonsDisabled(disabled) {
            var btns = ['#btnExecute', '#btnClear', '#btnExportCsv', '#btnToggleBuilder'];
            btns.forEach(function (sel) {
                var btn = view.querySelector(sel);
                if (btn) btn.disabled = disabled;
            });
        }

        function startRowEdit(tr) {
            if (editingRow && editingRow !== tr) {
                cancelRowEdit(editingRow);
            }

            var rowIndex = parseInt(tr.getAttribute('data-row-index'), 10);
            var rowData = currentResults[rowIndex];
            if (!rowData) return;

            editingRow = tr;
            tr.classList.add('editing');
            tr.style.backgroundColor = 'rgba(255, 235, 59, 0.1)';

            var tickCells = tr.querySelectorAll('.tick-cell');
            tickCells.forEach(function (cell) {
                var col = cell.getAttribute('data-column');
                var currentTicks = rowData[col];
                var currentDisplay = helpers.ticksToTime(currentTicks);

                cell.setAttribute('data-original-ticks', currentTicks || '');

                var input = document.createElement('input');
                input.type = 'text';
                input.value = currentTicks ? currentDisplay : '';
                input.placeholder = '00:00:00.000';
                input.style.cssText = 'width: 120px; text-align: center; font-size: inherit; font-family: inherit; color: inherit; background: transparent; border: 1px solid rgba(128,128,128,0.4); border-radius: 3px; padding: 0.1em 0.3em;';
                input.setAttribute('data-column', col);

                cell.innerHTML = '';
                cell.appendChild(input);
            });

            var actionsCell = tr.querySelector('.actions-cell');
            if (actionsCell) {
                actionsCell.innerHTML =
                    '<button class="raised emby-button btn-save" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em; background-color: #4CAF50;">Save</button>' +
                    '<button class="raised button-cancel emby-button btn-cancel" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Cancel</button>';
            }

            setActionButtonsDisabled(true);
        }

        function saveRowEdit(tr) {
            var rowIndex = parseInt(tr.getAttribute('data-row-index'), 10);
            var rowData = currentResults[rowIndex];
            if (!rowData) return;

            var inputs = tr.querySelectorAll('.tick-cell input');
            var updates = [];

            for (var i = 0; i < inputs.length; i++) {
                var input = inputs[i];
                var col = input.getAttribute('data-column');
                var cell = input.parentElement;
                var originalTicks = parseInt(cell.getAttribute('data-original-ticks'), 10) || 0;
                var newValue = input.value.trim();

                if (!newValue) {
                    // Clearing a value is a delete (handled by M4), skip here
                    continue;
                }

                var newTicks = helpers.timeToTicks(newValue);
                if (newTicks === 0 && newValue !== '00:00:00.000') {
                    helpers.showError('Invalid time format for ' + col + '. Use HH:MM:SS.fff');
                    return;
                }

                if (newTicks !== originalTicks) {
                    updates.push({ column: col, marker: columnToMarker(col), ticks: newTicks });
                }
            }

            if (updates.length === 0) {
                cancelRowEdit(tr);
                return;
            }

            helpers.showLoading();

            var chain = Promise.resolve();
            updates.forEach(function (update) {
                chain = chain.then(function () {
                    return helpers.apiCall('update_segment', 'POST', JSON.stringify({
                        ItemId: rowData['ItemId'],
                        MarkerType: update.marker,
                        Ticks: update.ticks
                    }));
                });
            });

            chain
                .then(function () {
                    helpers.hideLoading();
                    helpers.showSuccess('Segments updated successfully.');
                    // Update local data so the table reflects the new values
                    updates.forEach(function (update) {
                        rowData[update.column] = update.ticks;
                    });
                    restoreRow(tr, rowData);
                })
                .catch(function (error) {
                    helpers.hideLoading();
                    console.error('Failed to save segments:', error);
                    helpers.showError('Failed to save segment changes.');
                });
        }

        function cancelRowEdit(tr) {
            var rowIndex = parseInt(tr.getAttribute('data-row-index'), 10);
            var rowData = currentResults[rowIndex];

            tr.classList.remove('editing');
            tr.style.backgroundColor = (rowIndex % 2 === 1) ? 'rgba(128, 128, 128, 0.05)' : '';

            if (rowData) {
                restoreRow(tr, rowData);
            }
        }

        function restoreRow(tr, rowData) {
            var tickCells = tr.querySelectorAll('.tick-cell');
            tickCells.forEach(function (cell) {
                var col = cell.getAttribute('data-column');
                var ticks = rowData[col];
                if (ticks && ticks > 0 && currentCapabilities && currentCapabilities.canPlayback) {
                    cell.innerHTML = helpers.renderTimestamp(ticks, rowData['ItemId']);
                } else {
                    cell.textContent = helpers.ticksToTime(ticks);
                }
            });

            var actionsCell = tr.querySelector('.actions-cell');
            if (actionsCell) {
                actionsCell.innerHTML = '<button class="raised emby-button btn-actions" title="Episode actions" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Actions &#9660;</button>';
            }

            editingRow = null;
            setActionButtonsDisabled(false);
        }

        // ===== PER-ROW ACTIONS MENU =====

        function showActionsMenu(tr, buttonEl) {
            var existing = tr.querySelector('.actions-menu');
            if (existing) {
                existing.remove();
                return;
            }

            var rowIndex = parseInt(tr.getAttribute('data-row-index'), 10);
            var rowData = currentResults[rowIndex];
            if (!rowData) return;

            var colors = helpers.getMenuColors(view);
            var menu = helpers.createActionsMenu(colors);

            // Edit (only when tick columns are in the result set)
            if (currentCapabilities && currentCapabilities.canEdit) {
                menu.appendChild(helpers.createMenuItem('Edit', true, colors, function (e) {
                    e.stopPropagation();
                    menu.remove();
                    startRowEdit(tr);
                }));
                menu.appendChild(helpers.createMenuDivider(colors));
            }

            // ── Delete submenu ──
            var cols = currentCapabilities ? currentCapabilities.editableColumns : [];
            var hasIntroCols = cols.indexOf('IntroStartTicks') >= 0 || cols.indexOf('IntroEndTicks') >= 0;
            var hasCreditCols = cols.indexOf('CreditsStartTicks') >= 0;
            // If no tick columns in query, enable all delete options (backend handles gracefully)
            var noTickCols = cols.length === 0;

            var hasIntroData = noTickCols || (hasIntroCols && ((rowData['IntroStartTicks'] || 0) > 0 || (rowData['IntroEndTicks'] || 0) > 0));
            var hasCreditData = noTickCols || (hasCreditCols && (rowData['CreditsStartTicks'] || 0) > 0);

            menu.appendChild(helpers.createSubmenuItem('Delete', [
                { label: 'Intros', enabled: hasIntroData, onClick: function (e) { e.stopPropagation(); menu.remove(); confirmDeleteGroup(tr, rowData, 'intros'); } },
                { label: 'Credits', enabled: hasCreditData, onClick: function (e) { e.stopPropagation(); menu.remove(); confirmDeleteGroup(tr, rowData, 'credits'); } },
                { label: 'Both', enabled: hasIntroData || hasCreditData, onClick: function (e) { e.stopPropagation(); menu.remove(); confirmDeleteGroup(tr, rowData, 'both'); } }
            ], hasIntroData || hasCreditData, colors));

            // ── Other actions ──
            menu.appendChild(helpers.createMenuDivider(colors));

            menu.appendChild(helpers.createMenuItem('Set Credits to End', true, colors, function (e) {
                e.stopPropagation();
                menu.remove();
                setRowCreditsToEnd(rowData);
            }));

            if (creditsDetectorAvailable) {
                menu.appendChild(helpers.createMenuItem('Detect Credits', true, colors, function (e) {
                    e.stopPropagation();
                    menu.remove();
                    detectRowCredits(rowData);
                }));
            }

            helpers.positionMenuBelowButton(menu, buttonEl);
            helpers.attachMenuCloseHandler(menu);
        }

        function confirmDeleteGroup(tr, rowData, groupType) {
            var markers = [];
            if (groupType === 'intros' || groupType === 'both') {
                markers.push('IntroStart');
                markers.push('IntroEnd');
            }
            if (groupType === 'credits' || groupType === 'both') {
                markers.push('CreditsStart');
            }

            if (markers.length === 0) return;

            var label = groupType === 'intros' ? 'intro markers' : groupType === 'credits' ? 'credits marker' : 'all markers';
            var itemName = rowData['ItemName'] || rowData['ItemId'] || 'this item';
            var msg = 'Delete ' + label + ' from "' + itemName + '"?\n\nMarkers: ' + markers.join(', ');

            if (!confirm(msg)) return;

            helpers.showLoading();

            var promise = Promise.resolve();
            markers.forEach(function (markerType) {
                promise = promise.then(function () {
                    return helpers.apiCall('delete_segment', 'POST', JSON.stringify({
                        ItemId: rowData['ItemId'],
                        MarkerType: markerType
                    }));
                });
            });

            promise.then(function () {
                helpers.hideLoading();
                helpers.showSuccess(markers.length + ' marker(s) deleted successfully.');
                executeQuery();
            })
            .catch(function (error) {
                helpers.hideLoading();
                console.error('Failed to delete segments:', error);
                helpers.showError('Failed to delete segment(s).');
            });
        }

        function setRowCreditsToEnd(rowData) {
            var itemName = rowData['ItemName'] || rowData['ItemId'] || 'this item';
            var msg = 'Set CreditsStart to end of "' + itemName + '"?';
            if (!confirm(msg)) return;

            helpers.showLoading();

            helpers.apiCall('bulk_set_credits_end', 'POST', JSON.stringify({
                ItemIds: rowData['ItemId'],
                OffsetTicks: 0
            }))
            .then(function (result) {
                helpers.hideLoading();
                if (result.failed > 0) {
                    helpers.showError('Failed: ' + (result.errors && result.errors.length > 0 ? result.errors[0] : 'Unknown error'));
                } else {
                    helpers.showSuccess('CreditsStart set to end.');
                    executeQuery();
                }
            })
            .catch(function (error) {
                helpers.hideLoading();
                console.error('Set credits to end failed:', error);
                helpers.showError('Failed to set credits to end.');
            });
        }

        function detectRowCredits(rowData) {
            helpers.showLoading();

            helpers.creditsDetectorCall('ProcessEpisode', { ItemId: rowData['ItemId'] })
            .then(function () {
                helpers.hideLoading();
                var itemName = rowData['ItemName'] || rowData['ItemId'] || 'this item';
                helpers.showSuccess('Credits detection queued for "' + itemName + '". Results will appear after the next sync.');
            })
            .catch(function (error) {
                helpers.hideLoading();
                console.error('Credits detection failed:', error);
                helpers.showError('Credits detection failed.');
            });
        }

        // ===== BULK ACTIONS =====

        function getSelectedCount() {
            return Object.keys(selectedRows).length;
        }

        function getTargetRows() {
            return currentResults.filter(function (row, idx) {
                return selectedRows[idx];
            });
        }

        function updateBulkActionBar(hasCheckboxes) {
            var bar = view.querySelector('#bulkActionBar');
            if (!bar) return;

            if (!hasCheckboxes || !currentCapabilities || !currentCapabilities.canDelete) {
                bar.style.display = 'none';
                return;
            }

            bar.style.display = 'flex';

            var info = view.querySelector('#bulkSelectionInfo');
            var count = getSelectedCount();
            info.textContent = count > 0
                ? count + ' of ' + currentResults.length + ' selected'
                : 'Select rows for bulk actions';

            var btnContainer = view.querySelector('#bulkActionButtons');
            btnContainer.innerHTML = '';

            // When tick columns are in the result set, we know which marker types are present.
            // When they aren't, offer both intro and credits options.
            var hasTickCols = currentCapabilities.editableColumns.length > 0;
            var hasIntro = !hasTickCols ||
                           currentCapabilities.editableColumns.indexOf('IntroStartTicks') >= 0 ||
                           currentCapabilities.editableColumns.indexOf('IntroEndTicks') >= 0;
            var hasCredits = !hasTickCols ||
                             currentCapabilities.editableColumns.indexOf('CreditsStartTicks') >= 0;

            if (hasIntro) {
                var btnDeleteIntro = document.createElement('button');
                btnDeleteIntro.className = 'raised emby-button btn-bulk-delete-intro';
                btnDeleteIntro.style.cssText = 'padding: 0.3em 0.8em; font-size: 0.85em;';
                btnDeleteIntro.textContent = 'Delete Intros (' + count + ')';
                btnDeleteIntro.disabled = count === 0;
                if (count === 0) btnDeleteIntro.style.opacity = '0.5';
                btnDeleteIntro.addEventListener('click', function () {
                    executeBulkDelete(['IntroStart', 'IntroEnd']);
                });
                btnContainer.appendChild(btnDeleteIntro);
            }

            if (hasCredits) {
                var btnDeleteCredits = document.createElement('button');
                btnDeleteCredits.className = 'raised emby-button btn-bulk-delete-credits';
                btnDeleteCredits.style.cssText = 'padding: 0.3em 0.8em; font-size: 0.85em;';
                btnDeleteCredits.textContent = 'Delete Credits (' + count + ')';
                btnDeleteCredits.disabled = count === 0;
                if (count === 0) btnDeleteCredits.style.opacity = '0.5';
                btnDeleteCredits.addEventListener('click', function () {
                    executeBulkDelete(['CreditsStart']);
                });
                btnContainer.appendChild(btnDeleteCredits);
            }

            if (creditsDetectorAvailable) {
                var btnDetectCredits = document.createElement('button');
                btnDetectCredits.className = 'raised emby-button btn-bulk-detect-credits';
                btnDetectCredits.style.cssText = 'padding: 0.3em 0.8em; font-size: 0.85em;';
                btnDetectCredits.textContent = 'Detect Credits (' + count + ')';
                btnDetectCredits.disabled = count === 0;
                if (count === 0) btnDetectCredits.style.opacity = '0.5';
                btnDetectCredits.addEventListener('click', function () {
                    executeBulkDetectCredits();
                });
                btnContainer.appendChild(btnDetectCredits);
            }
        }

        function executeBulkDelete(markerTypes) {
            var targetRows = getTargetRows();

            if (targetRows.length === 0) {
                helpers.showError('No rows to delete from.');
                return;
            }

            // Deduplicate by ItemId
            var seen = {};
            var uniqueItemIds = [];
            targetRows.forEach(function (row) {
                var id = row['ItemId'];
                if (id && !seen[id]) {
                    seen[id] = true;
                    uniqueItemIds.push(id);
                }
            });

            helpers.bulkDelete(uniqueItemIds, markerTypes).then(function (result) {
                if (result) executeQuery();
            });
        }

        function executeBulkDetectCredits() {
            var targetRows = getTargetRows();

            if (targetRows.length === 0) {
                helpers.showError('No rows to detect credits for.');
                return;
            }

            var seen = {};
            var uniqueItemIds = [];
            targetRows.forEach(function (row) {
                var id = row['ItemId'];
                if (id && !seen[id]) {
                    seen[id] = true;
                    uniqueItemIds.push(id);
                }
            });

            helpers.bulkDetectCredits(uniqueItemIds).then(function (result) {
                if (result) executeQuery();
            });
        }

        function onSelectionChange() {
            var hasActions = currentCapabilities && (currentCapabilities.canEdit || currentCapabilities.canDelete);
            updateBulkActionBar(hasActions);
        }

        // ===== EXISTING: Results Display =====

        /**
         * Display query results in a table
         */
        function displayResults(results) {
            if (!results || results.length === 0) {
                displayNoResults();
                return;
            }

            selectedRows = {};
            var columns = Object.keys(results[0]);
            currentCapabilities = detectCapabilities(columns);
            var hasCheckboxes = currentCapabilities.canDelete;
            var hasActionsCol = currentCapabilities.canEdit || currentCapabilities.canDelete;
            var thead = view.querySelector('#resultsTableHead');
            var tbody = view.querySelector('#resultsTableBody');
            var table = view.querySelector('#resultsTable');
            var noResults = view.querySelector('#noResults');
            var resultInfo = view.querySelector('#resultInfo');

            thead.innerHTML = '';
            var headerRow = document.createElement('tr');
            headerRow.style.backgroundColor = 'rgba(128, 128, 128, 0.15)';

            // Detect page background for sticky cell backgrounds
            var pageBg = getComputedStyle(view.closest('.page') || view).backgroundColor || '#1c1c1e';
            var headerBg = 'rgba(128, 128, 128, 0.15)';

            // Checkbox column for row selection (when bulk delete is available)
            if (hasCheckboxes) {
                var thCheck = document.createElement('th');
                thCheck.className = 'col-sticky-left';
                thCheck.style.cssText = 'padding: 0.5em; text-align: center; border-bottom: 1px solid rgba(128, 128, 128, 0.3); width: 40px; background: ' + pageBg + ';';
                thCheck.innerHTML = '<input type="checkbox" class="select-all-cb" title="Select all">';
                headerRow.appendChild(thCheck);
            }

            columns.forEach(function (col) {
                var th = document.createElement('th');
                th.textContent = col;
                th.style.padding = '0.5em';
                th.style.textAlign = 'left';
                th.style.borderBottom = '1px solid rgba(128, 128, 128, 0.3)';
                headerRow.appendChild(th);
            });
            if (hasActionsCol) {
                var thActions = document.createElement('th');
                thActions.className = 'col-sticky-right';
                thActions.textContent = 'Actions';
                thActions.style.cssText = 'padding: 0.5em; text-align: center; border-bottom: 1px solid rgba(128, 128, 128, 0.3); background: ' + pageBg + ';';
                headerRow.appendChild(thActions);
            }
            thead.appendChild(headerRow);

            tbody.innerHTML = '';
            results.forEach(function (row, idx) {
                var tr = document.createElement('tr');
                tr.setAttribute('data-row-index', idx);
                if (idx % 2 === 1) {
                    tr.style.backgroundColor = 'rgba(128, 128, 128, 0.05)';
                }

                var rowBg = idx % 2 === 1 ? 'rgba(128, 128, 128, 0.05)' : pageBg;

                // Row checkbox
                if (hasCheckboxes) {
                    var tdCheck = document.createElement('td');
                    tdCheck.className = 'col-sticky-left';
                    tdCheck.style.cssText = 'padding: 0.5em; text-align: center; border-bottom: 1px solid rgba(128, 128, 128, 0.1); width: 40px; background: ' + rowBg + ';';
                    tdCheck.innerHTML = '<input type="checkbox" class="row-select-cb">';
                    tr.appendChild(tdCheck);
                }

                columns.forEach(function (col) {
                    var td = document.createElement('td');
                    var value = row[col];

                    if (col.endsWith('Ticks') && typeof value === 'number' && currentCapabilities.canPlayback && value > 0) {
                        td.innerHTML = helpers.renderTimestamp(value, row['ItemId']);
                    } else if (col.endsWith('Ticks') && typeof value === 'number') {
                        td.textContent = helpers.ticksToTime(value);
                    } else if (value === null || value === undefined) {
                        td.textContent = '';
                        td.style.opacity = '0.5';
                    } else {
                        td.textContent = String(value);
                    }

                    if (currentCapabilities.editableColumns.indexOf(col) >= 0) {
                        td.classList.add('tick-cell');
                        td.setAttribute('data-column', col);
                    }

                    td.style.padding = '0.5em';
                    td.style.borderBottom = '1px solid rgba(128, 128, 128, 0.1)';
                    tr.appendChild(td);
                });

                if (hasActionsCol) {
                    var actionsTd = document.createElement('td');
                    actionsTd.className = 'actions-cell col-sticky-right';
                    actionsTd.style.cssText = 'padding: 0.5em; border-bottom: 1px solid rgba(128, 128, 128, 0.1); text-align: center; white-space: nowrap; background: ' + rowBg + ';';
                    actionsTd.innerHTML = '<button class="raised emby-button btn-actions" title="Episode actions" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Actions &#9660;</button>';
                    tr.appendChild(actionsTd);
                }

                tbody.appendChild(tr);
            });

            noResults.style.display = 'none';
            table.style.display = 'table';

            helpers.applyTableStyles(table);

            // Show/hide bulk action bar
            updateBulkActionBar(hasCheckboxes);

            // Show capabilities indicator
            var indicator = view.querySelector('#editingIndicator');
            if (indicator) {
                if (currentCapabilities.canEdit) {
                    indicator.textContent = 'Edit & bulk delete enabled \u2014 ItemId and timestamp columns detected';
                    indicator.style.display = 'inline';
                } else if (currentCapabilities.canDelete) {
                    indicator.textContent = 'Bulk delete enabled \u2014 ItemId column detected';
                    indicator.style.display = 'inline';
                } else {
                    indicator.style.display = 'none';
                }
            }

            var rowCountSpan = view.querySelector('#rowCount');
            rowCountSpan.textContent = results.length;
            view.querySelector('#resultCount').style.display = 'inline';
            view.querySelector('#resultError').style.display = 'none';
            resultInfo.style.display = 'block';
        }

        /**
         * Display error message
         */
        function showError(errorMsg) {
            var resultInfo = view.querySelector('#resultInfo');
            var resultError = view.querySelector('#resultError');
            var table = view.querySelector('#resultsTable');
            var noResults = view.querySelector('#noResults');
            var bulkBar = view.querySelector('#bulkActionBar');
            if (bulkBar) bulkBar.style.display = 'none';

            table.style.display = 'none';
            noResults.style.display = 'block';
            resultError.textContent = 'Error: ' + errorMsg;
            view.querySelector('#resultCount').style.display = 'none';
            resultError.style.display = 'inline';
            resultInfo.style.display = 'block';
        }

        /**
         * Display no results message
         */
        function displayNoResults() {
            var resultInfo = view.querySelector('#resultInfo');
            var table = view.querySelector('#resultsTable');
            var noResults = view.querySelector('#noResults');
            var bulkBar = view.querySelector('#bulkActionBar');
            if (bulkBar) bulkBar.style.display = 'none';

            table.style.display = 'none';
            noResults.style.display = 'block';
            noResults.textContent = 'Query returned no rows.';
            view.querySelector('#resultCount').style.display = 'none';
            view.querySelector('#resultError').style.display = 'none';
            resultInfo.style.display = 'block';
            view.querySelector('#btnExportCsv').style.display = 'none';
        }

        /**
         * Clear results
         */
        function clearResults() {
            if (editingRow) {
                editingRow = null;
                setActionButtonsDisabled(false);
            }
            view.querySelector('#sqlInput').value = '';
            view.querySelector('#queriesDropdown').selectedIndex = 0;
            view.querySelector('#btnDeleteQuery').style.display = 'none';
            view.querySelector('#resultsTable').style.display = 'none';
            view.querySelector('#noResults').style.display = 'block';
            view.querySelector('#noResults').textContent = 'No results to display. Execute a query to see results.';
            view.querySelector('#resultInfo').style.display = 'none';
            view.querySelector('#btnExportCsv').style.display = 'none';
            var indicator = view.querySelector('#editingIndicator');
            if (indicator) indicator.style.display = 'none';
            selectedRows = {};
            currentResults = [];
            currentColumns = [];
            currentCapabilities = null;
            var bulkBar = view.querySelector('#bulkActionBar');
            if (bulkBar) bulkBar.style.display = 'none';
        }

        /**
         * Export results to CSV
         */
        function exportToCsv() {
            if (currentResults.length === 0 || currentColumns.length === 0) {
                helpers.showError('No results to export.');
                return;
            }

            var csv = [];

            csv.push(currentColumns.map(function (col) {
                return '"' + col.replace(/"/g, '""') + '"';
            }).join(','));

            currentResults.forEach(function (row) {
                csv.push(currentColumns.map(function (col) {
                    var value = row[col];
                    if (value === null || value === undefined) {
                        return '';
                    }
                    var strValue = String(value);
                    return '"' + strValue.replace(/"/g, '""') + '"';
                }).join(','));
            });

            var csvContent = csv.join('\n');
            var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            var link = document.createElement('a');
            var url = URL.createObjectURL(blob);

            var timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            link.setAttribute('href', url);
            link.setAttribute('download', 'segment_query_results_' + timestamp + '.csv');
            link.style.visibility = 'hidden';

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            helpers.showSuccess('Results exported to CSV.');
        }

        // ===== EVENT WIRING =====

        view.addEventListener('viewshow', function (e) {
            helpers.loadPreferences();
            loadQueries();

            helpers.checkCreditsDetector().then(function (available) {
                creditsDetectorAvailable = available;
            });

            if (!listenersAttached) {
                listenersAttached = true;

                var queriesDropdown = view.querySelector('#queriesDropdown');
                if (queriesDropdown) {
                    queriesDropdown.addEventListener('change', handleQuerySelect);
                }

                var btnSaveQuery = view.querySelector('#btnSaveQuery');
                if (btnSaveQuery) {
                    btnSaveQuery.addEventListener('click', saveCurrentQuery);
                }

                var btnDeleteQuery = view.querySelector('#btnDeleteQuery');
                if (btnDeleteQuery) {
                    btnDeleteQuery.addEventListener('click', deleteSelectedQuery);
                }

                var btnExecute = view.querySelector('#btnExecute');
                if (btnExecute) {
                    btnExecute.addEventListener('click', executeQuery);
                }

                var btnClear = view.querySelector('#btnClear');
                if (btnClear) {
                    btnClear.addEventListener('click', clearResults);
                }

                var btnExportCsv = view.querySelector('#btnExportCsv');
                if (btnExportCsv) {
                    btnExportCsv.addEventListener('click', exportToCsv);
                }

                // Delegated click handler for results table (playback links + action buttons)
                var resultsTableBody = view.querySelector('#resultsTableBody');
                if (resultsTableBody) {
                    resultsTableBody.addEventListener('click', function (e) {
                        var target = e.target;

                        // Timestamp playback links
                        var link = target.closest('.timestamp-link');
                        if (link) {
                            var tr = link.closest('tr');
                            if (tr && tr.classList.contains('editing')) return;
                            e.preventDefault();
                            var ticks = parseInt(link.getAttribute('data-ticks'), 10);
                            var itemId = link.getAttribute('data-item-id');
                            helpers.launchPlayback(itemId, ticks);
                            return;
                        }

                        // Actions button
                        if (target.classList.contains('btn-actions')) {
                            e.stopPropagation();
                            var actionsTr = target.closest('tr');
                            if (actionsTr) showActionsMenu(actionsTr, target);
                            return;
                        }

                        // Save button
                        if (target.classList.contains('btn-save')) {
                            e.stopPropagation();
                            var saveTr = target.closest('tr');
                            if (saveTr) saveRowEdit(saveTr);
                            return;
                        }

                        // Cancel button
                        if (target.classList.contains('btn-cancel')) {
                            e.stopPropagation();
                            var cancelTr = target.closest('tr');
                            if (cancelTr) cancelRowEdit(cancelTr);
                            return;
                        }

                    });
                }

                // Checkbox handlers (delegated on the whole table)
                var resultsTable = view.querySelector('#resultsTable');
                if (resultsTable) {
                    resultsTable.addEventListener('change', function (e) {
                        var target = e.target;

                        // Select-all checkbox in header
                        if (target.classList.contains('select-all-cb')) {
                            var checked = target.checked;
                            var rowCbs = resultsTable.querySelectorAll('.row-select-cb');
                            selectedRows = {};
                            for (var i = 0; i < rowCbs.length; i++) {
                                rowCbs[i].checked = checked;
                                if (checked) {
                                    var tr = rowCbs[i].closest('tr');
                                    if (tr) selectedRows[tr.getAttribute('data-row-index')] = true;
                                }
                            }
                            onSelectionChange();
                            return;
                        }

                        // Individual row checkbox
                        if (target.classList.contains('row-select-cb')) {
                            var rowTr = target.closest('tr');
                            if (rowTr) {
                                var rowIdx = rowTr.getAttribute('data-row-index');
                                if (target.checked) {
                                    selectedRows[rowIdx] = true;
                                } else {
                                    delete selectedRows[rowIdx];
                                }
                            }
                            // Update select-all checkbox state
                            var allCb = resultsTable.querySelector('.select-all-cb');
                            var allRowCbs = resultsTable.querySelectorAll('.row-select-cb');
                            var allChecked = allRowCbs.length > 0;
                            for (var j = 0; j < allRowCbs.length; j++) {
                                if (!allRowCbs[j].checked) { allChecked = false; break; }
                            }
                            if (allCb) allCb.checked = allChecked;
                            onSelectionChange();
                            return;
                        }
                    });
                }

                // Query builder
                var btnToggleBuilder = view.querySelector('#btnToggleBuilder');
                if (btnToggleBuilder) {
                    btnToggleBuilder.addEventListener('click', toggleBuilder);
                }

                var builderPanel = view.querySelector('#queryBuilderPanel');
                if (builderPanel) {
                    builderPanel.addEventListener('click', onBuilderClick);
                    builderPanel.addEventListener('change', onBuilderChange);
                    builderPanel.addEventListener('input', onBuilderChange);
                    builderPanel.addEventListener('pointerdown', onPillPointerDown);
                    builderPanel.addEventListener('focusin', onAcFocusIn);
                    builderPanel.addEventListener('input', onAcInput);
                    builderPanel.addEventListener('keydown', onAcKeydown);
                }

                // Close autocomplete dropdowns when clicking outside
                document.addEventListener('click', _onDocClickCloseAc);
            }
        });

        function _onDocClickCloseAc(e) {
            if (!e.target.closest || (!e.target.closest('.sr-pill-container') && !e.target.closest('.sr-ac-wrapper'))) {
                closeAllDropdowns();
            }
        }

        view.addEventListener('viewdestroy', function (e) {
            currentResults = [];
            currentColumns = [];
            currentCapabilities = null;
            editingRow = null;
            selectedRows = {};
            builderState.items = [];
            builderState.columnOrder = BUILDER_FIELDS.map(function (f) { return f.name; });
            builderState.selectedColumns = BUILDER_FIELDS.map(function (f) { return f.name; });
            _draggedCol = null;
            _draggedPill = null;
            _wasDragging = false;
            _accentHex = null;
            _autocompleteCache = {};
            _acDropdownIdx = -1;
            _dropdownBg = null;
            clearTimeout(_acDebounceTimer);
            document.removeEventListener('pointermove', onPillPointerMove);
            document.removeEventListener('pointerup', onPillPointerUp);
            document.removeEventListener('click', _onDocClickCloseAc);
            _nextId = 1;
        });
    };
});
