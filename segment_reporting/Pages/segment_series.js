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
        var bulkSource = null;  // { ItemId, ItemName, IntroStartTicks, IntroEndTicks, CreditsStartTicks, copyMode }
        var activeEditor = null;  // current createInlineEditor instance
        var selectedItems = {};  // seasonId -> { itemId: true } for multi-select
        var listenersAttached = false;
        var creditsDetectorAvailable = false;
        var currentFilter = 'all';
        var currentSearch = '';
        var searchDebounceTimer = null;

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

        // ── Episode Filtering ──

        function filterEpisodes(episodes) {
            var filtered = episodes;

            if (currentFilter === 'complete') {
                filtered = filtered.filter(function (ep) {
                    return ep.IntroStartTicks > 0 && ep.CreditsStartTicks > 0;
                });
            } else if (currentFilter === 'missing_intro') {
                filtered = filtered.filter(function (ep) {
                    return !ep.IntroStartTicks || ep.IntroStartTicks === 0 ||
                           !ep.IntroEndTicks || ep.IntroEndTicks === 0;
                });
            } else if (currentFilter === 'missing_credits') {
                filtered = filtered.filter(function (ep) {
                    return !ep.CreditsStartTicks || ep.CreditsStartTicks === 0;
                });
            } else if (currentFilter === 'has_intro') {
                filtered = filtered.filter(function (ep) {
                    return ep.IntroStartTicks > 0;
                });
            } else if (currentFilter === 'has_credits') {
                filtered = filtered.filter(function (ep) {
                    return ep.CreditsStartTicks > 0;
                });
            } else if (currentFilter === 'no_segments') {
                filtered = filtered.filter(function (ep) {
                    return (!ep.IntroStartTicks || ep.IntroStartTicks === 0) &&
                           (!ep.IntroEndTicks || ep.IntroEndTicks === 0) &&
                           (!ep.CreditsStartTicks || ep.CreditsStartTicks === 0);
                });
            }

            if (currentSearch) {
                var searchLower = currentSearch.toLowerCase();
                filtered = filtered.filter(function (ep) {
                    return (ep.ItemName || '').toLowerCase().indexOf(searchLower) >= 0;
                });
            }

            return filtered;
        }

        function refilterAllSeasons() {
            // Clear selections to avoid stale references to hidden rows
            selectedItems = {};

            var containers = view.querySelectorAll('[data-season-id]');
            containers.forEach(function (contentDiv) {
                if (contentDiv.style.display === 'none') return;
                var seasonId = contentDiv.getAttribute('data-season-id');
                if (loadedSeasons[seasonId]) {
                    renderEpisodeTable(loadedSeasons[seasonId], contentDiv);
                }
            });
        }

        function handleFilterChange() {
            currentFilter = view.querySelector('#episodeFilterDropdown').value;
            refilterAllSeasons();
        }

        function handleSearch() {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(function () {
                currentSearch = view.querySelector('#episodeSearchBox').value.trim();
                refilterAllSeasons();
            }, 300);
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
                var seasonLabel = helpers.escHtml(season.SeasonName || ('Season ' + (season.SeasonNumber || 1)));

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
                        '<button class="raised emby-button btn-season-actions" title="Season actions" style="padding: 0.2em 0.6em; font-size: 0.8em;"><span>Actions &#9660;</span></button>' +
                        '<span class="seasonToggle" style="font-size: 1.2em;">&#9654;</span>' +
                    '</div>';

                // Season-level actions button handler
                var btnSeasonActions = header.querySelector('.btn-season-actions');
                if (btnSeasonActions) {
                    btnSeasonActions.addEventListener('click', function (e) {
                        e.stopPropagation();
                        showSeasonActionsMenu(header, season, btnSeasonActions);
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

            // Apply active filter and search
            var displayEpisodes = filterEpisodes(episodes);

            // Initialize selection tracking for this season
            if (!selectedItems[seasonId]) {
                selectedItems[seasonId] = {};
            }

            // Bulk action row (uses filtered episodes)
            var bulkRow = createBulkActionRow(seasonId, displayEpisodes, container);
            container.appendChild(bulkRow);

            if (displayEpisodes.length === 0) {
                var emptyMsg = document.createElement('div');
                emptyMsg.style.cssText = 'text-align: center; padding: 1em; opacity: 0.7;';
                emptyMsg.textContent = 'No episodes match the current filter.';
                container.appendChild(emptyMsg);
                return;
            }

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

            // Select-all handler (operates on filtered episodes)
            var selectAllCb = thead.querySelector('.select-all-cb');
            selectAllCb.addEventListener('change', function () {
                toggleSelectAll(seasonId, this.checked, displayEpisodes, container);
            });

            table.appendChild(thead);

            // Body (filtered episodes)
            var tbody = document.createElement('tbody');
            displayEpisodes.forEach(function (ep) {
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

        function buildActionButtons() {
            return '<button class="raised emby-button btn-actions" title="Episode actions" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Actions &#9660;</button>';
        }

        function attachRowActions(row, ep) {
            var btnActions = row.querySelector('.btn-actions');
            if (btnActions) {
                btnActions.addEventListener('click', function (e) {
                    e.stopPropagation();
                    showActionsMenu(row, ep, this);
                });
            }
        }

        // ── Inline Editing ──

        function startEdit(row, ep) {
            if (activeEditor) { activeEditor.cancel(); }
            activeEditor = helpers.createInlineEditor({
                row: row,
                getCellValue: function (cell) {
                    return ep[cell.getAttribute('data-marker') + 'Ticks'];
                },
                getItemId: function () { return ep.ItemId; },
                restoreCell: function (cell) {
                    var marker = cell.getAttribute('data-marker');
                    cell.innerHTML = helpers.renderTimestamp(ep[marker + 'Ticks'], ep.ItemId);
                },
                restoreActions: function (actionsCell) {
                    actionsCell.innerHTML = buildActionButtons(ep);
                    attachRowActions(row, ep);
                },
                getRowBackground: function () {
                    return bulkSource && bulkSource.ItemId === ep.ItemId
                        ? 'rgba(33, 150, 243, 0.1)' : '';
                },
                onSaveComplete: function () {
                    activeEditor = null;
                    refreshRow(row, ep);
                },
                onCancel: function () {
                    activeEditor = null;
                }
            });
            activeEditor.start();
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
                })
                .catch(function () {
                    // Fallback: rebuild the row from cached data
                    var container = row.closest('[data-season-id]');
                    var seasonId = container ? container.getAttribute('data-season-id') : null;
                    var newRow = createEpisodeRow(ep, seasonId);
                    row.parentNode.replaceChild(newRow, row);
                });
        }

        // ── Actions Menu ──

        function showActionsMenu(row, ep, buttonEl) {
            var existing = row.querySelector('.actions-menu');
            if (existing) {
                existing.remove();
                return;
            }

            var colors = helpers.getMenuColors(view);
            var menu = helpers.createActionsMenu(colors);

            // Edit
            menu.appendChild(helpers.createMenuItem('Edit', true, colors, function (e) {
                e.stopPropagation();
                menu.remove();
                startEdit(row, ep);
            }));

            menu.appendChild(helpers.createMenuDivider(colors));

            // ── Copy submenu ──
            var hasIntro = ep.IntroStartTicks > 0 || ep.IntroEndTicks > 0;
            var hasCredits = ep.CreditsStartTicks > 0;

            menu.appendChild(helpers.createSubmenuItem('Copy', [
                { label: 'Intros', enabled: hasIntro, onClick: function (e) { e.stopPropagation(); menu.remove(); markAsCopySource(ep, 'intros'); } },
                { label: 'Credits', enabled: hasCredits, onClick: function (e) { e.stopPropagation(); menu.remove(); markAsCopySource(ep, 'credits'); } },
                { label: 'Both', enabled: hasIntro && hasCredits, onClick: function (e) { e.stopPropagation(); menu.remove(); markAsCopySource(ep, 'both'); } }
            ], hasIntro || hasCredits, colors));

            // ── Delete submenu ──
            var hasAnyIntroDelete = ep.IntroStartTicks > 0 || ep.IntroEndTicks > 0;
            var hasAnyCreditDelete = ep.CreditsStartTicks > 0;

            menu.appendChild(helpers.createSubmenuItem('Delete', [
                { label: 'Intros', enabled: hasAnyIntroDelete, onClick: function (e) { e.stopPropagation(); menu.remove(); confirmDeleteGroup(row, ep, 'intros'); } },
                { label: 'Credits', enabled: hasAnyCreditDelete, onClick: function (e) { e.stopPropagation(); menu.remove(); confirmDeleteGroup(row, ep, 'credits'); } },
                { label: 'Both', enabled: hasAnyIntroDelete || hasAnyCreditDelete, onClick: function (e) { e.stopPropagation(); menu.remove(); confirmDeleteGroup(row, ep, 'both'); } }
            ], hasAnyIntroDelete || hasAnyCreditDelete, colors));

            // ── Other actions ──
            menu.appendChild(helpers.createMenuDivider(colors));

            menu.appendChild(helpers.createMenuItem('Set Credits to End', true, colors, function (e) {
                e.stopPropagation();
                menu.remove();
                setCreditsToEnd(row, ep);
            }));

            if (creditsDetectorAvailable) {
                menu.appendChild(helpers.createMenuItem('Detect Credits', true, colors, function (e) {
                    e.stopPropagation();
                    menu.remove();
                    detectCreditsForEpisode(row, ep);
                }));
            }

            helpers.positionMenuBelowButton(menu, buttonEl);
            helpers.attachMenuCloseHandler(menu);
        }

        function ensureSeasonEpisodes(seasonId) {
            if (loadedSeasons[seasonId]) {
                return Promise.resolve(loadedSeasons[seasonId]);
            }
            var epEndpoint = 'episode_list?seasonId=' + encodeURIComponent(seasonId) +
                '&seriesId=' + encodeURIComponent(seriesId);
            return helpers.apiCall(epEndpoint, 'GET').then(function (episodes) {
                episodes = (episodes || []).sort(function (a, b) {
                    return (a.EpisodeNumber || 0) - (b.EpisodeNumber || 0);
                });
                loadedSeasons[seasonId] = episodes;
                return episodes;
            });
        }

        function getSeasonContainer(header) {
            return header.nextElementSibling;
        }

        function showSeasonActionsMenu(header, season, buttonEl) {
            var existing = header.querySelector('.actions-menu');
            if (existing) {
                existing.remove();
                return;
            }

            var sid = season.SeasonId;
            var container = getSeasonContainer(header);
            var colors = helpers.getMenuColors(view);
            var menu = helpers.createActionsMenu(colors);

            // Delete submenu
            menu.appendChild(helpers.createSubmenuItem('Delete', [
                { label: 'Intros', enabled: true, onClick: function (e) {
                    e.stopPropagation(); menu.remove();
                    ensureSeasonEpisodes(sid).then(function (eps) {
                        executeBulkDelete(sid, eps, container, ['IntroStart', 'IntroEnd']);
                    });
                }},
                { label: 'Credits', enabled: true, onClick: function (e) {
                    e.stopPropagation(); menu.remove();
                    ensureSeasonEpisodes(sid).then(function (eps) {
                        executeBulkDelete(sid, eps, container, ['CreditsStart']);
                    });
                }},
                { label: 'Both', enabled: true, onClick: function (e) {
                    e.stopPropagation(); menu.remove();
                    ensureSeasonEpisodes(sid).then(function (eps) {
                        executeBulkDelete(sid, eps, container, ['IntroStart', 'IntroEnd', 'CreditsStart']);
                    });
                }}
            ], true, colors));

            // Set Credits to End
            menu.appendChild(helpers.createMenuItem('Set Credits to End', true, colors, function (e) {
                e.stopPropagation();
                menu.remove();
                ensureSeasonEpisodes(sid).then(function (eps) {
                    executeBulkSetCreditsEnd(sid, eps, container);
                });
            }));

            // Apply Source (only when a copy source is active)
            if (bulkSource) {
                menu.appendChild(helpers.createMenuItem('Apply Source', true, colors, function (e) {
                    e.stopPropagation();
                    menu.remove();
                    ensureSeasonEpisodes(sid).then(function (eps) {
                        executeBulkApply(sid, eps, container);
                    });
                }));
            }

            // Detect items (only when EmbyCredits is available)
            if (creditsDetectorAvailable) {
                menu.appendChild(helpers.createMenuDivider(colors));

                menu.appendChild(helpers.createMenuItem('Detect All', true, colors, function (e) {
                    e.stopPropagation();
                    menu.remove();
                    detectSeasonAll(season.SeasonNumber, buttonEl);
                }));

                menu.appendChild(helpers.createMenuItem('Detect Missing', true, colors, function (e) {
                    e.stopPropagation();
                    menu.remove();
                    detectSeasonMissing(season.SeasonNumber, buttonEl);
                }));
            }

            helpers.positionMenuBelowButton(menu, buttonEl);
            helpers.attachMenuCloseHandler(menu);
        }

        function confirmDeleteGroup(row, ep, groupType) {
            var markers = [];
            if (groupType === 'intros' || groupType === 'both') {
                if (ep.IntroStartTicks > 0) markers.push('IntroStart');
                if (ep.IntroEndTicks > 0) markers.push('IntroEnd');
            }
            if (groupType === 'credits' || groupType === 'both') {
                if (ep.CreditsStartTicks > 0) markers.push('CreditsStart');
            }

            if (markers.length === 0) return;

            var label = groupType === 'intros' ? 'intro markers' : groupType === 'credits' ? 'credits marker' : 'all markers';
            var msg = 'Delete ' + label + ' from "' + (ep.ItemName || 'this episode') + '"?\n\nMarkers: ' + markers.join(', ');

            if (!confirm(msg)) return;

            helpers.showLoading();

            var promise = Promise.resolve();
            markers.forEach(function (markerType) {
                promise = promise.then(function () {
                    return helpers.apiCall('delete_segment', 'POST', JSON.stringify({
                        ItemId: ep.ItemId,
                        MarkerType: markerType
                    }));
                });
            });

            promise.then(function () {
                helpers.hideLoading();
                helpers.showSuccess(markers.length + ' marker(s) deleted successfully.');
                refreshRow(row, ep);
            })
            .catch(function (error) {
                helpers.hideLoading();
                console.error('Failed to delete segments:', error);
                helpers.showError('Failed to delete segment(s).');
            });
        }

        // ── Bulk Copy Source ──

        function markAsCopySource(ep, copyMode) {
            bulkSource = {
                ItemId: ep.ItemId,
                ItemName: ep.ItemName,
                EpisodeNumber: ep.EpisodeNumber,
                IntroStartTicks: ep.IntroStartTicks,
                IntroEndTicks: ep.IntroEndTicks,
                CreditsStartTicks: ep.CreditsStartTicks,
                copyMode: copyMode
            };

            // Update banner
            var modeLabel = copyMode === 'intros' ? 'intros' : copyMode === 'credits' ? 'credits' : 'intros + credits';
            var banner = view.querySelector('#bulkSourceBanner');
            var bannerText = view.querySelector('#bulkSourceText');
            bannerText.textContent = 'Copying ' + modeLabel + ' from Episode ' + (ep.EpisodeNumber || '?') + ' — ' + (ep.ItemName || 'Unknown');
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

        function getTargetEpisodes(seasonId, episodes) {
            var selectedCount = selectedItems[seasonId] ? Object.keys(selectedItems[seasonId]).length : 0;
            if (selectedCount > 0) {
                return episodes.filter(function (ep) {
                    return selectedItems[seasonId][ep.ItemId];
                });
            }
            return episodes.slice();
        }

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
            btnApply.textContent = bulkSource ? getApplyButtonLabel(false, 0) : 'Apply Source to All';
            btnApply.addEventListener('click', function () {
                helpers.guardButton(btnApply, function () {
                    return executeBulkApply(seasonId, episodes, container);
                });
            });

            rightSide.appendChild(btnApply);

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

            if (selectedCount > 0) {
                selectionInfo.textContent = selectedCount + ' of ' + episodes.length + ' selected';
                if (btnApply) {
                    btnApply.textContent = getApplyButtonLabel(true, selectedCount);
                    btnApply.style.display = bulkSource ? '' : 'none';
                }
            } else {
                selectionInfo.textContent = episodes.length + ' episodes';
                if (btnApply) {
                    btnApply.textContent = getApplyButtonLabel(false, 0);
                    btnApply.style.display = bulkSource ? '' : 'none';
                }
            }
        }

        function getApplyButtonLabel(hasSelection, count) {
            var mode = bulkSource ? bulkSource.copyMode : 'both';
            var typeLabel = mode === 'intros' ? 'Intros' : mode === 'credits' ? 'Credits' : 'Source';
            if (hasSelection) {
                return 'Apply ' + typeLabel + ' to Selected (' + count + ')';
            }
            return 'Apply ' + typeLabel + ' to All';
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

            // Build confirmation message based on copy mode
            var sourceLabel = 'E' + (bulkSource.EpisodeNumber || '?') + ' "' + (bulkSource.ItemName || 'Unknown') + '"';
            var copyMode = bulkSource.copyMode || 'both';
            var segments = [];
            if (copyMode === 'intros' || copyMode === 'both') {
                if (bulkSource.IntroStartTicks) segments.push('IntroStart (' + helpers.ticksToTime(bulkSource.IntroStartTicks) + ')');
                if (bulkSource.IntroEndTicks) segments.push('IntroEnd (' + helpers.ticksToTime(bulkSource.IntroEndTicks) + ')');
            }
            if (copyMode === 'credits' || copyMode === 'both') {
                if (bulkSource.CreditsStartTicks) segments.push('CreditsStart (' + helpers.ticksToTime(bulkSource.CreditsStartTicks) + ')');
            }

            if (segments.length === 0) {
                helpers.showError('Source episode has no segments to copy for the selected type.');
                return;
            }

            var modeLabel = copyMode === 'intros' ? 'intros' : copyMode === 'credits' ? 'credits' : 'segments';
            var msg = 'Copy ' + modeLabel + ' from ' + sourceLabel + ' to ' + targetEpisodes.length + ' episode(s)?\n\n' +
                      'Markers: ' + segments.join(', ');

            if (!confirm(msg)) return;

            var targetIds = targetEpisodes.map(function (ep) { return ep.ItemId; }).join(',');
            var markerTypes = [];
            if (copyMode === 'intros' || copyMode === 'both') {
                if (bulkSource.IntroStartTicks) markerTypes.push('IntroStart');
                if (bulkSource.IntroEndTicks) markerTypes.push('IntroEnd');
            }
            if (copyMode === 'credits' || copyMode === 'both') {
                if (bulkSource.CreditsStartTicks) markerTypes.push('CreditsStart');
            }

            helpers.showLoading();

            return helpers.apiCall('bulk_apply', 'POST', JSON.stringify({
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
            var targetEpisodes = getTargetEpisodes(seasonId, episodes);
            if (targetEpisodes.length === 0) {
                helpers.showError('No episodes to delete from.');
                return;
            }
            var itemIds = targetEpisodes.map(function (ep) { return ep.ItemId; });
            return helpers.bulkDelete(itemIds, markerTypes).then(function (result) {
                if (result) refreshSeasonEpisodes(seasonId, container);
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
            var targetEpisodes = getTargetEpisodes(seasonId, episodes);
            if (targetEpisodes.length === 0) {
                helpers.showError('No episodes to update.');
                return;
            }
            var itemIds = targetEpisodes.map(function (ep) { return ep.ItemId; });
            return helpers.bulkSetCreditsEnd(itemIds).then(function (result) {
                if (result) refreshSeasonEpisodes(seasonId, container);
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

        function detectSeasonAll(seasonNumber, btn) {
            helpers.withButtonLoading(btn, '...',
                helpers.creditsDetectorCall('ProcessSeason', {
                    SeriesId: seriesId,
                    SeasonNumber: seasonNumber,
                    SkipExistingMarkers: false
                })
                .then(function () {
                    helpers.showSuccess('Credits detection queued for all episodes in this season. Results will appear after the next sync.');
                })
                .catch(function (error) {
                    console.error('Season credits detection failed:', error);
                    helpers.showError('Credits detection failed for this season.');
                })
            );
        }

        function detectSeasonMissing(seasonNumber, btn) {
            helpers.withButtonLoading(btn, '...',
                helpers.creditsDetectorCall('ProcessSeasonMissingMarkers', {
                    SeriesId: seriesId,
                    SeasonNumber: seasonNumber
                })
                .then(function () {
                    helpers.showSuccess('Credits detection queued for episodes missing credits. Results will appear after the next sync.');
                })
                .catch(function (error) {
                    console.error('Season credits detection failed:', error);
                    helpers.showError('Credits detection failed for this season.');
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

                var filterDropdown = view.querySelector('#episodeFilterDropdown');
                if (filterDropdown) {
                    filterDropdown.addEventListener('change', handleFilterChange);
                }

                var searchBox = view.querySelector('#episodeSearchBox');
                if (searchBox) {
                    searchBox.addEventListener('input', handleSearch);
                }
            }

            // Reset filter state for fresh view
            currentFilter = 'all';
            currentSearch = '';
            var filterEl = view.querySelector('#episodeFilterDropdown');
            if (filterEl) filterEl.value = 'all';
            var searchEl = view.querySelector('#episodeSearchBox');
            if (searchEl) searchEl.value = '';

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
