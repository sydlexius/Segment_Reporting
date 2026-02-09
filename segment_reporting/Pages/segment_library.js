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
        var editingRow = null;
        var listenersAttached = false;
        var libraryName = null;

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
                tbody.appendChild(helpers.createEmptyRow('No series found. Try adjusting your filters.', 7));
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
                    '<td><strong>' + creditsPct + '</strong></td>';

                row.addEventListener('click', function () {
                    helpers.navigate('segment_series', { seriesId: item.SeriesId, libraryId: libraryId, libraryName: libraryName });
                });

                helpers.attachHoverEffect(row);

                tbody.appendChild(row);
            });

            helpers.applyTableStyles(view.querySelector('#seriesTable'));
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
            return '<button class="raised emby-button btn-edit" title="Edit segments" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Edit</button>' +
                   '<button class="raised emby-button btn-delete" title="Delete a segment" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Delete</button>';
        }

        function attachMovieRowActions(row, movie) {
            var btnEdit = row.querySelector('.btn-edit');
            var btnDelete = row.querySelector('.btn-delete');

            if (btnEdit) {
                btnEdit.addEventListener('click', function (e) {
                    e.stopPropagation();
                    startMovieEdit(row, movie);
                });
            }

            if (btnDelete) {
                btnDelete.addEventListener('click', function (e) {
                    e.stopPropagation();
                    showMovieDeleteMenu(row, movie, this);
                });
            }
        }

        // ── Movie Inline Editing ──

        function startMovieEdit(row, movie) {
            if (editingRow && editingRow !== row) {
                cancelCurrentMovieEdit();
            }

            editingRow = row;
            row.classList.add('editing');
            row.style.backgroundColor = 'rgba(255, 235, 59, 0.1)';

            var tickCells = row.querySelectorAll('.tick-cell');
            tickCells.forEach(function (cell) {
                var marker = cell.getAttribute('data-marker');
                var currentTicks = movie[marker + 'Ticks'];
                var currentDisplay = helpers.ticksToTime(currentTicks);

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

            var actionsCell = row.querySelector('td:last-child');
            actionsCell.innerHTML =
                '<button class="raised emby-button btn-save" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em; background-color: #4CAF50;">Save</button>' +
                '<button class="raised button-cancel emby-button btn-cancel" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Cancel</button>';

            actionsCell.querySelector('.btn-save').addEventListener('click', function (e) {
                e.stopPropagation();
                saveMovieEdit(row, movie);
            });

            actionsCell.querySelector('.btn-cancel').addEventListener('click', function (e) {
                e.stopPropagation();
                cancelMovieEdit(row, movie);
            });
        }

        function saveMovieEdit(row, movie) {
            var inputs = row.querySelectorAll('.tick-cell input');
            var updates = [];

            inputs.forEach(function (input) {
                var marker = input.getAttribute('data-marker');
                var originalTicks = parseInt(row.querySelector('.tick-cell[data-marker="' + marker + '"]').getAttribute('data-original-ticks'), 10) || 0;
                var newValue = input.value.trim();

                if (!newValue) {
                    if (originalTicks > 0) {
                        updates.push({ type: 'delete', marker: marker });
                    }
                    return;
                }

                var newTicks = helpers.timeToTicks(newValue);
                if (newTicks === 0 && newValue !== '00:00:00.000') {
                    helpers.showError('Invalid time format for ' + marker + '. Use HH:MM:SS.fff');
                    return;
                }

                if (newTicks !== originalTicks) {
                    updates.push({ type: 'update', marker: marker, ticks: newTicks });
                }
            });

            if (updates.length === 0) {
                cancelMovieEdit(row, movie);
                return;
            }

            helpers.showLoading();

            var chain = Promise.resolve();
            updates.forEach(function (update) {
                chain = chain.then(function () {
                    if (update.type === 'delete') {
                        return helpers.apiCall('delete_segment', 'POST', JSON.stringify({
                            ItemId: movie.ItemId,
                            MarkerType: update.marker
                        }));
                    } else {
                        return helpers.apiCall('update_segment', 'POST', JSON.stringify({
                            ItemId: movie.ItemId,
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
                    refreshMovieRow(row, movie);
                })
                .catch(function (error) {
                    helpers.hideLoading();
                    console.error('Failed to save segments:', error);
                    helpers.showError('Failed to save segment changes.');
                });
        }

        function cancelMovieEdit(row, movie) {
            row.classList.remove('editing');
            row.style.backgroundColor = '';

            var tickCells = row.querySelectorAll('.tick-cell');
            tickCells.forEach(function (cell) {
                var marker = cell.getAttribute('data-marker');
                var ticks = movie[marker + 'Ticks'];
                cell.innerHTML = helpers.renderTimestamp(ticks, movie.ItemId);
            });

            var actionsCell = row.querySelector('td:last-child');
            actionsCell.innerHTML = buildMovieActionButtons();
            attachMovieRowActions(row, movie);

            editingRow = null;
        }

        function cancelCurrentMovieEdit() {
            if (editingRow) {
                var itemId = editingRow.getAttribute('data-item-id');
                var movie = findMovieByItemId(itemId);
                if (movie) {
                    cancelMovieEdit(editingRow, movie);
                }
            }
        }

        function findMovieByItemId(itemId) {
            for (var i = 0; i < movieData.length; i++) {
                if (movieData[i].ItemId === itemId) return movieData[i];
            }
            return null;
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
                    editingRow = null;
                })
                .catch(function () {
                    cancelMovieEdit(row, movie);
                });
        }

        // ── Movie Delete ──

        function showMovieDeleteMenu(row, movie, buttonEl) {
            var existing = row.querySelector('.delete-menu');
            if (existing) {
                existing.remove();
                return;
            }

            var menu = document.createElement('div');
            menu.className = 'delete-menu';
            menu.style.cssText = 'position: absolute; background: #333; border: 1px solid #555; border-radius: 4px; padding: 0.3em 0; z-index: 100; min-width: 140px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);';

            var types = [
                { marker: 'IntroStart', label: 'IntroStart', ticks: movie.IntroStartTicks },
                { marker: 'IntroEnd', label: 'IntroEnd', ticks: movie.IntroEndTicks },
                { marker: 'CreditsStart', label: 'CreditsStart', ticks: movie.CreditsStartTicks }
            ];

            types.forEach(function (t) {
                if (!t.ticks) return;

                var item = document.createElement('div');
                item.style.cssText = 'padding: 0.4em 1em; cursor: pointer;';
                item.textContent = t.label;
                item.addEventListener('mouseenter', function () { this.style.backgroundColor = 'rgba(255,255,255,0.1)'; });
                item.addEventListener('mouseleave', function () { this.style.backgroundColor = ''; });
                item.addEventListener('click', function (e) {
                    e.stopPropagation();
                    menu.remove();
                    confirmMovieDelete(row, movie, t.marker);
                });
                menu.appendChild(item);
            });

            if (menu.children.length === 0) {
                helpers.showError('No segments to delete on this movie.');
                return;
            }

            buttonEl.style.position = 'relative';
            buttonEl.parentNode.style.position = 'relative';
            buttonEl.parentNode.appendChild(menu);

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

        function confirmMovieDelete(row, movie, markerType) {
            var msg = 'Delete ' + markerType + ' segment from "' + (movie.ItemName || 'this movie') + '"?';
            if (confirm(msg)) {
                helpers.showLoading();
                helpers.apiCall('delete_segment', 'POST', JSON.stringify({
                    ItemId: movie.ItemId,
                    MarkerType: markerType
                }))
                .then(function () {
                    helpers.hideLoading();
                    helpers.showSuccess(markerType + ' deleted successfully.');
                    refreshMovieRow(row, movie);
                })
                .catch(function (error) {
                    helpers.hideLoading();
                    console.error('Failed to delete segment:', error);
                    helpers.showError('Failed to delete segment.');
                });
            }
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

            helpers.loadPreferences().then(function () {
                loadLibraryData();
            });
        });

        helpers.registerChartCleanup(view, function () { return chart; }, function (v) { chart = v; });
    };
});
