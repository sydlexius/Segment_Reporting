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

        var seriesId = null;
        var libraryId = null;
        var seasonData = [];
        var loadedSeasons = {};  // seasonId -> episode array (lazy-load cache)
        var chart = null;
        var bulkSource = null;  // { ItemId, ItemName, IntroStartTicks, IntroEndTicks, CreditsStartTicks }
        var editingRow = null;  // currently editing row element (only one at a time)

        // ── Data Loading ──

        function loadSeasons() {
            helpers.showLoading();

            helpers.apiCall('season_list?seriesId=' + encodeURIComponent(seriesId), 'GET')
                .then(function (data) {
                    seasonData = data || [];

                    // Update title from first season's series name
                    if (seasonData.length > 0 && seasonData[0].SeasonName) {
                        // We need the series name — fetch one episode to get it
                        updatePageTitleFromSeasons();
                    }

                    updateSeasonChart();
                    renderSeasonAccordion();
                    helpers.hideLoading();
                })
                .catch(function (error) {
                    console.error('Failed to load seasons:', error);
                    helpers.showError('Failed to load season data.');
                    helpers.hideLoading();
                });
        }

        function updatePageTitleFromSeasons() {
            // Fetch a single episode to get the series name
            helpers.apiCall('episode_list?seriesId=' + encodeURIComponent(seriesId), 'GET')
                .then(function (episodes) {
                    if (episodes && episodes.length > 0) {
                        var seriesName = episodes[0].SeriesName || 'Unknown Series';
                        view.querySelector('#pageTitle').textContent = seriesName;

                        // Cache the libraryId for back navigation
                        if (episodes[0].LibraryId) {
                            libraryId = episodes[0].LibraryId;
                        }
                    }
                })
                .catch(function () {
                    // Non-critical, keep default title
                });
        }

        function loadEpisodes(seasonId, contentDiv) {
            if (loadedSeasons[seasonId]) {
                renderEpisodeTable(loadedSeasons[seasonId], contentDiv);
                return;
            }

            contentDiv.innerHTML = '<div style="text-align: center; padding: 1em;">Loading episodes...</div>';

            helpers.apiCall('episode_list?seasonId=' + encodeURIComponent(seasonId), 'GET')
                .then(function (episodes) {
                    episodes = episodes || [];
                    // Sort by episode number
                    episodes.sort(function (a, b) {
                        return (a.EpisodeNumber || 0) - (b.EpisodeNumber || 0);
                    });
                    loadedSeasons[seasonId] = episodes;
                    renderEpisodeTable(episodes, contentDiv);
                })
                .catch(function (error) {
                    console.error('Failed to load episodes for season ' + seasonId + ':', error);
                    contentDiv.innerHTML = '<div style="text-align: center; padding: 1em; color: #F44336;">Failed to load episodes.</div>';
                });
        }

        // ── Season Chart ──

        function updateSeasonChart() {
            require([Dashboard.getConfigurationResourceUrl('chart.min.js')], function (Chart) {
                var ctx = view.querySelector('#seasonChart').getContext('2d');

                var labels = seasonData.map(function (s) {
                    return s.SeasonName || ('Season ' + s.SeasonNumber);
                });

                var totalEpisodes = seasonData.map(function (s) { return s.TotalEpisodes || 0; });
                var withIntro = seasonData.map(function (s) { return s.WithIntro || 0; });
                var withCredits = seasonData.map(function (s) { return s.WithCredits || 0; });

                var withBoth = seasonData.map(function (s, i) {
                    return Math.min(withIntro[i], withCredits[i]);
                });
                var introOnly = seasonData.map(function (s, i) {
                    return withIntro[i] - withBoth[i];
                });
                var creditsOnly = seasonData.map(function (s, i) {
                    return withCredits[i] - withBoth[i];
                });
                var withNeither = seasonData.map(function (s, i) {
                    return totalEpisodes[i] - withIntro[i] - withCredits[i] + withBoth[i];
                });

                if (chart) {
                    chart.destroy();
                }

                var themeTextColor = getComputedStyle(view).color;

                chart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [
                            { label: 'Both Segments', data: withBoth, backgroundColor: '#4CAF50', borderColor: '#4CAF50', borderWidth: 1 },
                            { label: 'Intro Only', data: introOnly, backgroundColor: '#2196F3', borderColor: '#2196F3', borderWidth: 1 },
                            { label: 'Credits Only', data: creditsOnly, backgroundColor: '#FF9800', borderColor: '#FF9800', borderWidth: 1 },
                            { label: 'No Segments', data: withNeither, backgroundColor: '#F44336', borderColor: '#F44336', borderWidth: 1 }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            legend: { position: 'bottom', labels: { color: themeTextColor } },
                            tooltip: {
                                mode: 'index',
                                intersect: false,
                                callbacks: {
                                    footer: function (tooltipItems) {
                                        var idx = tooltipItems[0].dataIndex;
                                        return 'Total: ' + (seasonData[idx].TotalEpisodes || 0) + ' episodes';
                                    }
                                }
                            }
                        },
                        scales: {
                            x: { stacked: true, ticks: { color: themeTextColor }, grid: { color: '#99999944' } },
                            y: { stacked: true, ticks: { color: themeTextColor, beginAtZero: true }, grid: { color: '#99999944' } }
                        }
                    }
                });
            });
        }

        // ── Season Accordion ──

        function renderSeasonAccordion() {
            var container = view.querySelector('#seasonContainer');
            container.innerHTML = '';

            if (seasonData.length === 0) {
                container.innerHTML = '<div style="text-align: center; padding: 2em;">No seasons found for this series.</div>';
                return;
            }

            seasonData.forEach(function (season, index) {
                var section = document.createElement('div');
                section.className = 'verticalSection';
                section.style.marginBottom = '1em';

                var totalEp = season.TotalEpisodes || 0;
                var introCount = season.WithIntro || 0;
                var creditsCount = season.WithCredits || 0;
                var coveragePct = helpers.percentage(Math.min(introCount, creditsCount), totalEp);

                // Season header (clickable)
                var header = document.createElement('div');
                header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 0.75em 1em; background-color: rgba(255,255,255,0.05); border-radius: 4px; cursor: pointer; user-select: none;';
                header.innerHTML =
                    '<div style="display: flex; align-items: center; gap: 1em;">' +
                        '<span style="font-size: 1.1em; font-weight: bold;">' + (season.SeasonName || ('Season ' + season.SeasonNumber)) + '</span>' +
                        '<span style="opacity: 0.7;">' + totalEp + ' episodes</span>' +
                        '<span style="opacity: 0.7;">Intros: ' + introCount + '/' + totalEp + '</span>' +
                        '<span style="opacity: 0.7;">Credits: ' + creditsCount + '/' + totalEp + '</span>' +
                    '</div>' +
                    '<div style="display: flex; align-items: center; gap: 1em;">' +
                        '<strong>' + coveragePct + '</strong>' +
                        '<span class="seasonToggle" style="font-size: 1.2em;">&#9654;</span>' +
                    '</div>';

                header.addEventListener('mouseenter', function () { this.style.backgroundColor = 'rgba(128,128,128,0.15)'; });
                header.addEventListener('mouseleave', function () { this.style.backgroundColor = 'rgba(255,255,255,0.05)'; });

                // Content area (hidden initially)
                var contentDiv = document.createElement('div');
                contentDiv.style.cssText = 'display: none; padding: 0.5em 0;';
                contentDiv.setAttribute('data-season-id', season.SeasonId);

                // Toggle handler
                header.addEventListener('click', function () {
                    var toggle = header.querySelector('.seasonToggle');
                    if (contentDiv.style.display === 'none') {
                        contentDiv.style.display = 'block';
                        toggle.innerHTML = '&#9660;';
                        // Lazy-load episodes on first expand
                        if (!loadedSeasons[season.SeasonId]) {
                            loadEpisodes(season.SeasonId, contentDiv);
                        }
                    } else {
                        contentDiv.style.display = 'none';
                        toggle.innerHTML = '&#9654;';
                    }
                });

                // Auto-expand first season
                if (index === 0) {
                    contentDiv.style.display = 'block';
                    header.querySelector('.seasonToggle').innerHTML = '&#9660;';
                }

                section.appendChild(header);
                section.appendChild(contentDiv);
                container.appendChild(section);

                // Load first season immediately
                if (index === 0) {
                    loadEpisodes(season.SeasonId, contentDiv);
                }
            });
        }

        // ── Episode Table ──

        function renderEpisodeTable(episodes, container) {
            container.innerHTML = '';

            if (episodes.length === 0) {
                container.innerHTML = '<div style="text-align: center; padding: 1em; opacity: 0.7;">No episodes found.</div>';
                return;
            }

            var table = document.createElement('table');
            table.style.cssText = 'width: 100%; border-collapse: collapse;';

            // Header
            var thead = document.createElement('thead');
            thead.innerHTML =
                '<tr>' +
                    '<th style="padding: 0.5em; text-align: left; border-bottom: 1px solid rgba(128,128,128,0.3);">#</th>' +
                    '<th style="padding: 0.5em; text-align: left; border-bottom: 1px solid rgba(128,128,128,0.3);">Episode Name</th>' +
                    '<th style="padding: 0.5em; text-align: center; border-bottom: 1px solid rgba(128,128,128,0.3);">IntroStart</th>' +
                    '<th style="padding: 0.5em; text-align: center; border-bottom: 1px solid rgba(128,128,128,0.3);">IntroEnd</th>' +
                    '<th style="padding: 0.5em; text-align: center; border-bottom: 1px solid rgba(128,128,128,0.3);">CreditsStart</th>' +
                    '<th style="padding: 0.5em; text-align: center; border-bottom: 1px solid rgba(128,128,128,0.3);">Actions</th>' +
                '</tr>';
            table.appendChild(thead);

            // Body
            var tbody = document.createElement('tbody');
            episodes.forEach(function (ep) {
                var row = createEpisodeRow(ep);
                tbody.appendChild(row);
            });
            table.appendChild(tbody);

            container.appendChild(table);
        }

        function createEpisodeRow(ep) {
            var row = document.createElement('tr');
            row.setAttribute('data-item-id', ep.ItemId);
            row.style.borderBottom = '1px solid rgba(128,128,128,0.15)';

            // Highlight if this is the bulk source
            if (bulkSource && bulkSource.ItemId === ep.ItemId) {
                row.style.backgroundColor = 'rgba(33, 150, 243, 0.1)';
            }

            var cellStyle = 'padding: 0.5em; ';
            var centerStyle = cellStyle + 'text-align: center; ';

            row.innerHTML =
                '<td style="' + cellStyle + '">' + (ep.EpisodeNumber || '-') + '</td>' +
                '<td style="' + cellStyle + '">' + (ep.ItemName || 'Unknown') + '</td>' +
                '<td class="tick-cell" data-marker="IntroStart" style="' + centerStyle + '">' + helpers.ticksToTime(ep.IntroStartTicks) + '</td>' +
                '<td class="tick-cell" data-marker="IntroEnd" style="' + centerStyle + '">' + helpers.ticksToTime(ep.IntroEndTicks) + '</td>' +
                '<td class="tick-cell" data-marker="CreditsStart" style="' + centerStyle + '">' + helpers.ticksToTime(ep.CreditsStartTicks) + '</td>' +
                '<td style="' + centerStyle + '">' + buildActionButtons(ep) + '</td>';

            // Hover effect
            row.addEventListener('mouseenter', function () {
                if (!row.classList.contains('editing')) {
                    this.style.backgroundColor = bulkSource && bulkSource.ItemId === ep.ItemId
                        ? 'rgba(33, 150, 243, 0.15)'
                        : 'rgba(128,128,128,0.1)';
                }
            });
            row.addEventListener('mouseleave', function () {
                if (!row.classList.contains('editing')) {
                    this.style.backgroundColor = bulkSource && bulkSource.ItemId === ep.ItemId
                        ? 'rgba(33, 150, 243, 0.1)'
                        : '';
                }
            });

            // Attach button handlers
            attachRowActions(row, ep);

            return row;
        }

        function buildActionButtons(ep) {
            return '<button class="raised emby-button btn-edit" title="Edit segments" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Edit</button>' +
                   '<button class="raised emby-button btn-delete" title="Delete a segment" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Delete</button>' +
                   '<button class="raised emby-button btn-copy" title="Mark as bulk copy source" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Copy</button>';
        }

        function attachRowActions(row, ep) {
            var btnEdit = row.querySelector('.btn-edit');
            var btnDelete = row.querySelector('.btn-delete');
            var btnCopy = row.querySelector('.btn-copy');

            if (btnEdit) {
                btnEdit.addEventListener('click', function (e) {
                    e.stopPropagation();
                    startEdit(row, ep);
                });
            }

            if (btnDelete) {
                btnDelete.addEventListener('click', function (e) {
                    e.stopPropagation();
                    showDeleteMenu(row, ep, this);
                });
            }

            if (btnCopy) {
                btnCopy.addEventListener('click', function (e) {
                    e.stopPropagation();
                    markAsCopySource(ep);
                });
            }
        }

        // ── Inline Editing ──

        function startEdit(row, ep) {
            // Cancel any existing edit first
            if (editingRow && editingRow !== row) {
                cancelCurrentEdit();
            }

            editingRow = row;
            row.classList.add('editing');
            row.style.backgroundColor = 'rgba(255, 235, 59, 0.1)';

            var tickCells = row.querySelectorAll('.tick-cell');
            tickCells.forEach(function (cell) {
                var marker = cell.getAttribute('data-marker');
                var currentTicks = ep[marker + 'Ticks'];
                var currentDisplay = helpers.ticksToTime(currentTicks);

                // Store original value for cancel
                cell.setAttribute('data-original-ticks', currentTicks || '');
                cell.setAttribute('data-original-display', currentDisplay);

                var input = document.createElement('input');
                input.type = 'text';
                input.value = currentTicks ? currentDisplay : '';
                input.placeholder = '00:00:00.000';
                input.style.cssText = 'width: 120px; text-align: center; font-size: inherit; font-family: inherit; color: inherit; background: transparent; border: 1px solid rgba(128,128,128,0.4); border-radius: 3px; padding: 0.1em 0.3em;';
                input.setAttribute('data-marker', marker);

                cell.innerHTML = '';
                cell.appendChild(input);
            });

            // Replace action buttons with Save/Cancel
            var actionsCell = row.querySelector('td:last-child');
            actionsCell.innerHTML =
                '<button class="raised emby-button btn-save" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em; background-color: #4CAF50;">Save</button>' +
                '<button class="raised button-cancel emby-button btn-cancel" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Cancel</button>';

            actionsCell.querySelector('.btn-save').addEventListener('click', function (e) {
                e.stopPropagation();
                saveEdit(row, ep);
            });

            actionsCell.querySelector('.btn-cancel').addEventListener('click', function (e) {
                e.stopPropagation();
                cancelEdit(row, ep);
            });
        }

        function saveEdit(row, ep) {
            var inputs = row.querySelectorAll('.tick-cell input');
            var updates = [];

            // Collect changes
            inputs.forEach(function (input) {
                var marker = input.getAttribute('data-marker');
                var originalTicks = parseInt(row.querySelector('.tick-cell[data-marker="' + marker + '"]').getAttribute('data-original-ticks'), 10) || 0;
                var newValue = input.value.trim();

                if (!newValue) {
                    // Empty field — if there was a value before, this means delete
                    if (originalTicks > 0) {
                        updates.push({ type: 'delete', marker: marker });
                    }
                    return;
                }

                var newTicks = helpers.timeToTicks(newValue);
                if (newTicks === 0 && newValue !== '00:00:00.000') {
                    // Invalid format
                    helpers.showError('Invalid time format for ' + marker + '. Use HH:MM:SS.fff');
                    return;
                }

                if (newTicks !== originalTicks) {
                    updates.push({ type: 'update', marker: marker, ticks: newTicks });
                }
            });

            if (updates.length === 0) {
                // No changes
                cancelEdit(row, ep);
                return;
            }

            helpers.showLoading();

            // Process updates sequentially
            var chain = Promise.resolve();
            updates.forEach(function (update) {
                chain = chain.then(function () {
                    if (update.type === 'delete') {
                        return helpers.apiCall('delete_segment', 'POST', JSON.stringify({
                            ItemId: ep.ItemId,
                            MarkerType: update.marker
                        }));
                    } else {
                        return helpers.apiCall('update_segment', 'POST', JSON.stringify({
                            ItemId: ep.ItemId,
                            MarkerType: update.marker,
                            Ticks: update.ticks
                        }));
                    }
                });
            });

            chain
                .then(function () {
                    helpers.hideLoading();
                    helpers.showSuccess('Segments updated successfully.');
                    // Refresh the episode data for this season
                    refreshRow(row, ep);
                })
                .catch(function (error) {
                    helpers.hideLoading();
                    console.error('Failed to save segments:', error);
                    helpers.showError('Failed to save segment changes.');
                });
        }

        function cancelEdit(row, ep) {
            row.classList.remove('editing');
            row.style.backgroundColor = bulkSource && bulkSource.ItemId === ep.ItemId
                ? 'rgba(33, 150, 243, 0.1)'
                : '';

            // Restore tick cells
            var tickCells = row.querySelectorAll('.tick-cell');
            tickCells.forEach(function (cell) {
                var originalDisplay = cell.getAttribute('data-original-display');
                cell.innerHTML = originalDisplay || helpers.ticksToTime(null);
            });

            // Restore action buttons
            var actionsCell = row.querySelector('td:last-child');
            actionsCell.innerHTML = buildActionButtons(ep);
            attachRowActions(row, ep);

            editingRow = null;
        }

        function cancelCurrentEdit() {
            if (editingRow) {
                // Find the episode data from the row's item ID
                var itemId = editingRow.getAttribute('data-item-id');
                var ep = findEpisodeByItemId(itemId);
                if (ep) {
                    cancelEdit(editingRow, ep);
                }
            }
        }

        function refreshRow(row, ep) {
            // Re-fetch the single item to get updated ticks
            helpers.apiCall('item_segments?itemId=' + encodeURIComponent(ep.ItemId), 'GET')
                .then(function (data) {
                    if (data && data.length > 0) {
                        var updated = data[0];
                        // Update cached data
                        ep.IntroStartTicks = updated.IntroStartTicks;
                        ep.IntroEndTicks = updated.IntroEndTicks;
                        ep.CreditsStartTicks = updated.CreditsStartTicks;
                        ep.HasIntro = updated.HasIntro;
                        ep.HasCredits = updated.HasCredits;
                    }

                    // Rebuild the row in-place
                    var newRow = createEpisodeRow(ep);
                    row.parentNode.replaceChild(newRow, row);
                    editingRow = null;
                })
                .catch(function () {
                    // Fallback: just cancel the edit state
                    cancelEdit(row, ep);
                });
        }

        // ── Delete ──

        function showDeleteMenu(row, ep, buttonEl) {
            // Build a simple inline dropdown for segment type selection
            var existing = row.querySelector('.delete-menu');
            if (existing) {
                existing.remove();
                return;
            }

            var menu = document.createElement('div');
            menu.className = 'delete-menu';
            menu.style.cssText = 'position: absolute; background: #333; border: 1px solid #555; border-radius: 4px; padding: 0.3em 0; z-index: 100; min-width: 140px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);';

            var types = [
                { marker: 'IntroStart', label: 'IntroStart', ticks: ep.IntroStartTicks },
                { marker: 'IntroEnd', label: 'IntroEnd', ticks: ep.IntroEndTicks },
                { marker: 'CreditsStart', label: 'CreditsStart', ticks: ep.CreditsStartTicks }
            ];

            types.forEach(function (t) {
                if (!t.ticks) return;  // Skip segments that don't exist

                var item = document.createElement('div');
                item.style.cssText = 'padding: 0.4em 1em; cursor: pointer;';
                item.textContent = t.label;
                item.addEventListener('mouseenter', function () { this.style.backgroundColor = 'rgba(255,255,255,0.1)'; });
                item.addEventListener('mouseleave', function () { this.style.backgroundColor = ''; });
                item.addEventListener('click', function (e) {
                    e.stopPropagation();
                    menu.remove();
                    confirmDelete(row, ep, t.marker);
                });
                menu.appendChild(item);
            });

            // If no segments exist to delete
            if (menu.children.length === 0) {
                helpers.showError('No segments to delete on this episode.');
                return;
            }

            // Position relative to button
            buttonEl.style.position = 'relative';
            buttonEl.parentNode.style.position = 'relative';
            buttonEl.parentNode.appendChild(menu);

            // Close menu when clicking elsewhere
            var closeHandler = function (e) {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(function () {
                document.addEventListener('click', closeHandler);
            }, 0);
        }

        function confirmDelete(row, ep, markerType) {
            var msg = 'Delete ' + markerType + ' segment from "' + (ep.ItemName || 'this episode') + '"?';
            if (confirm(msg)) {
                helpers.showLoading();
                helpers.apiCall('delete_segment', 'POST', JSON.stringify({
                    ItemId: ep.ItemId,
                    MarkerType: markerType
                }))
                .then(function () {
                    helpers.hideLoading();
                    helpers.showSuccess(markerType + ' deleted successfully.');
                    refreshRow(row, ep);
                })
                .catch(function (error) {
                    helpers.hideLoading();
                    console.error('Failed to delete segment:', error);
                    helpers.showError('Failed to delete segment.');
                });
            }
        }

        // ── Bulk Copy Source ──

        function markAsCopySource(ep) {
            bulkSource = {
                ItemId: ep.ItemId,
                ItemName: ep.ItemName,
                EpisodeNumber: ep.EpisodeNumber,
                IntroStartTicks: ep.IntroStartTicks,
                IntroEndTicks: ep.IntroEndTicks,
                CreditsStartTicks: ep.CreditsStartTicks
            };

            // Update banner
            var banner = view.querySelector('#bulkSourceBanner');
            var bannerText = view.querySelector('#bulkSourceText');
            bannerText.textContent = 'Bulk source: Episode ' + (ep.EpisodeNumber || '?') + ' — ' + (ep.ItemName || 'Unknown');
            banner.style.display = 'block';

            // Re-highlight rows — refresh all visible tables
            var allRows = view.querySelectorAll('tr[data-item-id]');
            allRows.forEach(function (row) {
                var itemId = row.getAttribute('data-item-id');
                if (itemId === ep.ItemId) {
                    row.style.backgroundColor = 'rgba(33, 150, 243, 0.1)';
                } else {
                    if (!row.classList.contains('editing')) {
                        row.style.backgroundColor = '';
                    }
                }
            });
        }

        function clearBulkSource() {
            bulkSource = null;
            view.querySelector('#bulkSourceBanner').style.display = 'none';

            // Clear highlighting
            var allRows = view.querySelectorAll('tr[data-item-id]');
            allRows.forEach(function (row) {
                if (!row.classList.contains('editing')) {
                    row.style.backgroundColor = '';
                }
            });
        }

        // ── Helpers ──

        function findEpisodeByItemId(itemId) {
            var keys = Object.keys(loadedSeasons);
            for (var i = 0; i < keys.length; i++) {
                var episodes = loadedSeasons[keys[i]];
                for (var j = 0; j < episodes.length; j++) {
                    if (episodes[j].ItemId === itemId) {
                        return episodes[j];
                    }
                }
            }
            return null;
        }

        function handleBackClick() {
            if (libraryId) {
                helpers.navigate('segment_library', { libraryId: libraryId });
            } else {
                helpers.navigate('segment_dashboard', {});
            }
        }

        // ── View Lifecycle ──

        view.addEventListener('viewshow', function () {
            seriesId = helpers.getQueryParam('seriesId');

            if (!seriesId) {
                helpers.showError('No series ID provided. Please navigate from the library page.');
                return;
            }

            helpers.clearNavParams();

            loadSeasons();

            // Attach event listeners
            var btnBack = view.querySelector('#btnBackToLibrary');
            if (btnBack) {
                btnBack.addEventListener('click', handleBackClick);
            }

            var btnClearSource = view.querySelector('#btnClearBulkSource');
            if (btnClearSource) {
                btnClearSource.addEventListener('click', clearBulkSource);
            }
        });

        view.addEventListener('viewhide', function () {
            if (chart) {
                chart.destroy();
                chart = null;
            }
        });

        view.addEventListener('viewdestroy', function () {
            if (chart) {
                chart.destroy();
                chart = null;
            }
        });
    };
});
