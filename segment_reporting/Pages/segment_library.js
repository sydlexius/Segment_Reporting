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
        var libraryId = null;
        var contentType = 'series'; // 'series', 'movies', or 'mixed'
        var seriesData = [];
        var filteredSeriesData = [];
        var movieData = [];
        var filteredMovieData = [];
        var chart = null;
        var currentFilter = 'all';
        var currentSearch = '';
        var sortColumn = null;
        var sortAscending = true;
        var movieSortColumn = null;
        var movieSortAscending = true;
        var activeEditor = null;
        var listenersAttached = false;
        var libraryName = null;
        var creditsDetectorAvailable = false;
        var loadedSeriesEpisodes = {};  // seriesId -> episode array (lazy-load cache)

        // ── Data Loading ──

        function loadLibraryData(apiFilter) {
            var endpoint = 'series_list?libraryId=' + encodeURIComponent(libraryId);
            if (apiFilter && (apiFilter === 'missing_intro' || apiFilter === 'missing_credits')) {
                endpoint += '&filter=' + apiFilter;
            }

            helpers.apiCallWithLoading(endpoint, 'GET')
                .then(function (data) {
                    contentType = data.contentType || 'series';
                    seriesData = data.series || [];
                    movieData = data.movies || [];
                    applyClientFilters();
                    updatePageTitle();
                    updateSectionVisibility();
                    updateChart();
                    if (contentType !== 'movies') {
                        updateSeriesTable();
                    }
                    if (contentType !== 'series') {
                        updateMovieTable();
                    }
                })
                .catch(function () {});
        }

        function updatePageTitle() {
            // Resolve friendly name: URL param first, then API data
            if (!libraryName) {
                if (seriesData.length > 0 && seriesData[0].LibraryName) {
                    libraryName = seriesData[0].LibraryName;
                } else if (movieData.length > 0 && movieData[0].LibraryName) {
                    libraryName = movieData[0].LibraryName;
                }
            }

            var displayName = libraryName || libraryId || 'Library';
            view.querySelector('#pageTitle').textContent = displayName;

            // Render breadcrumbs
            var bc = view.querySelector('#breadcrumbContainer');
            if (bc) {
                helpers.renderBreadcrumbs(bc, [
                    { label: 'Dashboard', page: 'segment_dashboard', params: {} },
                    { label: displayName }
                ]);
            }
        }

        function updateSectionVisibility() {
            var seriesSection = view.querySelector('#seriesSection');
            var movieSection = view.querySelector('#movieSection');
            var chartTitle = view.querySelector('#chartTitle');

            if (contentType === 'movies') {
                seriesSection.style.display = 'none';
                movieSection.style.display = '';
                chartTitle.textContent = 'Coverage by Movie';
            } else if (contentType === 'series') {
                seriesSection.style.display = '';
                movieSection.style.display = 'none';
                chartTitle.textContent = 'Coverage by Series';
            } else {
                // mixed
                seriesSection.style.display = '';
                movieSection.style.display = '';
                chartTitle.textContent = 'Coverage by Series';
            }
        }

        // ── Filtering ──

        function applyClientFilters() {
            // Series filters
            filteredSeriesData = seriesData.slice();
            if (currentFilter === 'complete') {
                filteredSeriesData = filteredSeriesData.filter(function (item) {
                    var total = item.TotalEpisodes || 0;
                    return total > 0 && (item.WithIntro || 0) === total && (item.WithCredits || 0) === total;
                });
            } else if (currentFilter === 'has_intro') {
                filteredSeriesData = filteredSeriesData.filter(function (item) {
                    return (item.WithIntro || 0) > 0;
                });
            } else if (currentFilter === 'has_credits') {
                filteredSeriesData = filteredSeriesData.filter(function (item) {
                    return (item.WithCredits || 0) > 0;
                });
            } else if (currentFilter === 'no_segments') {
                filteredSeriesData = filteredSeriesData.filter(function (item) {
                    return (item.WithIntro || 0) === 0 && (item.WithCredits || 0) === 0;
                });
            }
            if (currentSearch) {
                var searchLower = currentSearch.toLowerCase();
                filteredSeriesData = filteredSeriesData.filter(function (item) {
                    return (item.SeriesName || '').toLowerCase().indexOf(searchLower) >= 0;
                });
            }

            // Movie filters
            filteredMovieData = movieData.slice();
            if (currentFilter === 'complete') {
                filteredMovieData = filteredMovieData.filter(function (item) {
                    return (item.HasIntro || 0) === 1 && (item.HasCredits || 0) === 1;
                });
            } else if (currentFilter === 'has_intro') {
                filteredMovieData = filteredMovieData.filter(function (item) {
                    return (item.HasIntro || 0) === 1;
                });
            } else if (currentFilter === 'has_credits') {
                filteredMovieData = filteredMovieData.filter(function (item) {
                    return (item.HasCredits || 0) === 1;
                });
            } else if (currentFilter === 'no_segments') {
                filteredMovieData = filteredMovieData.filter(function (item) {
                    return (item.HasIntro || 0) === 0 && (item.HasCredits || 0) === 0;
                });
            }
            if (currentSearch) {
                var searchLower2 = currentSearch.toLowerCase();
                filteredMovieData = filteredMovieData.filter(function (item) {
                    return (item.ItemName || '').toLowerCase().indexOf(searchLower2) >= 0;
                });
            }
        }

        function handleFilterChange() {
            var newFilter = view.querySelector('#filterDropdown').value;
            currentFilter = newFilter;

            if (newFilter === 'missing_intro' || newFilter === 'missing_credits') {
                loadLibraryData(newFilter);
            } else {
                applyClientFilters();
                updateChart();
                if (contentType !== 'movies') updateSeriesTable();
                if (contentType !== 'series') updateMovieTable();
            }
        }

        function handleSearch() {
            currentSearch = view.querySelector('#searchBox').value.trim();
            applyClientFilters();
            updateChart();
            if (contentType !== 'movies') updateSeriesTable();
            if (contentType !== 'series') updateMovieTable();
        }

        // ── Series Sorting ──

        function getSeriesSortValue(item, key) {
            var total = item.TotalEpisodes || 0;
            switch (key) {
                case 'name': return (item.SeriesName || '').toLowerCase();
                case 'total': return total;
                case 'intro': return item.WithIntro || 0;
                case 'credits': return item.WithCredits || 0;
                case 'both': return Math.min(item.WithIntro || 0, item.WithCredits || 0);
                case 'introPct': return total > 0 ? (item.WithIntro || 0) / total : 0;
                case 'creditsPct': return total > 0 ? (item.WithCredits || 0) / total : 0;
                default: return 0;
            }
        }

        function applySeriesSorting() {
            if (!sortColumn) return;
            var col = sortColumn;
            var asc = sortAscending;
            filteredSeriesData.sort(function (a, b) {
                var va = getSeriesSortValue(a, col);
                var vb = getSeriesSortValue(b, col);
                if (typeof va === 'string') {
                    var cmp = va.localeCompare(vb);
                    return asc ? cmp : -cmp;
                }
                return asc ? va - vb : vb - va;
            });
        }

        function updateSeriesSortIndicators() {
            var headers = view.querySelectorAll('#seriesTable th[data-sort]');
            headers.forEach(function (th) {
                var arrow = th.querySelector('.sort-arrow');
                if (th.getAttribute('data-sort') === sortColumn) {
                    th.classList.add('sort-active');
                    arrow.innerHTML = sortAscending ? '&#9650;' : '&#9660;';
                } else {
                    th.classList.remove('sort-active');
                    arrow.innerHTML = '&#9650;';
                }
            });
        }

        function handleSeriesSortClick(e) {
            var th = e.target.closest('th[data-sort]');
            if (!th) return;
            var col = th.getAttribute('data-sort');
            if (sortColumn === col) {
                sortAscending = !sortAscending;
            } else {
                sortColumn = col;
                sortAscending = (col === 'name');
            }
            applySeriesSorting();
            updateSeriesSortIndicators();
            updateSeriesTable();
        }

        // ── Movie Sorting ──

        function getMovieSortValue(item, key) {
            switch (key) {
                case 'name': return (item.ItemName || '').toLowerCase();
                case 'introStart': return item.IntroStartTicks || 0;
                case 'introEnd': return item.IntroEndTicks || 0;
                case 'creditsStart': return item.CreditsStartTicks || 0;
                default: return 0;
            }
        }

        function applyMovieSorting() {
            if (!movieSortColumn) return;
            var col = movieSortColumn;
            var asc = movieSortAscending;
            filteredMovieData.sort(function (a, b) {
                var va = getMovieSortValue(a, col);
                var vb = getMovieSortValue(b, col);
                if (typeof va === 'string') {
                    var cmp = va.localeCompare(vb);
                    return asc ? cmp : -cmp;
                }
                return asc ? va - vb : vb - va;
            });
        }

        function updateMovieSortIndicators() {
            var headers = view.querySelectorAll('#movieTable th[data-sort]');
            headers.forEach(function (th) {
                var arrow = th.querySelector('.sort-arrow');
                if (th.getAttribute('data-sort') === movieSortColumn) {
                    th.classList.add('sort-active');
                    arrow.innerHTML = movieSortAscending ? '&#9650;' : '&#9660;';
                } else {
                    th.classList.remove('sort-active');
                    arrow.innerHTML = '&#9650;';
                }
            });
        }

        function handleMovieSortClick(e) {
            var th = e.target.closest('th[data-sort]');
            if (!th) return;
            var col = th.getAttribute('data-sort');
            if (movieSortColumn === col) {
                movieSortAscending = !movieSortAscending;
            } else {
                movieSortColumn = col;
                movieSortAscending = (col === 'name');
            }
            applyMovieSorting();
            updateMovieSortIndicators();
            updateMovieTable();
        }

        // ── Chart ──

        function updateChart() {
            require([Dashboard.getConfigurationResourceUrl('segment_reporting_chart.min.js')], function (Chart) {
                var ctx = view.querySelector('#seriesChart').getContext('2d');

                // Build chart data from series (or movies in movie-only libraries)
                var chartData = contentType === 'movies' ? buildMovieChartData() : buildSeriesChartData();

                if (chart) {
                    chart.destroy();
                }

                chart = helpers.createSegmentChart(Chart, ctx, chartData.labels,
                    { withBoth: chartData.withBoth, introOnly: chartData.introOnly, creditsOnly: chartData.creditsOnly, withNeither: chartData.withNeither },
                    view, {
                        xTickOptions: { maxRotation: 45, minRotation: 0 },
                        tooltipCallbacks: {
                            footer: function (tooltipItems) {
                                var index = tooltipItems[0].dataIndex;
                                if (contentType === 'movies') {
                                    return '';
                                }
                                var item = filteredSeriesData[index];
                                return 'Total: ' + (item.TotalEpisodes || 0) + ' items';
                            }
                        },
                        onClick: function (event, elements) {
                            if (elements && elements.length > 0) {
                                var index = elements[0].index;
                                if (contentType !== 'movies') {
                                    var item = filteredSeriesData[index];
                                    if (item && item.SeriesId) {
                                        helpers.navigate('segment_series', { seriesId: item.SeriesId, libraryId: libraryId, libraryName: libraryName });
                                    }
                                }
                            }
                        }
                    }
                );
            });
        }

        function buildSeriesChartData() {
            var labels = filteredSeriesData.map(function (item) { return item.SeriesName || 'Unknown'; });
            var totalEpisodes = filteredSeriesData.map(function (item) { return item.TotalEpisodes || 0; });
            var withIntro = filteredSeriesData.map(function (item) { return item.WithIntro || 0; });
            var withCredits = filteredSeriesData.map(function (item) { return item.WithCredits || 0; });
            var withBoth = filteredSeriesData.map(function (item, idx) { return Math.min(withIntro[idx], withCredits[idx]); });
            var introOnly = filteredSeriesData.map(function (item, idx) { return withIntro[idx] - withBoth[idx]; });
            var creditsOnly = filteredSeriesData.map(function (item, idx) { return withCredits[idx] - withBoth[idx]; });
            var withNeither = filteredSeriesData.map(function (item, idx) { return totalEpisodes[idx] - withIntro[idx] - withCredits[idx] + withBoth[idx]; });
            return { labels: labels, withBoth: withBoth, introOnly: introOnly, creditsOnly: creditsOnly, withNeither: withNeither };
        }

        function buildMovieChartData() {
            var labels = filteredMovieData.map(function (item) { return item.ItemName || 'Unknown'; });
            var withBoth = filteredMovieData.map(function (item) { return (item.HasIntro && item.HasCredits) ? 1 : 0; });
            var introOnly = filteredMovieData.map(function (item) { return (item.HasIntro && !item.HasCredits) ? 1 : 0; });
            var creditsOnly = filteredMovieData.map(function (item) { return (!item.HasIntro && item.HasCredits) ? 1 : 0; });
            var withNeither = filteredMovieData.map(function (item) { return (!item.HasIntro && !item.HasCredits) ? 1 : 0; });
            return { labels: labels, withBoth: withBoth, introOnly: introOnly, creditsOnly: creditsOnly, withNeither: withNeither };
        }

        // ── Series Table ──

        function updateSeriesTable() {
            var tbody = view.querySelector('#seriesTableBody');
            tbody.innerHTML = '';

            if (filteredSeriesData.length === 0) {
                tbody.appendChild(helpers.createEmptyRow('No series found. Try adjusting your filters.', 8));
                return;
            }

            applySeriesSorting();

            filteredSeriesData.forEach(function (item) {
                var row = document.createElement('tr');
                row.style.cursor = 'pointer';
                row.setAttribute('data-series-id', item.SeriesId);

                var totalItems = item.TotalEpisodes || 0;
                var withIntro = item.WithIntro || 0;
                var withCredits = item.WithCredits || 0;
                var withBoth = Math.min(withIntro, withCredits);

                var introPct = helpers.percentage(withIntro, totalItems);
                var creditsPct = helpers.percentage(withCredits, totalItems);

                row.innerHTML =
                    '<td>' + helpers.escHtml(item.SeriesName || 'Unknown') + '</td>' +
                    '<td>' + totalItems.toLocaleString() + '</td>' +
                    '<td>' + withIntro.toLocaleString() + '</td>' +
                    '<td>' + withCredits.toLocaleString() + '</td>' +
                    '<td>' + withBoth.toLocaleString() + '</td>' +
                    '<td><strong>' + introPct + '</strong></td>' +
                    '<td><strong>' + creditsPct + '</strong></td>' +
                    '<td style="text-align: center;"><button class="raised emby-button btn-series-actions" title="Series actions" style="padding: 0.2em 0.6em; font-size: 0.85em;">Actions &#9660;</button></td>';

                row.addEventListener('click', function (e) {
                    if (e.target.closest('.btn-series-actions')) return;
                    helpers.navigate('segment_series', { seriesId: item.SeriesId, libraryId: libraryId, libraryName: libraryName });
                });

                var btnActions = row.querySelector('.btn-series-actions');
                if (btnActions) {
                    btnActions.addEventListener('click', function (e) {
                        e.stopPropagation();
                        showSeriesActionsMenu(row, item, btnActions);
                    });
                }

                helpers.attachHoverEffect(row);

                tbody.appendChild(row);
            });

            helpers.applyTableStyles(view.querySelector('#seriesTable'));
        }

        // ── Series Actions Menu ──

        function ensureSeriesEpisodes(seriesId) {
            if (loadedSeriesEpisodes[seriesId]) {
                return Promise.resolve(loadedSeriesEpisodes[seriesId]);
            }
            return helpers.apiCall('episode_list?seriesId=' + encodeURIComponent(seriesId), 'GET')
                .then(function (episodes) {
                    episodes = episodes || [];
                    loadedSeriesEpisodes[seriesId] = episodes;
                    return episodes;
                });
        }

        function showSeriesActionsMenu(row, series, buttonEl) {
            var existing = row.querySelector('.actions-menu');
            if (existing) {
                existing.remove();
                return;
            }

            var colors = helpers.getMenuColors(view);
            var menu = helpers.createActionsMenu(colors);
            var hasIntro = (series.WithIntro || 0) > 0;
            var hasCredits = (series.WithCredits || 0) > 0;

            // Delete submenu
            menu.appendChild(helpers.createSubmenuItem('Delete', [
                { label: 'Intros', enabled: hasIntro, onClick: function (e) {
                    e.stopPropagation(); menu.remove();
                    executeSeriesBulkDelete(series, ['IntroStart', 'IntroEnd']);
                }},
                { label: 'Credits', enabled: hasCredits, onClick: function (e) {
                    e.stopPropagation(); menu.remove();
                    executeSeriesBulkDelete(series, ['CreditsStart']);
                }},
                { label: 'Both', enabled: hasIntro || hasCredits, onClick: function (e) {
                    e.stopPropagation(); menu.remove();
                    executeSeriesBulkDelete(series, ['IntroStart', 'IntroEnd', 'CreditsStart']);
                }}
            ], hasIntro || hasCredits, colors));

            // Set Credits to End
            menu.appendChild(helpers.createMenuItem('Set Credits to End', true, colors, function (e) {
                e.stopPropagation();
                menu.remove();
                executeSeriesSetCreditsEnd(series);
            }));

            // Detect items (only when EmbyCredits available)
            if (creditsDetectorAvailable) {
                menu.appendChild(helpers.createMenuDivider(colors));

                menu.appendChild(helpers.createMenuItem('Detect All', true, colors, function (e) {
                    e.stopPropagation();
                    menu.remove();
                    detectSeriesAll(series, buttonEl);
                }));

                var missingCount = (series.TotalEpisodes || 0) - (series.WithCredits || 0);
                menu.appendChild(helpers.createMenuItem('Detect Missing', missingCount > 0, colors, function (e) {
                    e.stopPropagation();
                    menu.remove();
                    detectSeriesMissing(series, buttonEl);
                }));
            }

            helpers.positionMenuBelowButton(menu, buttonEl);
            helpers.attachMenuCloseHandler(menu);
        }

        function executeSeriesBulkDelete(series, markerTypes) {
            ensureSeriesEpisodes(series.SeriesId).then(function (episodes) {
                var itemIds = episodes.map(function (ep) { return ep.ItemId; });
                helpers.bulkDelete(itemIds, markerTypes).then(function (result) {
                    if (result) {
                        delete loadedSeriesEpisodes[series.SeriesId];
                        loadLibraryData();
                    }
                });
            });
        }

        function executeSeriesSetCreditsEnd(series) {
            ensureSeriesEpisodes(series.SeriesId).then(function (episodes) {
                var itemIds = episodes.map(function (ep) { return ep.ItemId; });
                helpers.bulkSetCreditsEnd(itemIds).then(function (result) {
                    if (result) {
                        delete loadedSeriesEpisodes[series.SeriesId];
                        loadLibraryData();
                    }
                });
            });
        }

        function detectSeriesAll(series, btn) {
            var seriesName = series.SeriesName || 'this series';
            if (!confirm('Detect credits for all episodes in "' + seriesName + '"? This runs in the background and may take a while.')) {
                return;
            }
            helpers.withButtonLoading(btn, '...',
                helpers.creditsDetectorCall('ProcessSeries', { SeriesId: series.SeriesId })
                    .then(function () {
                        helpers.showSuccess('Credits detection queued for "' + seriesName + '". Results will appear after the next sync.');
                    })
                    .catch(function (error) {
                        console.error('Credits detection failed for series:', error);
                        helpers.showError('Credits detection failed for "' + seriesName + '".');
                    })
            );
        }

        function detectSeriesMissing(series, btn) {
            var seriesName = series.SeriesName || 'this series';
            var missingCount = (series.TotalEpisodes || 0) - (series.WithCredits || 0);
            if (!confirm('Detect credits for ' + missingCount + ' episodes missing credits in "' + seriesName + '"? This runs in the background and may take a while.')) {
                return;
            }
            helpers.withButtonLoading(btn, '...',
                helpers.creditsDetectorCall('ProcessSeries', { SeriesId: series.SeriesId })
                    .then(function () {
                        helpers.showSuccess('Credits detection queued for "' + seriesName + '". Results will appear after the next sync.');
                    })
                    .catch(function (error) {
                        console.error('Credits detection failed for series:', error);
                        helpers.showError('Credits detection failed for "' + seriesName + '".');
                    })
            );
        }

        // ── Movie Detect Credits ──

        function detectCreditsForMovie(movie, btn) {
            var movieName = movie.ItemName || 'this movie';

            helpers.withButtonLoading(btn, '...',
                helpers.creditsDetectorCall('ProcessEpisode', { ItemId: movie.ItemId })
                    .then(function () {
                        helpers.showSuccess('Credits detection queued for "' + movieName + '". Results will appear after the next sync.');
                    })
                    .catch(function (error) {
                        console.error('Credits detection failed for movie:', error);
                        helpers.showError('Credits detection failed for "' + movieName + '".');
                    })
            );
        }

        // ── Movie Table ──

        function updateMovieTable() {
            var tbody = view.querySelector('#movieTableBody');
            tbody.innerHTML = '';

            if (filteredMovieData.length === 0) {
                tbody.appendChild(helpers.createEmptyRow('No movies found. Try adjusting your filters.', 5));
                return;
            }

            applyMovieSorting();

            filteredMovieData.forEach(function (movie) {
                tbody.appendChild(createMovieRow(movie));
            });

            helpers.applyTableStyles(view.querySelector('#movieTable'));
        }

        function createMovieRow(movie) {
            var row = document.createElement('tr');
            row.setAttribute('data-item-id', movie.ItemId);
            row.style.borderBottom = '1px solid rgba(128,128,128,0.15)';

            var cellStyle = 'padding: 0.5em; ';
            var centerStyle = cellStyle + 'text-align: center; ';

            row.innerHTML =
                '<td style="' + cellStyle + '">' + helpers.escHtml(movie.ItemName || 'Unknown') + '</td>' +
                '<td class="tick-cell" data-marker="IntroStart" style="' + centerStyle + '">' + helpers.renderTimestamp(movie.IntroStartTicks, movie.ItemId) + '</td>' +
                '<td class="tick-cell" data-marker="IntroEnd" style="' + centerStyle + '">' + helpers.renderTimestamp(movie.IntroEndTicks, movie.ItemId) + '</td>' +
                '<td class="tick-cell" data-marker="CreditsStart" style="' + centerStyle + '">' + helpers.renderTimestamp(movie.CreditsStartTicks, movie.ItemId) + '</td>' +
                '<td style="' + centerStyle + '">' + buildMovieActionButtons() + '</td>';

            attachMovieRowActions(row, movie);

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

            helpers.attachHoverEffect(row);

            return row;
        }

        function buildMovieActionButtons() {
            return '<button class="raised emby-button btn-actions" title="Movie actions" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Actions &#9660;</button>';
        }

        function attachMovieRowActions(row, movie) {
            var btnActions = row.querySelector('.btn-actions');
            if (btnActions) {
                btnActions.addEventListener('click', function (e) {
                    e.stopPropagation();
                    showMovieActionsMenu(row, movie, btnActions);
                });
            }
        }

        // ── Movie Inline Editing ──

        function startMovieEdit(row, movie) {
            if (activeEditor) { activeEditor.cancel(); }
            activeEditor = helpers.createInlineEditor({
                row: row,
                getCellValue: function (cell) {
                    return movie[cell.getAttribute('data-marker') + 'Ticks'];
                },
                getItemId: function () { return movie.ItemId; },
                restoreCell: function (cell) {
                    var marker = cell.getAttribute('data-marker');
                    cell.innerHTML = helpers.renderTimestamp(movie[marker + 'Ticks'], movie.ItemId);
                },
                restoreActions: function (actionsCell) {
                    actionsCell.innerHTML = buildMovieActionButtons();
                    attachMovieRowActions(row, movie);
                },
                onSaveComplete: function () {
                    activeEditor = null;
                    refreshMovieRow(row, movie);
                },
                onCancel: function () {
                    activeEditor = null;
                }
            });
            activeEditor.start();
        }

        function refreshMovieRow(row, movie) {
            helpers.apiCall('item_segments?itemId=' + encodeURIComponent(movie.ItemId), 'GET')
                .then(function (data) {
                    if (data && !data.error) {
                        movie.IntroStartTicks = data.IntroStartTicks;
                        movie.IntroEndTicks = data.IntroEndTicks;
                        movie.CreditsStartTicks = data.CreditsStartTicks;
                        movie.HasIntro = data.HasIntro;
                        movie.HasCredits = data.HasCredits;
                    }

                    var newRow = createMovieRow(movie);
                    row.parentNode.replaceChild(newRow, row);
                })
                .catch(function () {
                    // Fallback: rebuild the row from cached data
                    var newRow = createMovieRow(movie);
                    row.parentNode.replaceChild(newRow, row);
                });
        }

        // ── Movie Actions Menu ──

        function showMovieActionsMenu(row, movie, buttonEl) {
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
                startMovieEdit(row, movie);
            }));

            menu.appendChild(helpers.createMenuDivider(colors));

            // Delete submenu
            var hasIntro = movie.IntroStartTicks > 0 || movie.IntroEndTicks > 0;
            var hasCredits = movie.CreditsStartTicks > 0;

            menu.appendChild(helpers.createSubmenuItem('Delete', [
                { label: 'Intros', enabled: hasIntro, onClick: function (e) { e.stopPropagation(); menu.remove(); confirmMovieDeleteGroup(row, movie, 'intros'); } },
                { label: 'Credits', enabled: hasCredits, onClick: function (e) { e.stopPropagation(); menu.remove(); confirmMovieDeleteGroup(row, movie, 'credits'); } },
                { label: 'Both', enabled: hasIntro || hasCredits, onClick: function (e) { e.stopPropagation(); menu.remove(); confirmMovieDeleteGroup(row, movie, 'both'); } }
            ], hasIntro || hasCredits, colors));

            // Set Credits to End
            menu.appendChild(helpers.createMenuItem('Set Credits to End', true, colors, function (e) {
                e.stopPropagation();
                menu.remove();
                setMovieCreditsToEnd(row, movie);
            }));

            // Detect Credits (only when EmbyCredits available)
            if (creditsDetectorAvailable) {
                menu.appendChild(helpers.createMenuDivider(colors));

                menu.appendChild(helpers.createMenuItem('Detect Credits', true, colors, function (e) {
                    e.stopPropagation();
                    menu.remove();
                    detectCreditsForMovie(movie, buttonEl);
                }));
            }

            helpers.positionMenuBelowButton(menu, buttonEl);
            helpers.attachMenuCloseHandler(menu);
        }

        function confirmMovieDeleteGroup(row, movie, groupType) {
            var markers = [];
            if (groupType === 'intros' || groupType === 'both') {
                if (movie.IntroStartTicks > 0) markers.push('IntroStart');
                if (movie.IntroEndTicks > 0) markers.push('IntroEnd');
            }
            if (groupType === 'credits' || groupType === 'both') {
                if (movie.CreditsStartTicks > 0) markers.push('CreditsStart');
            }

            if (markers.length === 0) return;

            var label = groupType === 'intros' ? 'intro markers' : groupType === 'credits' ? 'credits marker' : 'all markers';
            var msg = 'Delete ' + label + ' from "' + (movie.ItemName || 'this movie') + '"?\n\nMarkers: ' + markers.join(', ');

            if (!confirm(msg)) return;

            helpers.showLoading();

            var promise = Promise.resolve();
            markers.forEach(function (markerType) {
                promise = promise.then(function () {
                    return helpers.apiCall('delete_segment', 'POST', JSON.stringify({
                        ItemId: movie.ItemId,
                        MarkerType: markerType
                    }));
                });
            });

            promise.then(function () {
                helpers.hideLoading();
                helpers.showSuccess(markers.length + ' marker(s) deleted successfully.');
                refreshMovieRow(row, movie);
            })
            .catch(function (error) {
                helpers.hideLoading();
                console.error('Failed to delete segments:', error);
                helpers.showError('Failed to delete segment(s).');
            });
        }

        function setMovieCreditsToEnd(row, movie) {
            var msg = 'Set CreditsStart to end of "' + (movie.ItemName || 'this movie') + '"?';
            if (!confirm(msg)) return;

            helpers.showLoading();

            helpers.apiCall('bulk_set_credits_end', 'POST', JSON.stringify({
                ItemIds: movie.ItemId,
                OffsetTicks: 0
            }))
            .then(function (result) {
                helpers.hideLoading();
                if (result.failed > 0) {
                    helpers.showError('Failed: ' + (result.errors && result.errors.length > 0 ? result.errors[0] : 'Unknown error'));
                } else {
                    helpers.showSuccess('CreditsStart set to end of movie.');
                    refreshMovieRow(row, movie);
                }
            })
            .catch(function (error) {
                helpers.hideLoading();
                console.error('Set credits to end failed:', error);
                helpers.showError('Failed to set credits to end.');
            });
        }

        // ── View Lifecycle ──

        view.addEventListener('viewshow', function (e) {
            libraryId = helpers.getQueryParam('libraryId');
            libraryName = helpers.getQueryParam('libraryName');

            if (!libraryId) {
                helpers.showError('No library ID provided. Please navigate from the dashboard.');
                return;
            }

            if (!listenersAttached) {
                listenersAttached = true;

                var filterDropdown = view.querySelector('#filterDropdown');
                if (filterDropdown) {
                    filterDropdown.addEventListener('change', handleFilterChange);
                }

                var seriesThead = view.querySelector('#seriesTable thead');
                if (seriesThead) {
                    seriesThead.addEventListener('click', handleSeriesSortClick);
                }

                var movieThead = view.querySelector('#movieTable thead');
                if (movieThead) {
                    movieThead.addEventListener('click', handleMovieSortClick);
                }

                var searchBox = view.querySelector('#searchBox');
                if (searchBox) {
                    var searchTimeout;
                    searchBox.addEventListener('input', function () {
                        clearTimeout(searchTimeout);
                        searchTimeout = setTimeout(handleSearch, 300);
                    });
                }
            }

            Promise.all([
                helpers.checkCreditsDetector().then(function (available) {
                    creditsDetectorAvailable = available;
                }),
                helpers.loadPreferences()
            ]).then(function () {
                loadLibraryData();
            });
        });

        helpers.registerChartCleanup(view, function () { return chart; }, function (v) { chart = v; });
    };
});
