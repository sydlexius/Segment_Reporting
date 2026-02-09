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
        var libraryData = [];
        var chart = null;
        var listenersAttached = false;

        /**
         * Load library summary data from API
         */
        function loadLibrarySummary() {
            helpers.apiCallWithLoading('library_summary', 'GET')
                .then(function (data) {
                    libraryData = data || [];

                    // Filter hidden library types based on preferences
                    var hideMovies = helpers.getPreference('hideMovieLibraries') === 'true';
                    var hideMixed = helpers.getPreference('hideMixedLibraries') === 'true';
                    if (hideMovies || hideMixed) {
                        libraryData = libraryData.filter(function (lib) {
                            if (hideMovies && lib.ContentType === 'movies') return false;
                            if (hideMixed && lib.ContentType === 'mixed') return false;
                            return true;
                        });
                    }

                    updateSummaryCards();
                    updateChart();
                    updateTable();
                })
                .catch(function () {});
        }

        /**
         * Load sync status from API
         */
        function loadSyncStatus() {
            helpers.apiCall('sync_status', 'GET')
                .then(function (data) {
                    var statusText = 'Last synced: ';
                    if (data && data.lastFullSync) {
                        statusText += helpers.relativeTime(data.lastFullSync);
                        statusText += ' (' + (data.itemsScanned || 0) + ' items scanned';
                        if (data.syncDuration) {
                            var durationSec = (data.syncDuration / 1000).toFixed(1);
                            statusText += ', took ' + durationSec + 's';
                        }
                        statusText += ')';
                    } else {
                        statusText += data.message || 'Never';
                    }
                    view.querySelector('#syncStatusText').textContent = statusText;
                })
                .catch(function (error) {
                    console.error('Failed to load sync status:', error);
                    view.querySelector('#syncStatusText').textContent = 'Unable to load sync status';
                });
        }

        /**
         * Calculate totals across all libraries and update summary cards
         */
        function updateSummaryCards() {
            var totalItems = 0;
            var totalWithIntro = 0;
            var totalWithCredits = 0;
            var totalWithBoth = 0;
            var totalWithNeither = 0;

            libraryData.forEach(function (lib) {
                totalItems += lib.TotalItems || 0;
                totalWithIntro += lib.WithIntro || 0;
                totalWithCredits += lib.WithCredits || 0;
                totalWithBoth += lib.WithBoth || 0;
                totalWithNeither += lib.WithNeither || 0;
            });

            // Apply theme-derived colors to summary cards
            var themeColors = helpers.getThemeColors(view);
            var palette = themeColors.chart;

            view.querySelector('#cardTotalItems').textContent = totalItems.toLocaleString();

            var cardIntro = view.querySelector('#cardIntroCoverage');
            cardIntro.textContent = helpers.percentage(totalWithIntro, totalItems);
            cardIntro.style.color = palette.introOnly;

            var cardCredits = view.querySelector('#cardCreditsCoverage');
            cardCredits.textContent = helpers.percentage(totalWithCredits, totalItems);
            cardCredits.style.color = palette.creditsOnly;

            var cardBoth = view.querySelector('#cardBothCoverage');
            cardBoth.textContent = helpers.percentage(totalWithBoth, totalItems);
            cardBoth.style.color = palette.bothSegments;

            var cardNeither = view.querySelector('#cardNeitherCoverage');
            cardNeither.textContent = helpers.percentage(totalWithNeither, totalItems);
            cardNeither.style.color = palette.noSegments;
        }

        /**
         * Create or update the stacked bar chart
         */
        function updateChart() {
            require([Dashboard.getConfigurationResourceUrl('segment_reporting_chart.min.js')], function (Chart) {
                var ctx = view.querySelector('#libraryChart').getContext('2d');

                var labels = libraryData.map(function (lib) {
                    return lib.LibraryName || 'Unknown';
                });

                var introOnly = libraryData.map(function (lib) {
                    return (lib.WithIntro || 0) - (lib.WithBoth || 0);
                });

                var creditsOnly = libraryData.map(function (lib) {
                    return (lib.WithCredits || 0) - (lib.WithBoth || 0);
                });

                var withBoth = libraryData.map(function (lib) {
                    return lib.WithBoth || 0;
                });

                var withNeither = libraryData.map(function (lib) {
                    return lib.WithNeither || 0;
                });

                if (chart) {
                    chart.destroy();
                }

                chart = helpers.createSegmentChart(Chart, ctx, labels,
                    { withBoth: withBoth, introOnly: introOnly, creditsOnly: creditsOnly, withNeither: withNeither },
                    view, {
                        tooltipCallbacks: {
                            footer: function (tooltipItems) {
                                var index = tooltipItems[0].dataIndex;
                                var lib = libraryData[index];
                                return 'Total: ' + (lib.TotalItems || 0) + ' items';
                            }
                        },
                        onClick: function (event, elements) {
                            if (elements && elements.length > 0) {
                                var index = elements[0].index;
                                var lib = libraryData[index];
                                if (lib && lib.LibraryId) {
                                    helpers.navigate('segment_library', { libraryId: lib.LibraryId });
                                }
                            }
                        }
                    }
                );
            });
        }

        /**
         * Update the library table
         */
        function updateTable() {
            var tbody = view.querySelector('#libraryTableBody');
            tbody.innerHTML = '';

            if (libraryData.length === 0) {
                tbody.appendChild(helpers.createEmptyRow('No library data available. Click "Sync Now" to populate the cache.', 7));
                return;
            }

            libraryData.forEach(function (lib) {
                var row = document.createElement('tr');
                row.style.cursor = 'pointer';
                row.setAttribute('data-library-id', lib.LibraryId);

                var totalItems = lib.TotalItems || 0;
                var withIntro = lib.WithIntro || 0;
                var withCredits = lib.WithCredits || 0;
                var withBoth = lib.WithBoth || 0;
                var withNeither = lib.WithNeither || 0;
                var coveragePct = helpers.percentage(withIntro + withCredits - withBoth, totalItems);

                row.innerHTML =
                    '<td>' + helpers.escHtml(lib.LibraryName || 'Unknown') + '</td>' +
                    '<td>' + totalItems.toLocaleString() + '</td>' +
                    '<td>' + withIntro.toLocaleString() + '</td>' +
                    '<td>' + withCredits.toLocaleString() + '</td>' +
                    '<td>' + withBoth.toLocaleString() + '</td>' +
                    '<td>' + withNeither.toLocaleString() + '</td>' +
                    '<td><strong>' + coveragePct + '</strong></td>';

                row.addEventListener('click', function () {
                    helpers.navigate('segment_library', { libraryId: lib.LibraryId });
                });

                helpers.attachHoverEffect(row);

                tbody.appendChild(row);
            });

            helpers.applyTableStyles(view.querySelector('#libraryTable'));
        }

        /**
         * Handle Detect All Credits button click (EmbyCredits integration)
         */
        function handleDetectAllCredits() {
            if (!confirm('This will trigger EmbyCredits to detect credits for all episodes in the library. This runs in the background and may take a while. Continue?')) {
                return;
            }

            var btn = view.querySelector('#btnDetectAllCredits');
            helpers.withButtonLoading(btn, 'Detecting...',
                helpers.creditsDetectorCall('TriggerDetection')
                    .then(function () {
                        helpers.showSuccess('Credits detection has been queued for all episodes. Results will appear after the next sync.');
                    })
                    .catch(function (error) {
                        console.error('Credits detection failed:', error);
                        helpers.showError('Credits detection failed. Is EmbyCredits running?');
                    })
            );
        }

        /**
         * Handle Sync Now button click
         */
        function handleSyncNow() {
            if (!confirm('This will trigger a full sync of all media segments from Emby. This may take several minutes on large libraries. Continue?')) {
                return;
            }

            helpers.showLoading();
            var btn = view.querySelector('#btnSyncNow');
            btn.disabled = true;
            btn.querySelector('span').textContent = 'Syncing...';

            helpers.apiCall('sync_now', 'POST')
                .then(function (response) {
                    if (response && response.success) {
                        helpers.showSuccess('Sync task has been queued. The page will refresh when sync is complete.');

                        setTimeout(function () {
                            loadLibrarySummary();
                            loadSyncStatus();
                            helpers.hideLoading();
                            btn.disabled = false;
                            btn.querySelector('span').textContent = 'Sync Now';
                        }, 5000);
                    } else {
                        helpers.showError(response.error || 'Failed to start sync.');
                        helpers.hideLoading();
                        btn.disabled = false;
                        btn.querySelector('span').textContent = 'Sync Now';
                    }
                })
                .catch(function (error) {
                    console.error('Sync failed:', error);
                    helpers.showError('Failed to start sync: ' + error);
                    helpers.hideLoading();
                    btn.disabled = false;
                    btn.querySelector('span').textContent = 'Sync Now';
                });
        }

        view.addEventListener('viewshow', function (e) {
            if (!listenersAttached) {
                listenersAttached = true;

                var btnSyncNow = view.querySelector('#btnSyncNow');
                if (btnSyncNow) {
                    btnSyncNow.addEventListener('click', handleSyncNow);
                }

                var btnDetectAll = view.querySelector('#btnDetectAllCredits');
                if (btnDetectAll) {
                    btnDetectAll.addEventListener('click', handleDetectAllCredits);
                }

                var btnCustomQuery = view.querySelector('#btnCustomQuery');
                if (btnCustomQuery) {
                    btnCustomQuery.addEventListener('click', function () {
                        helpers.navigate('segment_custom_query');
                    });
                }

                var btnSettings = view.querySelector('#btnSettings');
                if (btnSettings) {
                    btnSettings.addEventListener('click', function () {
                        helpers.navigate('segment_settings');
                    });
                }

                var btnAbout = view.querySelector('#btnAbout');
                if (btnAbout) {
                    btnAbout.addEventListener('click', function () {
                        helpers.navigate('segment_about');
                    });
                }
            }

            // Check for EmbyCredits plugin and show/hide detect button
            helpers.checkCreditsDetector().then(function (available) {
                var btnDetect = view.querySelector('#btnDetectAllCredits');
                if (btnDetect) {
                    btnDetect.style.display = available ? '' : 'none';
                }
            });

            // Load preferences first so library filtering and theme colors work
            helpers.loadPreferences().then(function () {
                loadLibrarySummary();
            });
            loadSyncStatus();
        });

        helpers.registerChartCleanup(view, function () { return chart; }, function (v) { chart = v; });
    };
});
