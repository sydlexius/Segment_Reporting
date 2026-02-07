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

define([Dashboard.getConfigurationResourceUrl('helper_function.js')], function (helpers) {
    'use strict';

    return function (view, params) {

        var currentResults = [];
        var currentColumns = [];

        /**
         * Load canned queries from API
         */
        function loadCannedQueries() {
            helpers.apiCall('canned_queries', 'GET')
                .then(function (data) {
                    var dropdown = view.querySelector('#cannedQueriesDropdown');

                    if (data && Array.isArray(data)) {
                        data.forEach(function (query) {
                            var option = document.createElement('option');
                            option.value = query.sql || '';
                            option.textContent = query.name || 'Unnamed Query';
                            dropdown.appendChild(option);
                        });
                    }
                })
                .catch(function (error) {
                    console.error('Failed to load canned queries:', error);
                    // Silently fail - canned queries are optional
                });
        }

        /**
         * Handle canned query selection
         */
        function handleCannedQuerySelect(event) {
            var selectedSql = event.target.value;
            if (selectedSql) {
                view.querySelector('#sqlInput').value = selectedSql;
            }
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

            helpers.showLoading();
            var btnExecute = view.querySelector('#btnExecute');
            btnExecute.disabled = true;
            btnExecute.querySelector('span').textContent = 'Executing...';

            // Use ApiClient directly to pass query parameter
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

                    // Handle QueryResult format: { Columns: [], Rows: [[]], Message: "" }
                    if (response && response.Columns && response.Rows) {
                        // Check for error in Message
                        if (response.Message && response.Message.startsWith('Error:')) {
                            showError(response.Message);
                            return;
                        }

                        // Convert QueryResult format to array of objects
                        var results = [];
                        var columns = response.Columns;

                        response.Rows.forEach(function (row) {
                            var obj = {};
                            columns.forEach(function (col, idx) {
                                obj[col] = row[idx];
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

        /**
         * Display query results in a table
         */
        function displayResults(results) {
            if (!results || results.length === 0) {
                displayNoResults();
                return;
            }

            var columns = Object.keys(results[0]);
            var thead = view.querySelector('#resultsTableHead');
            var tbody = view.querySelector('#resultsTableBody');
            var table = view.querySelector('#resultsTable');
            var noResults = view.querySelector('#noResults');
            var resultInfo = view.querySelector('#resultInfo');

            // Build header
            thead.innerHTML = '';
            var headerRow = document.createElement('tr');
            headerRow.style.backgroundColor = 'rgba(128, 128, 128, 0.15)';
            columns.forEach(function (col) {
                var th = document.createElement('th');
                th.textContent = col;
                th.style.padding = '0.5em';
                th.style.textAlign = 'left';
                th.style.borderBottom = '1px solid rgba(128, 128, 128, 0.3)';
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);

            // Build rows
            tbody.innerHTML = '';
            results.forEach(function (row, idx) {
                var tr = document.createElement('tr');
                if (idx % 2 === 1) {
                    tr.style.backgroundColor = 'rgba(128, 128, 128, 0.05)';
                }
                columns.forEach(function (col) {
                    var td = document.createElement('td');
                    var value = row[col];

                    // Format specific column types
                    if (col.endsWith('Ticks') && typeof value === 'number') {
                        td.textContent = helpers.ticksToTime(value);
                    } else if (value === null || value === undefined) {
                        td.textContent = '';
                        td.style.opacity = '0.5';
                    } else {
                        td.textContent = String(value);
                    }

                    td.style.padding = '0.5em';
                    td.style.borderBottom = '1px solid rgba(128, 128, 128, 0.1)';
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });

            // Show table and result info
            noResults.style.display = 'none';
            table.style.display = 'table';

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
            view.querySelector('#sqlInput').value = '';
            view.querySelector('#cannedQueriesDropdown').value = '';
            view.querySelector('#resultsTable').style.display = 'none';
            view.querySelector('#noResults').style.display = 'block';
            view.querySelector('#noResults').textContent = 'No results to display. Execute a query to see results.';
            view.querySelector('#resultInfo').style.display = 'none';
            view.querySelector('#btnExportCsv').style.display = 'none';
            currentResults = [];
            currentColumns = [];
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

            // Add header row
            csv.push(currentColumns.map(function (col) {
                return '"' + col.replace(/"/g, '""') + '"';
            }).join(','));

            // Add data rows
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

            // Create blob and download
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

        view.addEventListener('viewshow', function (e) {
            loadCannedQueries();

            var cannedQueriesDropdown = view.querySelector('#cannedQueriesDropdown');
            if (cannedQueriesDropdown) {
                cannedQueriesDropdown.addEventListener('change', handleCannedQuerySelect);
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
        });

        view.addEventListener('viewdestroy', function (e) {
            currentResults = [];
            currentColumns = [];
        });
    };
});
