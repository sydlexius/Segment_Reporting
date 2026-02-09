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
        var seriesData = [];
        var filteredData = [];
        var chart = null;
        var currentFilter = 'all';
        var currentSearch = '';
        var sortColumn = null;
        var sortAscending = true;

        /**
         * Load series list from API
         * @param {string} apiFilter - Optional filter to pass to API (missing_intro, missing_credits)
         */
        function loadSeriesList(apiFilter) {
            helpers.showLoading();

            var endpoint = 'series_list?libraryId=' + encodeURIComponent(libraryId);
            if (apiFilter && (apiFilter === 'missing_intro' || apiFilter === 'missing_credits')) {
                endpoint += '&filter=' + apiFilter;
            }

            helpers.apiCall(endpoint, 'GET')
                .then(function (data) {
                    seriesData = data || [];
                    applyClientFilters();
                    updatePageTitle();
                    updateChart();
                    updateTable();
                    helpers.hideLoading();
                })
                .catch(function (error) {
                    console.error('Failed to load series list:', error);
                    helpers.showError('Failed to load series data.');
                    helpers.hideLoading();
                });
        }

        /**
         * Update page title with library name (if available from data)
         */
        function updatePageTitle() {
            var title = 'Library';
            if (seriesData.length > 0 && seriesData[0].LibraryName) {
                title = 'Library: ' + seriesData[0].LibraryName;
            } else if (libraryId) {
                title = 'Library: ' + libraryId;
            }
            view.querySelector('#pageTitle').textContent = title;
        }

        /**
         * Apply client-side filters (complete, no_segments) and search
         */
        function applyClientFilters() {
            filteredData = seriesData.slice(); // Clone array

            // Apply coverage filter (client-side only filters)
            if (currentFilter === 'complete') {
                // Complete = has both intro and credits on all episodes
                filteredData = filteredData.filter(function (item) {
                    var total = item.TotalEpisodes || 0;
                    var withIntro = item.WithIntro || 0;
                    var withCredits = item.WithCredits || 0;
                    return total > 0 && withIntro === total && withCredits === total;
                });
            } else if (currentFilter === 'no_segments') {
                // No segments = neither intro nor credits
                filteredData = filteredData.filter(function (item) {
                    var withIntro = item.WithIntro || 0;
                    var withCredits = item.WithCredits || 0;
                    return withIntro === 0 && withCredits === 0;
                });
            }
            // Note: missing_intro and missing_credits are handled by API filter

            // Apply text search
            if (currentSearch) {
                var searchLower = currentSearch.toLowerCase();
                filteredData = filteredData.filter(function (item) {
                    var name = (item.SeriesName || '').toLowerCase();
                    return name.indexOf(searchLower) >= 0;
                });
            }
        }

        /**
         * Handle filter dropdown change
         */
        function handleFilterChange() {
            var newFilter = view.querySelector('#filterDropdown').value;
            currentFilter = newFilter;

            // API filters need a fresh data load
            if (newFilter === 'missing_intro' || newFilter === 'missing_credits') {
                loadSeriesList(newFilter);
            } else {
                // Client-side filters: complete, no_segments, all
                loadSeriesList(null); // Reload without API filter
            }
        }

        /**
         * Handle search box input
         */
        function handleSearch() {
            currentSearch = view.querySelector('#searchBox').value.trim();
            applyClientFilters();
            updateChart();
            updateTable();
        }

        /**
         * Get the sortable value for a given column key
         */
        function getSortValue(item, key) {
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

        /**
         * Sort filteredData by the current sort column and direction
         */
        function applySorting() {
            if (!sortColumn) return;
            var col = sortColumn;
            var asc = sortAscending;
            filteredData.sort(function (a, b) {
                var va = getSortValue(a, col);
                var vb = getSortValue(b, col);
                if (typeof va === 'string') {
                    var cmp = va.localeCompare(vb);
                    return asc ? cmp : -cmp;
                }
                return asc ? va - vb : vb - va;
            });
        }

        /**
         * Update sort arrow indicators in the table header
         */
        function updateSortIndicators() {
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

        /**
         * Handle column header click for sorting
         */
        function handleSortClick(e) {
            var th = e.target.closest('th[data-sort]');
            if (!th) return;
            var col = th.getAttribute('data-sort');
            if (sortColumn === col) {
                sortAscending = !sortAscending;
            } else {
                sortColumn = col;
                sortAscending = (col === 'name'); // default asc for name, desc for numbers
            }
            applySorting();
            updateSortIndicators();
            updateTable();
        }

        /**
         * Create or update the bar chart
         */
        function updateChart() {
            require([Dashboard.getConfigurationResourceUrl('segment_reporting_chart.min.js')], function (Chart) {
                var ctx = view.querySelector('#seriesChart').getContext('2d');

                var labels = filteredData.map(function (item) {
                    return item.SeriesName || 'Unknown';
                });

                var totalEpisodes = filteredData.map(function (item) {
                    return item.TotalEpisodes || 0;
                });

                var withIntro = filteredData.map(function (item) {
                    return item.WithIntro || 0;
                });

                var withCredits = filteredData.map(function (item) {
                    return item.WithCredits || 0;
                });

                // Calculate segments for stacked bars
                var withBoth = filteredData.map(function (item, idx) {
                    return Math.min(withIntro[idx], withCredits[idx]);
                });

                var introOnly = filteredData.map(function (item, idx) {
                    return withIntro[idx] - withBoth[idx];
                });

                var creditsOnly = filteredData.map(function (item, idx) {
                    return withCredits[idx] - withBoth[idx];
                });

                var withNeither = filteredData.map(function (item, idx) {
                    return totalEpisodes[idx] - withIntro[idx] - withCredits[idx] + withBoth[idx];
                });

                if (chart) {
                    chart.destroy();
                }

                // Get theme colors based on Emby's accent color
                var themeColors = helpers.getThemeColors(view);
                var palette = themeColors.chart;

                chart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: 'Both Segments',
                                data: withBoth,
                                backgroundColor: palette.bothSegments,
                                borderColor: palette.bothSegments,
                                borderWidth: 1
                            },
                            {
                                label: 'Intro Only',
                                data: introOnly,
                                backgroundColor: palette.introOnly,
                                borderColor: palette.introOnly,
                                borderWidth: 1
                            },
                            {
                                label: 'Credits Only',
                                data: creditsOnly,
                                backgroundColor: palette.creditsOnly,
                                borderColor: palette.creditsOnly,
                                borderWidth: 1
                            },
                            {
                                label: 'No Segments',
                                data: withNeither,
                                backgroundColor: palette.noSegments,
                                borderColor: palette.noSegments,
                                borderWidth: 1
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            legend: {
                                position: 'bottom',
                                labels: {
                                    color: themeColors.text
                                }
                            },
                            tooltip: {
                                mode: 'index',
                                intersect: false,
                                callbacks: {
                                    footer: function (tooltipItems) {
                                        var index = tooltipItems[0].dataIndex;
                                        var item = filteredData[index];
                                        var total = item.TotalEpisodes || 0;
                                        return 'Total: ' + total + ' items';
                                    }
                                }
                            }
                        },
                        scales: {
                            x: {
                                stacked: true,
                                ticks: {
                                    color: themeColors.text,
                                    maxRotation: 45,
                                    minRotation: 0
                                },
                                grid: {
                                    color: themeColors.gridColor
                                }
                            },
                            y: {
                                stacked: true,
                                ticks: {
                                    color: themeColors.text,
                                    beginAtZero: true
                                },
                                grid: {
                                    color: themeColors.gridColor
                                }
                            }
                        },
                        onClick: function (event, elements) {
                            if (elements && elements.length > 0) {
                                var index = elements[0].index;
                                var item = filteredData[index];
                                if (item && item.SeriesId) {
                                    helpers.navigate('segment_series', { seriesId: item.SeriesId });
                                }
                            }
                        }
                    }
                });
            });
        }

        /**
         * Update the series/movie table
         */
        function updateTable() {
            var tbody = view.querySelector('#seriesTableBody');
            tbody.innerHTML = '';

            if (filteredData.length === 0) {
                var emptyRow = document.createElement('tr');
                emptyRow.innerHTML = '<td colspan="7" style="text-align: center; padding: 2em;">No results found. Try adjusting your filters.</td>';
                tbody.appendChild(emptyRow);
                return;
            }

            applySorting();

            filteredData.forEach(function (item) {
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
                    '<td>' + (item.SeriesName || 'Unknown') + '</td>' +
                    '<td>' + totalItems.toLocaleString() + '</td>' +
                    '<td>' + withIntro.toLocaleString() + '</td>' +
                    '<td>' + withCredits.toLocaleString() + '</td>' +
                    '<td>' + withBoth.toLocaleString() + '</td>' +
                    '<td><strong>' + introPct + '</strong></td>' +
                    '<td><strong>' + creditsPct + '</strong></td>';

                row.addEventListener('click', function () {
                    helpers.navigate('segment_series', { seriesId: item.SeriesId });
                });

                row.addEventListener('mouseenter', function () {
                    this.style.backgroundColor = 'rgba(128, 128, 128, 0.15)';
                });
                row.addEventListener('mouseleave', function () {
                    this.style.backgroundColor = '';
                });

                tbody.appendChild(row);
            });
        }

        /**
         * Handle back button click
         */
        function handleBackClick() {
            helpers.navigate('segment_dashboard', {});
        }

        // View lifecycle events
        view.addEventListener('viewshow', function (e) {
            libraryId = helpers.getQueryParam('libraryId');

            if (!libraryId) {
                helpers.showError('No library ID provided. Please navigate from the dashboard.');
                return;
            }

            // Clear stored navigation params after consuming them
            helpers.clearNavParams();

            // Load initial data
            loadSeriesList();

            // Attach event listeners
            var btnBack = view.querySelector('#btnBackToDashboard');
            if (btnBack) {
                btnBack.addEventListener('click', handleBackClick);
            }

            var filterDropdown = view.querySelector('#filterDropdown');
            if (filterDropdown) {
                filterDropdown.addEventListener('change', handleFilterChange);
            }

            var thead = view.querySelector('#seriesTable thead');
            if (thead) {
                thead.addEventListener('click', handleSortClick);
            }

            var searchBox = view.querySelector('#searchBox');
            if (searchBox) {
                // Debounce search input
                var searchTimeout;
                searchBox.addEventListener('input', function () {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(handleSearch, 300);
                });
            }
        });

        view.addEventListener('viewhide', function (e) {
            if (chart) {
                chart.destroy();
                chart = null;
            }
        });

        view.addEventListener('viewdestroy', function (e) {
            if (chart) {
                chart.destroy();
                chart = null;
            }
        });
    };
});
