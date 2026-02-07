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

define([], function () {
    'use strict';

    var SegmentReportingHelpers = {
        /**
         * Convert ticks (100-nanosecond units) to HH:MM:SS.fff format
         * @param {number} ticks - Time in ticks
         * @returns {string} Formatted time string
         */
        ticksToTime: function (ticks) {
            if (!ticks || ticks === 0) {
                return '--:--:--.---';
            }

            var milliseconds = Math.floor(ticks / 10000);
            var seconds = Math.floor(milliseconds / 1000);
            var minutes = Math.floor(seconds / 60);
            var hours = Math.floor(minutes / 60);

            seconds = seconds % 60;
            minutes = minutes % 60;
            milliseconds = milliseconds % 1000;

            return this.pad(hours, 2) + ':' +
                   this.pad(minutes, 2) + ':' +
                   this.pad(seconds, 2) + '.' +
                   this.pad(milliseconds, 3);
        },

        /**
         * Convert HH:MM:SS.fff format to ticks
         * @param {string} timeStr - Time string in HH:MM:SS.fff format
         * @returns {number} Time in ticks
         */
        timeToTicks: function (timeStr) {
            if (!timeStr || timeStr === '--:--:--.---') {
                return 0;
            }

            var parts = timeStr.split(':');
            if (parts.length !== 3) {
                return 0;
            }

            var hours = parseInt(parts[0], 10) || 0;
            var minutes = parseInt(parts[1], 10) || 0;
            var secondsAndMs = parts[2].split('.');
            var seconds = parseInt(secondsAndMs[0], 10) || 0;
            var milliseconds = parseInt(secondsAndMs[1], 10) || 0;

            var totalMilliseconds = (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
            return totalMilliseconds * 10000;
        },

        /**
         * Pad a number with leading zeros
         * @param {number} num - Number to pad
         * @param {number} size - Desired size
         * @returns {string} Padded string
         */
        pad: function (num, size) {
            var s = num.toString();
            while (s.length < size) {
                s = '0' + s;
            }
            return s;
        },

        /**
         * Calculate percentage with one decimal place
         * @param {number} part - Part value
         * @param {number} total - Total value
         * @returns {string} Percentage string (e.g., "75.5%")
         */
        percentage: function (part, total) {
            if (!total || total === 0) {
                return '0.0%';
            }
            return ((part / total) * 100).toFixed(1) + '%';
        },

        /**
         * Format a relative time (e.g., "5 minutes ago", "2 hours ago")
         * @param {string} dateStr - ISO date string
         * @returns {string} Relative time string
         */
        relativeTime: function (dateStr) {
            if (!dateStr) {
                return 'Never';
            }

            var date = new Date(dateStr);
            var now = new Date();
            var diffMs = now - date;
            var diffSecs = Math.floor(diffMs / 1000);
            var diffMins = Math.floor(diffSecs / 60);
            var diffHours = Math.floor(diffMins / 60);
            var diffDays = Math.floor(diffHours / 24);

            if (diffSecs < 60) {
                return 'Just now';
            } else if (diffMins < 60) {
                return diffMins + ' minute' + (diffMins === 1 ? '' : 's') + ' ago';
            } else if (diffHours < 24) {
                return diffHours + ' hour' + (diffHours === 1 ? '' : 's') + ' ago';
            } else {
                return diffDays + ' day' + (diffDays === 1 ? '' : 's') + ' ago';
            }
        },

        /**
         * Navigate to a page with query parameters
         * @param {string} page - Page name (without .html)
         * @param {object} params - Query parameters as key-value pairs
         */
        navigate: function (page, params) {
            var queryString = Object.keys(params)
                .map(function (key) {
                    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
                })
                .join('&');

            var url = 'configurationpage?name=' + page;
            if (queryString) {
                url += '&' + queryString;
            }

            // Verify the target page exists before navigating to avoid crashing the view
            var checkUrl = ApiClient.getUrl('web/' + url);
            var xhr = new XMLHttpRequest();
            xhr.open('HEAD', checkUrl, true);
            xhr.onload = function () {
                if (xhr.status === 200) {
                    Dashboard.navigate(url);
                } else {
                    Dashboard.alert({
                        message: 'The ' + page + ' page is not yet available.',
                        title: 'Not Implemented'
                    });
                }
            };
            xhr.onerror = function () {
                Dashboard.alert({
                    message: 'The ' + page + ' page is not yet available.',
                    title: 'Not Implemented'
                });
            };
            xhr.send();
        },

        /**
         * Get query parameter from URL
         * @param {string} name - Parameter name
         * @returns {string|null} Parameter value or null
         */
        getQueryParam: function (name) {
            var urlParams = new URLSearchParams(window.location.search);
            return urlParams.get(name);
        },

        /**
         * Make an API call to segment_reporting endpoints
         * @param {string} endpoint - Endpoint path (without /emby/segment_reporting/ prefix)
         * @param {string} method - HTTP method (GET or POST)
         * @param {object} data - Request data (optional)
         * @returns {Promise} Promise resolving to response data
         */
        apiCall: function (endpoint, method, data) {
            method = method || 'GET';
            var url = ApiClient.getUrl('segment_reporting/' + endpoint);

            if (method === 'GET') {
                return ApiClient.getJSON(url);
            } else {
                return ApiClient.ajax({
                    type: method,
                    url: url,
                    data: data,
                    dataType: 'json',
                    contentType: 'application/json'
                });
            }
        },

        /**
         * Show loading indicator
         */
        showLoading: function () {
            Dashboard.showLoadingMsg();
        },

        /**
         * Hide loading indicator
         */
        hideLoading: function () {
            Dashboard.hideLoadingMsg();
        },

        /**
         * Show error message
         * @param {string} message - Error message
         */
        showError: function (message) {
            Dashboard.alert({
                message: message,
                title: 'Error'
            });
        },

        /**
         * Show success message
         * @param {string} message - Success message
         */
        showSuccess: function (message) {
            Dashboard.alert({
                message: message,
                title: 'Success'
            });
        }
    };

    return SegmentReportingHelpers;
});
