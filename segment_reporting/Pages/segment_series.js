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
        var seriesId = null;
        var libraryId = null;
        var libraryName = null;
        var seriesName = null;
        var seasonData = [];
        var loadedSeasons = {};  // seasonId -> episode array (lazy-load cache)
        var chart = null;
        var bulkSource = null;  // { ItemId, ItemName, IntroStartTicks, IntroEndTicks, CreditsStartTicks }
        var editingRow = null;  // currently editing row element (only one at a time)
        var selectedItems = {};  // seasonId -> { itemId: true } for multi-select
        var listenersAttached = false;
        var creditsDetectorAvailable = false;

        // ── Data Loading ──

        function loadSeasons() {
            helpers.apiCallWithLoading('season_list?seriesId=' + encodeURIComponent(seriesId), 'GET')
                .then(function (data) {
                    seasonData = data || [];

                    // Update title, libraryId, and breadcrumbs from season list response
                    if (seasonData.length > 0) {
                        if (seasonData[0].SeriesName) {
                            seriesName = seasonData[0].SeriesName;
                            view.querySelector('#pageTitle').textContent = seriesName;
                        }
                        if (!libraryId && seasonData[0].LibraryId) {
                            libraryId = seasonData[0].LibraryId;
                        }
                    }

                    renderBreadcrumbs();

                    updateSeasonChart();
                    renderSeasonAccordion();
                })
                .catch(function () {});
        }

        function loadEpisodes(seasonId, contentDiv) {
            if (loadedSeasons[seasonId]) {
                renderEpisodeTable(loadedSeasons[seasonId], contentDiv);
                return;
            }

            contentDiv.innerHTML = '<div style="text-align: center; padding: 1em;">Loading episodes...</div>';

            var epEndpoint = 'episode_list?seasonId=' + encodeURIComponent(seasonId) +
                '&seriesId=' + encodeURIComponent(seriesId);

            helpers.apiCall(epEndpoint, 'GET')
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
            require([Dashboard.getConfigurationResourceUrl('segment_reporting_chart.min.js')], function (Chart) {
                var ctx = view.querySelector('#seasonChart').getContext('2d');
                var themeColors = helpers.getThemeColors(view);
                var palette = themeColors.chart;

                var labels = seasonData.map(function (s) {
                    return s.SeasonName || ('Season ' + (s.SeasonNumber || 1));
                });

                var introPct = seasonData.map(function (s) {
                    var total = s.TotalEpisodes || 0;
                    return total > 0 ? parseFloat(((s.WithIntro || 0) / total * 100).toFixed(1)) : 0;
                });
                var creditsPct = seasonData.map(function (s) {
                    var total = s.TotalEpisodes || 0;
                    return total > 0 ? parseFloat(((s.WithCredits || 0) / total * 100).toFixed(1)) : 0;
                });

                if (chart) {
                    chart.destroy();
                }

                chart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [
                            { label: 'Intro Coverage', data: introPct, backgroundColor: palette.introOnly, borderColor: palette.introOnly, borderWidth: 1 },
                            { label: 'Credit Coverage', data: creditsPct, backgroundColor: palette.creditsOnly, borderColor: palette.creditsOnly, borderWidth: 1 }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            legend: { position: 'bottom', labels: { color: themeColors.text } },
                            tooltip: {
                                mode: 'index',
                                intersect: false,
                                callbacks: {
                                    label: function (context) {
                                        return context.dataset.label + ': ' + context.parsed.y + '%';
                                    },
                                    footer: function (tooltipItems) {
                                        var idx = tooltipItems[0].dataIndex;
                                        var s = seasonData[idx];
                                        return 'Intros: ' + (s.WithIntro || 0) + '/' + (s.TotalEpisodes || 0) +
                                               '  Credits: ' + (s.WithCredits || 0) + '/' + (s.TotalEpisodes || 0);
                                    }
                                }
                            }
                        },
                        scales: {
                            x: { ticks: { color: themeColors.text }, grid: { color: themeColors.gridColor } },
                            y: {
                                min: 0, max: 100,
                                ticks: {
                                    color: themeColors.text,
                                    callback: function (value) { return value + '%'; }
                                },
                                grid: { color: themeColors.gridColor }
                            }
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
                var introPct = helpers.percentage(introCount, totalEp);
                var creditsPct = helpers.percentage(creditsCount, totalEp);

                // Season header (clickable)
                var header = document.createElement('div');
                header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 0.75em 1em; background-color: rgba(255,255,255,0.05); border-radius: 4px; cursor: pointer; user-select: none;';
                var seasonLabel = season.SeasonName || ('Season ' + (season.SeasonNumber || 1));

                header.innerHTML =
                    '<div style="display: flex; align-items: center; gap: 1em;">' +
                        '<span style="font-size: 1.1em; font-weight: bold;">' + seasonLabel + '</span>' +
                        '<span style="opacity: 0.7;">' + totalEp + ' episodes</span>' +
                        '<span style="opacity: 0.7;">Intros: ' + introCount + '/' + totalEp + '</span>' +
                        '<span style="opacity: 0.7;">Credits: ' + creditsCount + '/' + totalEp + '</span>' +
                    '</div>' +
                    '<div style="display: flex; align-items: center; gap: 1em;">' +
                        '<strong>Intros: ' + introPct + '</strong>' +
                        '<strong>Credits: ' + creditsPct + '</strong>' +
                        (creditsDetectorAvailable
                            ? '<button class="raised emby-button btn-season-detect" title="Detect credits for all episodes in this season" style="padding: 0.2em 0.6em; font-size: 0.8em;"><span>Detect</span></button>'
                            : '') +
                        '<span class="seasonToggle" style="font-size: 1.2em;">&#9654;</span>' +
                    '</div>';

                // Season-level detect button handler
                var btnSeasonDetect = header.querySelector('.btn-season-detect');
                if (btnSeasonDetect) {
                    btnSeasonDetect.addEventListener('click', function (e) {
                        e.stopPropagation();
                        detectCreditsForSeason(season.SeasonId, btnSeasonDetect);
                    });
                }

                helpers.attachHoverEffect(header, 'rgba(128,128,128,0.15)', 'rgba(255,255,255,0.05)');

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
            var seasonId = container.getAttribute('data-season-id');

            if (episodes.length === 0) {
                container.innerHTML = '<div style="text-align: center; padding: 1em; opacity: 0.7;">No episodes found.</div>';
                return;
            }

            // Initialize selection tracking for this season
            if (!selectedItems[seasonId]) {
                selectedItems[seasonId] = {};
            }

            // Bulk action row
            var bulkRow = createBulkActionRow(seasonId, episodes, container);
            container.appendChild(bulkRow);

            var table = document.createElement('table');
            table.style.cssText = 'width: 100%; border-collapse: collapse;';

            // Header with checkbox
            var thStyle = 'padding: 0.5em; border-bottom: 1px solid rgba(128,128,128,0.3);';
            var thead = document.createElement('thead');
            thead.innerHTML =
                '<tr>' +
                    '<th style="' + thStyle + ' text-align: center; width: 40px;"><input type="checkbox" class="select-all-cb" title="Select all"></th>' +
                    '<th style="' + thStyle + ' text-align: left;">#</th>' +
                    '<th style="' + thStyle + ' text-align: left;">Episode Name</th>' +
                    '<th style="' + thStyle + ' text-align: center;">IntroStart</th>' +
                    '<th style="' + thStyle + ' text-align: center;">IntroEnd</th>' +
                    '<th style="' + thStyle + ' text-align: center;">CreditsStart</th>' +
                    '<th style="' + thStyle + ' text-align: center;">Actions</th>' +
                '</tr>';

            // Select-all handler
            var selectAllCb = thead.querySelector('.select-all-cb');
            selectAllCb.addEventListener('change', function () {
                toggleSelectAll(seasonId, this.checked, episodes, container);
            });

            table.appendChild(thead);

            // Body
            var tbody = document.createElement('tbody');
            episodes.forEach(function (ep) {
                var row = createEpisodeRow(ep, seasonId);
                tbody.appendChild(row);
            });
            table.appendChild(tbody);

            container.appendChild(table);

            helpers.applyTableStyles(table);
        }

        function createEpisodeRow(ep, seasonId) {
            var row = document.createElement('tr');
            row.setAttribute('data-item-id', ep.ItemId);
            row.style.borderBottom = '1px solid rgba(128,128,128,0.15)';

            // Highlight if this is the bulk source
            if (bulkSource && bulkSource.ItemId === ep.ItemId) {
                row.style.backgroundColor = 'rgba(33, 150, 243, 0.1)';
            }

            var cellStyle = 'padding: 0.5em; ';
            var centerStyle = cellStyle + 'text-align: center; ';
            var isChecked = selectedItems[seasonId] && selectedItems[seasonId][ep.ItemId];

            row.innerHTML =
                '<td style="' + centerStyle + 'width: 40px;"><input type="checkbox" class="row-select-cb"' + (isChecked ? ' checked' : '') + '></td>' +
                '<td style="' + cellStyle + '">' + (ep.EpisodeNumber || '-') + '</td>' +
                '<td style="' + cellStyle + '">' + helpers.escHtml(ep.ItemName || 'Unknown') + '</td>' +
                '<td class="tick-cell" data-marker="IntroStart" style="' + centerStyle + '">' + helpers.renderTimestamp(ep.IntroStartTicks, ep.ItemId) + '</td>' +
                '<td class="tick-cell" data-marker="IntroEnd" style="' + centerStyle + '">' + helpers.renderTimestamp(ep.IntroEndTicks, ep.ItemId) + '</td>' +
                '<td class="tick-cell" data-marker="CreditsStart" style="' + centerStyle + '">' + helpers.renderTimestamp(ep.CreditsStartTicks, ep.ItemId) + '</td>' +
                '<td style="' + centerStyle + '">' + buildActionButtons(ep) + '</td>';

            // Row checkbox handler
            var cb = row.querySelector('.row-select-cb');
            cb.addEventListener('change', function () {
                toggleRowSelect(seasonId, ep.ItemId, this.checked, row);
            });

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

            // Timestamp playback click handlers
            row.addEventListener('click', function (e) {
                var link = e.target.closest('.timestamp-link');
                if (!link) return;
                if (row.classList.contains('editing')) return;
                e.preventDefault();
                var ticks = parseInt(link.getAttribute('data-ticks'), 10);
                var itemId = link.getAttribute('data-item-id');
                helpers.launchPlayback(itemId, ticks);
            });

            return row;
        }

        function buildActionButtons(ep) {
            var html = '<button class="raised emby-button btn-edit" title="Edit segments" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Edit</button>' +
                   '<button class="raised emby-button btn-delete" title="Delete a segment" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Delete</button>' +
                   '<button class="raised emby-button btn-copy" title="Mark as bulk copy source" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Copy</button>' +
                   '<button class="raised emby-button btn-end-credits" title="Set CreditsStart to end of episode" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">End</button>';
            if (creditsDetectorAvailable) {
                html += '<button class="raised emby-button btn-detect-credits" title="Detect credits for this episode using EmbyCredits" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Detect</button>';
            }
            return html;
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

            var btnEndCredits = row.querySelector('.btn-end-credits');
            if (btnEndCredits) {
                btnEndCredits.addEventListener('click', function (e) {
                    e.stopPropagation();
                    setCreditsToEnd(row, ep);
                });
            }

            var btnDetect = row.querySelector('.btn-detect-credits');
            if (btnDetect) {
                btnDetect.addEventListener('click', function (e) {
                    e.stopPropagation();
                    detectCreditsForEpisode(row, ep);
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

            // Restore tick cells with clickable timestamps
            var tickCells = row.querySelectorAll('.tick-cell');
            tickCells.forEach(function (cell) {
                var marker = cell.getAttribute('data-marker');
                var ticks = ep[marker + 'Ticks'];
                cell.innerHTML = helpers.renderTimestamp(ticks, ep.ItemId);
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
                    if (data && !data.error) {
                        // Update cached data
                        ep.IntroStartTicks = data.IntroStartTicks;
                        ep.IntroEndTicks = data.IntroEndTicks;
                        ep.CreditsStartTicks = data.CreditsStartTicks;
                        ep.HasIntro = data.HasIntro;
                        ep.HasCredits = data.HasCredits;
                    }

                    // Rebuild the row in-place
                    var container = row.closest('[data-season-id]');
                    var seasonId = container ? container.getAttribute('data-season-id') : null;
                    var newRow = createEpisodeRow(ep, seasonId);
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

            // Show the "Apply Source" button in all bulk action rows
            updateAllBulkApplyButtons();
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

            // Hide the "Apply Source" button in all bulk action rows
            updateAllBulkApplyButtons();
        }

        // ── Bulk Operations ──

        function createBulkActionRow(seasonId, episodes, container) {
            var row = document.createElement('div');
            row.className = 'bulk-action-row';
            row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 0.5em 0.75em; margin-bottom: 0.5em; background-color: rgba(255,255,255,0.03); border-radius: 4px; flex-wrap: wrap; gap: 0.5em;';

            var leftSide = document.createElement('div');
            leftSide.style.cssText = 'display: flex; align-items: center; gap: 0.75em;';

            var selectionInfo = document.createElement('span');
            selectionInfo.className = 'selection-info';
            selectionInfo.style.cssText = 'font-size: 0.9em; opacity: 0.8;';
            selectionInfo.textContent = episodes.length + ' episodes';
            leftSide.appendChild(selectionInfo);

            var rightSide = document.createElement('div');
            rightSide.style.cssText = 'display: flex; align-items: center; gap: 0.5em; flex-wrap: wrap;';

            // Apply Source button (only visible when bulk source is set)
            var btnApply = document.createElement('button');
            btnApply.className = 'raised emby-button btn-bulk-apply';
            btnApply.style.cssText = 'padding: 0.3em 0.8em; font-size: 0.85em;' + (bulkSource ? '' : ' display: none;');
            btnApply.textContent = 'Apply Source to All';
            btnApply.addEventListener('click', function () {
                executeBulkApply(seasonId, episodes, container);
            });

            // Delete Intros button
            var btnDeleteIntro = document.createElement('button');
            btnDeleteIntro.className = 'raised emby-button btn-bulk-delete-intro';
            btnDeleteIntro.style.cssText = 'padding: 0.3em 0.8em; font-size: 0.85em;';
            btnDeleteIntro.textContent = 'Delete All Intros';
            btnDeleteIntro.addEventListener('click', function () {
                executeBulkDelete(seasonId, episodes, container, ['IntroStart', 'IntroEnd']);
            });

            // Delete Credits button
            var btnDeleteCredits = document.createElement('button');
            btnDeleteCredits.className = 'raised emby-button btn-bulk-delete-credits';
            btnDeleteCredits.style.cssText = 'padding: 0.3em 0.8em; font-size: 0.85em;';
            btnDeleteCredits.textContent = 'Delete All Credits';
            btnDeleteCredits.addEventListener('click', function () {
                executeBulkDelete(seasonId, episodes, container, ['CreditsStart']);
            });

            // Set Credits to End button
            var btnCreditsEnd = document.createElement('button');
            btnCreditsEnd.className = 'raised emby-button btn-bulk-credits-end';
            btnCreditsEnd.style.cssText = 'padding: 0.3em 0.8em; font-size: 0.85em;';
            btnCreditsEnd.textContent = 'Set All Credits to End';
            btnCreditsEnd.title = 'Set CreditsStart to runtime end for each episode';
            btnCreditsEnd.addEventListener('click', function () {
                executeBulkSetCreditsEnd(seasonId, episodes, container);
            });

            // Detect Credits button (only visible when EmbyCredits is available)
            var btnDetectCredits = document.createElement('button');
            btnDetectCredits.className = 'raised emby-button btn-bulk-detect-credits';
            btnDetectCredits.style.cssText = 'padding: 0.3em 0.8em; font-size: 0.85em;' + (creditsDetectorAvailable ? '' : ' display: none;');
            btnDetectCredits.textContent = 'Detect All Credits';
            btnDetectCredits.title = 'Detect credits for episodes using EmbyCredits';
            btnDetectCredits.addEventListener('click', function () {
                executeBulkDetectCredits(seasonId, episodes, container);
            });

            rightSide.appendChild(btnApply);
            rightSide.appendChild(btnDeleteIntro);
            rightSide.appendChild(btnDeleteCredits);
            rightSide.appendChild(btnCreditsEnd);
            rightSide.appendChild(btnDetectCredits);

            row.appendChild(leftSide);
            row.appendChild(rightSide);

            return row;
        }

        function toggleSelectAll(seasonId, checked, episodes, container) {
            if (!selectedItems[seasonId]) {
                selectedItems[seasonId] = {};
            }

            episodes.forEach(function (ep) {
                if (checked) {
                    selectedItems[seasonId][ep.ItemId] = true;
                } else {
                    delete selectedItems[seasonId][ep.ItemId];
                }
            });

            // Update all row checkboxes
            var checkboxes = container.querySelectorAll('.row-select-cb');
            checkboxes.forEach(function (cb) {
                cb.checked = checked;
            });

            updateBulkActionRow(seasonId, episodes, container);
        }

        function toggleRowSelect(seasonId, itemId, checked, row) {
            if (!selectedItems[seasonId]) {
                selectedItems[seasonId] = {};
            }

            if (checked) {
                selectedItems[seasonId][itemId] = true;
            } else {
                delete selectedItems[seasonId][itemId];
            }

            var container = row.closest('[data-season-id]');
            if (container) {
                var episodes = loadedSeasons[seasonId] || [];
                updateBulkActionRow(seasonId, episodes, container);

                // Update select-all checkbox state
                var selectAllCb = container.querySelector('.select-all-cb');
                if (selectAllCb) {
                    var selectedCount = Object.keys(selectedItems[seasonId]).length;
                    selectAllCb.checked = selectedCount === episodes.length;
                    selectAllCb.indeterminate = selectedCount > 0 && selectedCount < episodes.length;
                }
            }
        }

        function updateBulkActionRow(seasonId, episodes, container) {
            var bulkRow = container.querySelector('.bulk-action-row');
            if (!bulkRow) return;

            var selectedCount = selectedItems[seasonId] ? Object.keys(selectedItems[seasonId]).length : 0;
            var selectionInfo = bulkRow.querySelector('.selection-info');
            var btnApply = bulkRow.querySelector('.btn-bulk-apply');
            var btnDeleteIntro = bulkRow.querySelector('.btn-bulk-delete-intro');
            var btnDeleteCredits = bulkRow.querySelector('.btn-bulk-delete-credits');
            var btnCreditsEnd = bulkRow.querySelector('.btn-bulk-credits-end');
            var btnDetect = bulkRow.querySelector('.btn-bulk-detect-credits');

            if (selectedCount > 0) {
                selectionInfo.textContent = selectedCount + ' of ' + episodes.length + ' selected';
                if (btnApply) {
                    btnApply.textContent = 'Apply Source to Selected (' + selectedCount + ')';
                    btnApply.style.display = bulkSource ? '' : 'none';
                }
                if (btnDeleteIntro) btnDeleteIntro.textContent = 'Delete Intros (' + selectedCount + ')';
                if (btnDeleteCredits) btnDeleteCredits.textContent = 'Delete Credits (' + selectedCount + ')';
                if (btnCreditsEnd) btnCreditsEnd.textContent = 'Set Credits to End (' + selectedCount + ')';
                if (btnDetect) btnDetect.textContent = 'Detect Credits (' + selectedCount + ')';
            } else {
                selectionInfo.textContent = episodes.length + ' episodes';
                if (btnApply) {
                    btnApply.textContent = 'Apply Source to All';
                    btnApply.style.display = bulkSource ? '' : 'none';
                }
                if (btnDeleteIntro) btnDeleteIntro.textContent = 'Delete All Intros';
                if (btnDeleteCredits) btnDeleteCredits.textContent = 'Delete All Credits';
                if (btnCreditsEnd) btnCreditsEnd.textContent = 'Set All Credits to End';
                if (btnDetect) btnDetect.textContent = 'Detect All Credits';
            }
        }

        function updateAllBulkApplyButtons() {
            var applyButtons = view.querySelectorAll('.btn-bulk-apply');
            applyButtons.forEach(function (btn) {
                btn.style.display = bulkSource ? '' : 'none';
            });
        }

        function executeBulkApply(seasonId, episodes, container) {
            if (!bulkSource) {
                helpers.showError('No source episode selected. Click "Copy" on an episode first.');
                return;
            }

            var selectedCount = selectedItems[seasonId] ? Object.keys(selectedItems[seasonId]).length : 0;
            var targetEpisodes;

            if (selectedCount > 0) {
                targetEpisodes = episodes.filter(function (ep) {
                    return selectedItems[seasonId][ep.ItemId] && ep.ItemId !== bulkSource.ItemId;
                });
            } else {
                targetEpisodes = episodes.filter(function (ep) {
                    return ep.ItemId !== bulkSource.ItemId;
                });
            }

            if (targetEpisodes.length === 0) {
                helpers.showError('No target episodes to apply to.');
                return;
            }

            // Build confirmation message
            var sourceLabel = 'E' + (bulkSource.EpisodeNumber || '?') + ' "' + (bulkSource.ItemName || 'Unknown') + '"';
            var segments = [];
            if (bulkSource.IntroStartTicks) segments.push('IntroStart (' + helpers.ticksToTime(bulkSource.IntroStartTicks) + ')');
            if (bulkSource.IntroEndTicks) segments.push('IntroEnd (' + helpers.ticksToTime(bulkSource.IntroEndTicks) + ')');
            if (bulkSource.CreditsStartTicks) segments.push('CreditsStart (' + helpers.ticksToTime(bulkSource.CreditsStartTicks) + ')');

            if (segments.length === 0) {
                helpers.showError('Source episode has no segments to copy.');
                return;
            }

            var msg = 'Copy segments from ' + sourceLabel + ' to ' + targetEpisodes.length + ' episode(s)?\n\n' +
                      'Segments: ' + segments.join(', ');

            if (!confirm(msg)) return;

            var targetIds = targetEpisodes.map(function (ep) { return ep.ItemId; }).join(',');
            var markerTypes = [];
            if (bulkSource.IntroStartTicks) markerTypes.push('IntroStart');
            if (bulkSource.IntroEndTicks) markerTypes.push('IntroEnd');
            if (bulkSource.CreditsStartTicks) markerTypes.push('CreditsStart');

            helpers.showLoading();

            helpers.apiCall('bulk_apply', 'POST', JSON.stringify({
                SourceItemId: bulkSource.ItemId,
                TargetItemIds: targetIds,
                MarkerTypes: markerTypes.join(',')
            }))
            .then(function (result) {
                helpers.hideLoading();
                var resultMsg = 'Bulk apply complete: ' + result.succeeded + ' succeeded';
                if (result.failed > 0) {
                    resultMsg += ', ' + result.failed + ' failed';
                    if (result.errors && result.errors.length > 0) {
                        resultMsg += '\n\nErrors:\n' + result.errors.join('\n');
                    }
                    helpers.showError(resultMsg);
                } else {
                    helpers.showSuccess(resultMsg);
                }
                refreshSeasonEpisodes(seasonId, container);
            })
            .catch(function (error) {
                helpers.hideLoading();
                console.error('Bulk apply failed:', error);
                helpers.showError('Bulk apply failed: ' + (error.message || 'Unknown error'));
            });
        }

        function executeBulkDelete(seasonId, episodes, container, markerTypes) {
            var selectedCount = selectedItems[seasonId] ? Object.keys(selectedItems[seasonId]).length : 0;
            var targetEpisodes;

            if (selectedCount > 0) {
                targetEpisodes = episodes.filter(function (ep) {
                    return selectedItems[seasonId][ep.ItemId];
                });
            } else {
                targetEpisodes = episodes;
            }

            if (targetEpisodes.length === 0) {
                helpers.showError('No episodes to delete from.');
                return;
            }

            var typeLabel = markerTypes.indexOf('CreditsStart') >= 0 ? 'credits' : 'intro';
            var msg = 'Delete all ' + typeLabel + ' segments from ' + targetEpisodes.length + ' episode(s) in this season?\n\nThis cannot be undone.';

            if (!confirm(msg)) return;

            var itemIds = targetEpisodes.map(function (ep) { return ep.ItemId; }).join(',');

            helpers.showLoading();

            helpers.apiCall('bulk_delete', 'POST', JSON.stringify({
                ItemIds: itemIds,
                MarkerTypes: markerTypes.join(',')
            }))
            .then(function (result) {
                helpers.hideLoading();
                var resultMsg = 'Bulk delete complete: ' + result.succeeded + ' succeeded';
                if (result.failed > 0) {
                    resultMsg += ', ' + result.failed + ' failed';
                    if (result.errors && result.errors.length > 0) {
                        resultMsg += '\n\nErrors:\n' + result.errors.join('\n');
                    }
                    helpers.showError(resultMsg);
                } else {
                    helpers.showSuccess(resultMsg);
                }
                refreshSeasonEpisodes(seasonId, container);
            })
            .catch(function (error) {
                helpers.hideLoading();
                console.error('Bulk delete failed:', error);
                helpers.showError('Bulk delete failed: ' + (error.message || 'Unknown error'));
            });
        }

        function setCreditsToEnd(row, ep) {
            var msg = 'Set CreditsStart to end of "' + (ep.ItemName || 'this episode') + '"?';
            if (!confirm(msg)) return;

            helpers.showLoading();

            helpers.apiCall('bulk_set_credits_end', 'POST', JSON.stringify({
                ItemIds: ep.ItemId,
                OffsetTicks: 0
            }))
            .then(function (result) {
                helpers.hideLoading();
                if (result.failed > 0) {
                    helpers.showError('Failed: ' + (result.errors && result.errors.length > 0 ? result.errors[0] : 'Unknown error'));
                } else {
                    helpers.showSuccess('CreditsStart set to end of episode.');
                    refreshRow(row, ep);
                }
            })
            .catch(function (error) {
                helpers.hideLoading();
                console.error('Set credits to end failed:', error);
                helpers.showError('Failed to set credits to end.');
            });
        }

        function executeBulkSetCreditsEnd(seasonId, episodes, container) {
            var selectedCount = selectedItems[seasonId] ? Object.keys(selectedItems[seasonId]).length : 0;
            var targetEpisodes;

            if (selectedCount > 0) {
                targetEpisodes = episodes.filter(function (ep) {
                    return selectedItems[seasonId][ep.ItemId];
                });
            } else {
                targetEpisodes = episodes;
            }

            if (targetEpisodes.length === 0) {
                helpers.showError('No episodes to update.');
                return;
            }

            var msg = 'Set CreditsStart to end of episode for ' + targetEpisodes.length + ' episode(s)?\n\nThis marks each episode as having credits at its runtime end.';
            if (!confirm(msg)) return;

            var itemIds = targetEpisodes.map(function (ep) { return ep.ItemId; }).join(',');

            helpers.showLoading();

            helpers.apiCall('bulk_set_credits_end', 'POST', JSON.stringify({
                ItemIds: itemIds,
                OffsetTicks: 0
            }))
            .then(function (result) {
                helpers.hideLoading();
                var resultMsg = 'Set credits to end: ' + result.succeeded + ' succeeded';
                if (result.failed > 0) {
                    resultMsg += ', ' + result.failed + ' failed';
                    if (result.errors && result.errors.length > 0) {
                        resultMsg += '\n\nErrors:\n' + result.errors.join('\n');
                    }
                    helpers.showError(resultMsg);
                } else {
                    helpers.showSuccess(resultMsg);
                }
                refreshSeasonEpisodes(seasonId, container);
            })
            .catch(function (error) {
                helpers.hideLoading();
                console.error('Bulk set credits to end failed:', error);
                helpers.showError('Bulk set credits to end failed: ' + (error.message || 'Unknown error'));
            });
        }

        function executeBulkDetectCredits(seasonId, episodes, container) {
            var selectedCount = selectedItems[seasonId] ? Object.keys(selectedItems[seasonId]).length : 0;
            var targetEpisodes;

            if (selectedCount > 0) {
                targetEpisodes = episodes.filter(function (ep) {
                    return selectedItems[seasonId][ep.ItemId];
                });
            } else {
                targetEpisodes = episodes.slice();
            }

            if (targetEpisodes.length === 0) {
                helpers.showError('No episodes to detect credits for.');
                return;
            }

            // Check for episodes that already have credits
            var withCredits = targetEpisodes.filter(function (ep) { return ep.CreditsStartTicks > 0; });
            var withoutCredits = targetEpisodes.filter(function (ep) { return !ep.CreditsStartTicks || ep.CreditsStartTicks === 0; });

            if (withCredits.length > 0 && withoutCredits.length > 0) {
                var skipExisting = confirm(
                    withCredits.length + ' of ' + targetEpisodes.length + ' episodes already have credits detected.\n\n' +
                    'Click OK to skip these and detect only the remaining ' + withoutCredits.length + ' episodes.\n' +
                    'Click Cancel to detect for all ' + targetEpisodes.length + ' episodes (overwrites existing).'
                );
                if (skipExisting) {
                    targetEpisodes = withoutCredits;
                }
            } else if (withCredits.length > 0 && withoutCredits.length === 0) {
                if (!confirm('All ' + targetEpisodes.length + ' episodes already have credits detected. Re-detect for all of them?')) {
                    return;
                }
            }

            if (targetEpisodes.length === 0) {
                helpers.showError('No episodes to detect credits for.');
                return;
            }

            if (!confirm('Detect credits for ' + targetEpisodes.length + ' episode(s) using EmbyCredits? This runs in the background and may take a while.')) {
                return;
            }

            helpers.showLoading();

            var succeeded = 0;
            var failed = 0;
            var errors = [];

            var chain = Promise.resolve();
            targetEpisodes.forEach(function (ep) {
                chain = chain.then(function () {
                    return helpers.creditsDetectorCall('ProcessEpisode', { ItemId: ep.ItemId })
                        .then(function () { succeeded++; })
                        .catch(function (err) {
                            failed++;
                            errors.push((ep.ItemName || ep.ItemId) + ': ' + (err.message || 'failed'));
                        });
                });
            });

            chain.then(function () {
                helpers.hideLoading();
                var resultMsg = 'Credits detection queued: ' + succeeded + ' succeeded';
                if (failed > 0) {
                    resultMsg += ', ' + failed + ' failed';
                    if (errors.length > 0) {
                        resultMsg += '\n\nErrors:\n' + errors.join('\n');
                    }
                    helpers.showError(resultMsg);
                } else {
                    helpers.showSuccess(resultMsg + '. Results will appear after the next sync.');
                }
            });
        }

        function refreshSeasonEpisodes(seasonId, container) {
            // Clear cache and selection, then reload
            delete loadedSeasons[seasonId];
            if (selectedItems[seasonId]) {
                selectedItems[seasonId] = {};
            }
            loadEpisodes(seasonId, container);

            // Refresh the season chart (coverage stats may have changed)
            helpers.apiCall('season_list?seriesId=' + encodeURIComponent(seriesId), 'GET')
                .then(function (data) {
                    seasonData = data || [];
                    updateSeasonChart();
                })
                .catch(function () {
                    // Non-critical
                });
        }

        // ── EmbyCredits Integration ──

        function detectCreditsForSeries() {
            if (!seriesId) return;

            var btn = view.querySelector('#btnDetectCreditsSeries');
            helpers.withButtonLoading(btn, 'Detecting...',
                helpers.creditsDetectorCall('ProcessSeries', { SeriesId: seriesId })
                    .then(function () {
                        helpers.showSuccess('Credits detection queued for this series. Results will appear after the next sync.');
                    })
                    .catch(function (error) {
                        console.error('Credits detection failed:', error);
                        helpers.showError('Credits detection failed. Is EmbyCredits running?');
                    })
            );
        }

        function detectCreditsForSeason(seasonId, btn) {
            var epEndpoint = 'episode_list?seasonId=' + encodeURIComponent(seasonId) +
                '&seriesId=' + encodeURIComponent(seriesId);

            // Load episodes if not cached, then run bulk detect
            var episodesPromise = loadedSeasons[seasonId]
                ? Promise.resolve(loadedSeasons[seasonId])
                : helpers.apiCall(epEndpoint, 'GET').then(function (episodes) {
                    episodes = (episodes || []).sort(function (a, b) {
                        return (a.EpisodeNumber || 0) - (b.EpisodeNumber || 0);
                    });
                    loadedSeasons[seasonId] = episodes;
                    return episodes;
                });

            helpers.withButtonLoading(btn, '...',
                episodesPromise.then(function (episodes) {
                    if (!episodes || episodes.length === 0) {
                        helpers.showError('No episodes found for this season.');
                        return;
                    }

                    var targetEpisodes = episodes.slice();
                    var withCredits = targetEpisodes.filter(function (ep) { return ep.CreditsStartTicks > 0; });
                    var withoutCredits = targetEpisodes.filter(function (ep) { return !ep.CreditsStartTicks || ep.CreditsStartTicks === 0; });

                    if (withCredits.length > 0 && withoutCredits.length > 0) {
                        var skipExisting = confirm(
                            withCredits.length + ' of ' + targetEpisodes.length + ' episodes already have credits detected.\n\n' +
                            'Click OK to skip these and detect only the remaining ' + withoutCredits.length + ' episodes.\n' +
                            'Click Cancel to detect for all ' + targetEpisodes.length + ' episodes (overwrites existing).'
                        );
                        if (skipExisting) {
                            targetEpisodes = withoutCredits;
                        }
                    } else if (withCredits.length > 0 && withoutCredits.length === 0) {
                        if (!confirm('All ' + targetEpisodes.length + ' episodes already have credits detected. Re-detect for all of them?')) {
                            return;
                        }
                    }

                    if (targetEpisodes.length === 0) {
                        helpers.showError('No episodes to detect credits for.');
                        return;
                    }

                    if (!confirm('Detect credits for ' + targetEpisodes.length + ' episode(s) using EmbyCredits? This runs in the background and may take a while.')) {
                        return;
                    }

                    helpers.showLoading();

                    var succeeded = 0;
                    var failed = 0;
                    var errors = [];

                    var chain = Promise.resolve();
                    targetEpisodes.forEach(function (ep) {
                        chain = chain.then(function () {
                            return helpers.creditsDetectorCall('ProcessEpisode', { ItemId: ep.ItemId })
                                .then(function () { succeeded++; })
                                .catch(function (err) {
                                    failed++;
                                    errors.push((ep.ItemName || ep.ItemId) + ': ' + (err.message || 'failed'));
                                });
                        });
                    });

                    return chain.then(function () {
                        helpers.hideLoading();
                        var resultMsg = 'Credits detection queued: ' + succeeded + ' succeeded';
                        if (failed > 0) {
                            resultMsg += ', ' + failed + ' failed';
                            if (errors.length > 0) {
                                resultMsg += '\n\nErrors:\n' + errors.join('\n');
                            }
                            helpers.showError(resultMsg);
                        } else {
                            helpers.showSuccess(resultMsg + '. Results will appear after the next sync.');
                        }
                    });
                })
                .catch(function (error) {
                    console.error('Failed to load episodes for detection:', error);
                    helpers.showError('Failed to load episodes for this season.');
                })
            );
        }

        function detectCreditsForEpisode(row, ep) {
            var btn = row.querySelector('.btn-detect-credits');
            if (!btn) return;

            helpers.withButtonLoading(btn, '...',
                helpers.creditsDetectorCall('ProcessEpisode', { ItemId: ep.ItemId })
                    .then(function () {
                        helpers.showSuccess('Credits detection queued for "' + (ep.ItemName || 'this episode') + '". Results will appear after the next sync.');
                    })
                    .catch(function (error) {
                        console.error('Credits detection failed:', error);
                        helpers.showError('Credits detection failed for this episode.');
                    })
            );
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

        function renderBreadcrumbs() {
            var bc = view.querySelector('#breadcrumbContainer');
            if (!bc) return;

            var crumbs = [
                { label: 'Dashboard', page: 'segment_dashboard', params: {} }
            ];

            if (libraryId) {
                crumbs.push({
                    label: libraryName || 'Library',
                    page: 'segment_library',
                    params: { libraryId: libraryId, libraryName: libraryName }
                });
            }

            crumbs.push({ label: seriesName || 'Series' });

            helpers.renderBreadcrumbs(bc, crumbs);
        }

        // ── View Lifecycle ──

        view.addEventListener('viewshow', function () {
            seriesId = helpers.getQueryParam('seriesId');
            libraryId = helpers.getQueryParam('libraryId');
            libraryName = helpers.getQueryParam('libraryName');

            if (!seriesId) {
                helpers.showError('No series ID provided. Please navigate from the library page.');
                return;
            }

            if (!listenersAttached) {
                listenersAttached = true;

                var btnClearSource = view.querySelector('#btnClearBulkSource');
                if (btnClearSource) {
                    btnClearSource.addEventListener('click', clearBulkSource);
                }

                var btnDetectSeries = view.querySelector('#btnDetectCreditsSeries');
                if (btnDetectSeries) {
                    btnDetectSeries.addEventListener('click', detectCreditsForSeries);
                }
            }

            // Check for EmbyCredits plugin and show/hide detect button
            helpers.checkCreditsDetector().then(function (available) {
                creditsDetectorAvailable = available;
                var btnDetect = view.querySelector('#btnDetectCreditsSeries');
                if (btnDetect) {
                    btnDetect.style.display = available ? '' : 'none';
                }
            });

            helpers.loadPreferences().then(function () {
                loadSeasons();
            });
        });

        helpers.registerChartCleanup(view, function () { return chart; }, function (v) { chart = v; });
    };
});
