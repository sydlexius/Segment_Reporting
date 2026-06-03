/*
Copyright(C) 2026

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

        var apiEndpoints = [
            { method: 'GET',  path: 'library_summary',     description: 'Per-library coverage statistics' },
            { method: 'GET',  path: 'series_list',          description: 'Series/movies in a library with coverage stats' },
            { method: 'GET',  path: 'season_list',          description: 'Seasons for a series with coverage stats' },
            { method: 'GET',  path: 'episode_list',         description: 'Episodes with full segment tick values' },
            { method: 'GET',  path: 'item_segments',        description: 'Segment detail for a single item' },
            { method: 'POST', path: 'update_segment',       description: 'Update or add a segment on one item' },
            { method: 'POST', path: 'delete_segment',       description: 'Remove a segment marker from an item' },
            { method: 'POST', path: 'bulk_apply',           description: 'Copy segments from a source item to targets' },
            { method: 'POST', path: 'bulk_delete',          description: 'Remove segment types from multiple items' },
            { method: 'POST', path: 'bulk_set_credits_end', description: 'Set CreditsStart to runtime minus offset' },
            { method: 'POST', path: 'sync_now',             description: 'Trigger immediate full sync' },
            { method: 'GET',  path: 'sync_status',          description: 'Last sync time, items scanned, duration' },
            { method: 'POST', path: 'force_rescan',         description: 'Drop and rebuild entire cache' },
            { method: 'GET',  path: 'cache_stats',          description: 'Cache row count, DB size, last sync info' },
            { method: 'POST', path: 'submit_custom_query',  description: 'Execute read-only SQL against the cache' },
            { method: 'GET',  path: 'canned_queries',       description: 'List of built-in queries' },
            { method: 'GET',  path: 'plugin_info',          description: 'Plugin name, version, and description' },
            { method: 'GET',  path: 'preferences',          description: 'Get all display preferences' },
            { method: 'POST', path: 'preferences',          description: 'Save display preferences' },
            { method: 'POST', path: 'bulk_set_segments',    description: 'Bulk set or adjust segment values on selected items' },
            { method: 'GET',  path: 'distinct_values',      description: 'Distinct column values for the query builder' },
            { method: 'GET',  path: 'saved_queries',        description: 'List saved custom queries' },
            { method: 'POST', path: 'saved_queries',        description: 'Add a saved custom query' },
            { method: 'DELETE', path: 'saved_queries/{Id}', description: 'Delete a saved custom query' },
            { method: 'POST', path: 'vacuum',               description: 'VACUUM the cache database' },
            { method: 'GET',  path: 'version',              description: 'Plugin assembly version (cache validation)' }
        ];

        function loadPluginInfo() {
            helpers.apiCall('plugin_info', 'GET').then(function (info) {
                view.querySelector('#aboutPluginName').textContent = info.name || 'Segment Reporting';
                var bakedVersion = (typeof SEGMENT_REPORTING_PLUGIN_VERSION !== 'undefined' &&
                    SEGMENT_REPORTING_PLUGIN_VERSION.indexOf('__') !== 0)
                    ? SEGMENT_REPORTING_PLUGIN_VERSION
                    : (info.version || '?.?.?.?');
                view.querySelector('#aboutPluginVersion').textContent = 'v' + bakedVersion;
                view.querySelector('#aboutPluginDescription').textContent = info.description || '';
            }).catch(function () {
                view.querySelector('#aboutPluginName').textContent = 'Segment Reporting';
                view.querySelector('#aboutPluginVersion').textContent = 'Unknown';
                view.querySelector('#aboutPluginDescription').textContent = '';
            });
        }

        function renderApiEndpoints() {
            var tbody = view.querySelector('#apiEndpointsBody');
            tbody.innerHTML = '';

            apiEndpoints.forEach(function (ep) {
                var row = document.createElement('tr');
                row.style.borderBottom = '1px solid rgba(128, 128, 128, 0.2)';

                var methodColor = ep.method === 'GET' ? 'rgba(76, 175, 80, 0.8)' : 'rgba(33, 150, 243, 0.8)';

                row.innerHTML =
                    '<td style="padding: 0.5em;"><span style="color: ' + methodColor + '; font-weight: bold; font-family: monospace;">' + helpers.escHtml(ep.method) + '</span></td>' +
                    '<td style="padding: 0.5em; font-family: monospace; opacity: 0.9;">' + helpers.escHtml(ep.path) + '</td>' +
                    '<td style="padding: 0.5em; opacity: 0.8;">' + helpers.escHtml(ep.description) + '</td>';

                tbody.appendChild(row);
            });
        }

        view.addEventListener('viewshow', function () {
            loadPluginInfo();
            renderApiEndpoints();
        });
    };
});
