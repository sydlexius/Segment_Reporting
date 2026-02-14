define([Dashboard.getConfigurationResourceUrl('segment_reporting_helpers.js')], function () {
    'use strict';

    return function (view, params) {

        var helpers = getSegmentReportingHelpers();
        var previewChart = null;
        var allLibraries = [];
        var listenersAttached = false;

        // --- Palette preview ---

        function getPreviewPalette() {
            var selected = view.querySelector('#prefChartPalette').value;
            var palette;
            if (selected === 'custom') {
                return {
                    name: 'Custom',
                    bothSegments: view.querySelector('#colorBothText').value.trim() || '#003366',
                    introOnly: view.querySelector('#colorIntroText').value.trim() || '#87CEEB',
                    creditsOnly: view.querySelector('#colorCreditsText').value.trim() || '#F5F5DC',
                    noSegments: view.querySelector('#colorNoneText').value.trim() || '#d90429'
                };
            } else if (selected === 'auto') {
                var accent = helpers.detectAccentColor(view);
                palette = helpers.generateChartPalette(accent);
            } else {
                palette = helpers.getPaletteByName(selected);
            }
            var isLight = helpers.isLightTheme(view);
            palette.bothSegments = helpers.resolveColor(palette.bothSegments, isLight);
            palette.introOnly = helpers.resolveColor(palette.introOnly, isLight);
            palette.creditsOnly = helpers.resolveColor(palette.creditsOnly, isLight);
            palette.noSegments = helpers.resolveColor(palette.noSegments, isLight);
            return palette;
        }

        function renderPreviewChart() {
            var container = view.querySelector('#palettePreviewContainer');
            if (!container) return;

            require([Dashboard.getConfigurationResourceUrl('segment_reporting_chart.min.js')], function (Chart) {
                if (previewChart) {
                    previewChart.destroy();
                    previewChart = null;
                }

                var palette = getPreviewPalette();
                var textColor = getComputedStyle(view).color || '#fff';
                var ctx = view.querySelector('#palettePreviewChart').getContext('2d');

                previewChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: ['TV Shows', 'Anime', 'Documentaries'],
                        datasets: [
                            { label: 'Both Segments', data: [65, 40, 10], backgroundColor: palette.bothSegments, borderColor: palette.bothSegments, borderWidth: 1 },
                            { label: 'Intro Only', data: [20, 30, 15], backgroundColor: palette.introOnly, borderColor: palette.introOnly, borderWidth: 1 },
                            { label: 'Credits Only', data: [10, 15, 25], backgroundColor: palette.creditsOnly, borderColor: palette.creditsOnly, borderWidth: 1 },
                            { label: 'No Segments', data: [5, 15, 50], backgroundColor: palette.noSegments, borderColor: palette.noSegments, borderWidth: 1 }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        animation: { duration: 300 },
                        plugins: {
                            legend: { position: 'bottom', labels: { color: textColor } },
                            tooltip: { enabled: false }
                        },
                        scales: {
                            x: { stacked: true, ticks: { color: textColor }, grid: { color: '#99999944' } },
                            y: { stacked: true, ticks: { color: textColor, beginAtZero: true }, grid: { color: '#99999944' } }
                        }
                    }
                });
            });
        }

        // --- Color picker sync ---

        function setupColorSync(colorId, textId) {
            var colorInput = view.querySelector('#' + colorId);
            var textInput = view.querySelector('#' + textId);
            colorInput.addEventListener('input', function () {
                textInput.value = colorInput.value.toUpperCase();
                renderPreviewChart();
            });
            textInput.addEventListener('input', function () {
                var val = textInput.value.trim();
                if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                    colorInput.value = val;
                    renderPreviewChart();
                }
            });
        }

        // --- Populate form from preferences ---

        function populateForm(prefs) {
            var paletteSelect = view.querySelector('#prefChartPalette');
            paletteSelect.value = prefs.chartPalette || 'auto';
            toggleCustomPanel();

            setColorPair('colorBoth', 'colorBothText', prefs.customColorBoth || '#003366');
            setColorPair('colorIntro', 'colorIntroText', prefs.customColorIntro || '#87CEEB');
            setColorPair('colorCredits', 'colorCreditsText', prefs.customColorCredits || '#F5F5DC');
            setColorPair('colorNone', 'colorNoneText', prefs.customColorNone || '#d90429');

            view.querySelector('#prefGridlines').checked = prefs.tableGridlines === 'true';
            view.querySelector('#prefStripedRows').checked = prefs.tableStripedRows === 'true';
            view.querySelector('#prefHideMovies').checked = prefs.hideMovieLibraries === 'true';
            view.querySelector('#prefHideMixed').checked = prefs.hideMixedLibraries === 'true';
        }

        function setColorPair(colorId, textId, value) {
            view.querySelector('#' + colorId).value = value;
            view.querySelector('#' + textId).value = value.toUpperCase();
        }

        function toggleCustomPanel() {
            var panel = view.querySelector('#customColorsPanel');
            var selected = view.querySelector('#prefChartPalette').value;
            panel.style.display = selected === 'custom' ? '' : 'none';
            renderPreviewChart();
        }

        // --- Per-library exclusions ---

        function loadLibraries(prefs) {
            helpers.apiCall('library_summary', 'GET')
                .then(function (data) {
                    allLibraries = data || [];
                    renderLibraryCheckboxes(prefs);
                })
                .catch(function () {
                    allLibraries = [];
                });
        }

        function renderLibraryCheckboxes(prefs) {
            var section = view.querySelector('#perLibrarySection');
            var container = view.querySelector('#perLibraryList');
            container.innerHTML = '';

            if (allLibraries.length === 0) {
                section.style.display = 'none';
                return;
            }

            section.style.display = '';

            var excludedIds = [];
            var raw = (prefs && prefs.excludedLibraryIds) ? prefs.excludedLibraryIds : '';
            if (raw) {
                excludedIds = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
            }

            allLibraries.forEach(function (lib) {
                var label = document.createElement('label');
                label.style.cssText = 'display: flex; align-items: center; gap: 0.5em; cursor: pointer;';

                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'lib-visibility-cb';
                cb.setAttribute('data-library-id', lib.LibraryId);
                cb.checked = excludedIds.indexOf(lib.LibraryId) < 0;

                var span = document.createElement('span');
                span.textContent = lib.LibraryName + ' (' + (lib.TotalItems || 0) + ' items)';

                label.appendChild(cb);
                label.appendChild(span);
                container.appendChild(label);
            });
        }

        function getExcludedLibraryIds() {
            var checkboxes = view.querySelectorAll('.lib-visibility-cb');
            var excluded = [];
            for (var i = 0; i < checkboxes.length; i++) {
                if (!checkboxes[i].checked) {
                    excluded.push(checkboxes[i].getAttribute('data-library-id'));
                }
            }
            return excluded.join(',');
        }

        // --- Save preferences ---

        function savePreferences() {
            var data = JSON.stringify({
                chartPalette: view.querySelector('#prefChartPalette').value,
                customColorBoth: view.querySelector('#colorBothText').value.trim(),
                customColorIntro: view.querySelector('#colorIntroText').value.trim(),
                customColorCredits: view.querySelector('#colorCreditsText').value.trim(),
                customColorNone: view.querySelector('#colorNoneText').value.trim(),
                tableGridlines: view.querySelector('#prefGridlines').checked ? 'true' : 'false',
                tableStripedRows: view.querySelector('#prefStripedRows').checked ? 'true' : 'false',
                hideMovieLibraries: view.querySelector('#prefHideMovies').checked ? 'true' : 'false',
                hideMixedLibraries: view.querySelector('#prefHideMixed').checked ? 'true' : 'false',
                excludedLibraryIds: getExcludedLibraryIds()
            });

            var btn = view.querySelector('#btnSavePreferences');
            helpers.withButtonLoading(btn, 'Saving...',
                helpers.apiCall('preferences', 'POST', data)
                    .then(function (result) {
                        if (result.success) {
                            helpers.invalidatePreferencesCache();
                            helpers.showSuccess('Settings saved successfully.');
                        } else {
                            helpers.showError(result.error || 'Failed to save settings.');
                        }
                    })
                    .catch(function () {
                        helpers.showError('Failed to save settings.');
                    })
            );
        }

        // --- Cache stats ---

        function loadCacheStats() {
            helpers.apiCall('cache_stats', 'GET').then(function (stats) {
                view.querySelector('#statRowCount').textContent = stats.rowCount.toLocaleString();
                view.querySelector('#statDbSize').textContent = helpers.formatBytes(stats.dbFileSize);
                view.querySelector('#statLastSync').textContent = helpers.relativeTime(stats.lastFullSync);
                view.querySelector('#statSyncDuration').textContent =
                    helpers.formatDuration(stats.syncDuration) +
                    (stats.itemsScanned ? ' (' + stats.itemsScanned.toLocaleString() + ' items)' : '');
            }).catch(function () {
                view.querySelector('#statRowCount').textContent = 'Error';
                view.querySelector('#statDbSize').textContent = 'Error';
                view.querySelector('#statLastSync').textContent = 'Error';
                view.querySelector('#statSyncDuration').textContent = 'Error';
            });
        }

        function onForceRescanClick() {
            Dashboard.confirm(
                'This will drop and rebuild the entire segment cache from Emby\'s data. ' +
                'Your segment data in Emby is not affected. ' +
                'This may take a few minutes on large libraries. Continue?',
                'Force Full Rescan',
                function (confirmed) {
                    if (!confirmed) {
                        return;
                    }
                    var btn = view.querySelector('#btnForceRescan');
                    helpers.withButtonLoading(btn, 'Rescanning...',
                        helpers.apiCall('force_rescan', 'POST').then(function (result) {
                            if (result.error) {
                                helpers.showError(result.error);
                            } else {
                                helpers.showSuccess('Cache dropped and rescan queued. Stats will update after the sync completes.');
                                loadCacheStats();
                            }
                        }).catch(function () {
                            helpers.showError('Failed to trigger force rescan.');
                        })
                    );
                }
            );
        }

        function onVacuumClick() {
            var btn = view.querySelector('#btnVacuum');
            helpers.withButtonLoading(btn, 'Vacuuming...',
                helpers.apiCall('vacuum', 'POST')
                    .then(function (result) {
                        if (result.error) {
                            helpers.showError(result.error);
                        } else {
                            helpers.showSuccess('Database vacuumed. New size: ' + helpers.formatBytes(result.dbFileSize));
                            loadCacheStats();
                        }
                    })
                    .catch(function () {
                        helpers.showError('Failed to vacuum database.');
                    })
            );
        }

        // --- Event wiring ---

        view.addEventListener('viewshow', function () {
            // Load preferences and populate form
            helpers.invalidatePreferencesCache();
            helpers.loadPreferences().then(function (prefs) {
                populateForm(prefs);
                renderPreviewChart();
                loadLibraries(prefs);
            });

            loadCacheStats();

            if (!listenersAttached) {
                listenersAttached = true;

                // Color picker sync
                setupColorSync('colorBoth', 'colorBothText');
                setupColorSync('colorIntro', 'colorIntroText');
                setupColorSync('colorCredits', 'colorCreditsText');
                setupColorSync('colorNone', 'colorNoneText');

                // Palette dropdown toggle
                view.querySelector('#prefChartPalette').addEventListener('change', toggleCustomPanel);

                // Save button
                view.querySelector('#btnSavePreferences').addEventListener('click', savePreferences);

                // Existing buttons
                view.querySelector('#btnForceRescan').addEventListener('click', onForceRescanClick);
                view.querySelector('#btnVacuum').addEventListener('click', onVacuumClick);
                view.querySelector('#btnRefreshStats').addEventListener('click', loadCacheStats);
            }
        });

        view.addEventListener('viewhide', function () {
            if (previewChart) { previewChart.destroy(); previewChart = null; }
        });
    };
});
