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

function segmentReportingTicksToTime(ticks) {
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

    return segmentReportingPad(hours, 2) + ':' +
           segmentReportingPad(minutes, 2) + ':' +
           segmentReportingPad(seconds, 2) + '.' +
           segmentReportingPad(milliseconds, 3);
}

function segmentReportingTimeToTicks(timeStr) {
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
}

function segmentReportingPad(num, size) {
    var s = num.toString();
    while (s.length < size) {
        s = '0' + s;
    }
    return s;
}

function segmentReportingPercentage(part, total) {
    if (!total || total === 0) {
        return '0.0%';
    }
    return ((part / total) * 100).toFixed(1) + '%';
}

function segmentReportingRelativeTime(dateStr) {
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
}

function segmentReportingNavigate(page, params) {
    var url = 'configurationpage?name=' + page;

    // Encode params directly in the URL so browser back/forward preserves them
    if (params && Object.keys(params).length > 0) {
        var keys = Object.keys(params);
        for (var i = 0; i < keys.length; i++) {
            if (params[keys[i]] != null) {
                url += '&' + encodeURIComponent(keys[i]) + '=' + encodeURIComponent(params[keys[i]]);
            }
        }
    }

    var knownPages = ['segment_dashboard', 'segment_library', 'segment_series', 'segment_settings', 'segment_custom_query', 'segment_about'];
    if (knownPages.indexOf(page) >= 0) {
        Dashboard.navigate(url);
        return;
    }

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
}

function segmentReportingGetQueryParam(name) {
    // Check URL search params (standard routing)
    var value = new URLSearchParams(window.location.search).get(name);
    if (value) return value;

    // Check hash-based routing (Emby may use #!/path?params format)
    var hash = window.location.hash || '';
    var qIdx = hash.indexOf('?');
    if (qIdx >= 0) {
        value = new URLSearchParams(hash.substring(qIdx)).get(name);
        if (value) return value;
    }

    return null;
}

function segmentReportingApiCall(endpoint, method, data) {
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
}

function segmentReportingShowLoading() {
    Dashboard.showLoadingMsg();
}

function segmentReportingHideLoading() {
    Dashboard.hideLoadingMsg();
}

function segmentReportingShowError(message) {
    Dashboard.alert({
        message: message,
        title: 'Error'
    });
}

function segmentReportingShowSuccess(message) {
    Dashboard.alert({
        message: message,
        title: 'Success'
    });
}

function segmentReportingLaunchPlayback(itemId, positionTicks) {
    if (!itemId) {
        return;
    }
    if (!positionTicks || positionTicks === 0) {
        return;
    }

    require(['playbackManager'], function (playbackManager) {
        ApiClient.getItem(ApiClient.getCurrentUserId(), itemId).then(function (item) {
            playbackManager.play({
                items: [item],
                startPositionTicks: positionTicks
            });
        }).catch(function (error) {
            console.error('Playback launch failed:', error);
            require(['toast'], function (toast) {
                toast({ type: 'error', text: 'Failed to start playback' });
            });
        });
    });
}

function segmentReportingRgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (x) {
        var hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
}

function segmentReportingHexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 82, g: 181, b: 75 };
}

function segmentReportingRgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100)
    };
}

function segmentReportingHslToRgb(h, s, l) {
    h /= 360;
    s /= 100;
    l /= 100;

    var r, g, b;

    if (s === 0) {
        r = g = b = l;
    } else {
        var hue2rgb = function (p, q, t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };

        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;

        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }

    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}

function segmentReportingHslToHexString(h, s, l) {
    var rgb = segmentReportingHslToRgb(h, s, l);
    return segmentReportingRgbToHex(rgb.r, rgb.g, rgb.b);
}

function segmentReportingDetectAccentColor(view) {
    var submitBtn = view.querySelector('.button-submit, .raised.button-submit');

    if (submitBtn) {
        var bgColor = getComputedStyle(submitBtn).backgroundColor;
        if (bgColor && bgColor.indexOf('rgb') === 0) {
            var rgbMatch = bgColor.match(/\d+/g);
            if (rgbMatch && rgbMatch.length >= 3) {
                var r = parseInt(rgbMatch[0], 10);
                var g = parseInt(rgbMatch[1], 10);
                var b = parseInt(rgbMatch[2], 10);
                return segmentReportingRgbToHex(r, g, b);
            }
        }
    }

    return '#52b54b';
}

// Chart color palettes sourced from https://coolors.co
var segmentReportingChartPalettes = [
    { name: 'Green (Default)',  accent: '#4CAF50', hue: 122, both: { light: '#087f23', dark: '#4caf50' }, intro: { light: '#003366', dark: '#2196f3' }, credits: { light: '#0069c0', dark: '#f26419' }, none: '#d90429' },
    { name: 'Blue',             accent: '#2196F3', hue: 207, both: { light: '#0061b0', dark: '#2196f3' }, intro: { light: '#1e88e5', dark: '#187ec7' }, credits: { light: '#151e2b', dark: '#bbdefb' }, none: '#d90429' },
    { name: 'Red',              accent: '#F44336', hue:   4, both: '#1565c0', intro: { light: '#ad1457', dark: '#ff9800' }, credits: { light: '#00796b', dark: '#8bc34a' }, none: '#d90429' },
    { name: 'Pink',             accent: '#F200A1', hue: 320, both: { light: '#e0115f', dark: '#fc0fc0' }, intro: { light: '#ff69b4', dark: '#ff66cc' }, credits: { light: '#ff0090', dark: '#ffa6c9' }, none: '#d90429' },
    { name: 'Purple',           accent: '#683AB7', hue: 271, both: { light: '#5b21b6', dark: '#a78bfa' }, intro: { light: '#b5179e', dark: '#f472b6' }, credits: { light: '#0e7490', dark: '#22d3ee' }, none: '#d90429' }
];

function segmentReportingGetPaletteByName(name) {
    var lower = name.toLowerCase();
    for (var i = 0; i < segmentReportingChartPalettes.length; i++) {
        if (segmentReportingChartPalettes[i].name.toLowerCase() === lower) {
            return segmentReportingFormatPalette(segmentReportingChartPalettes[i]);
        }
    }
    return segmentReportingFormatPalette(segmentReportingChartPalettes[0]);
}

function segmentReportingFormatPalette(entry) {
    return {
        name: entry.name,
        bothSegments: entry.both,
        introOnly: entry.intro,
        creditsOnly: entry.credits,
        noSegments: entry.none
    };
}

function segmentReportingGenerateChartPalette(accentHex) {
    var rgb = segmentReportingHexToRgb(accentHex);
    var hsl = segmentReportingRgbToHsl(rgb.r, rgb.g, rgb.b);
    var h = hsl.h;

    var best = segmentReportingChartPalettes[0];
    var bestDist = 360;
    for (var i = 0; i < segmentReportingChartPalettes.length; i++) {
        var d = Math.abs(h - segmentReportingChartPalettes[i].hue);
        if (d > 180) d = 360 - d;
        if (d < bestDist) { bestDist = d; best = segmentReportingChartPalettes[i]; }
    }

    return segmentReportingFormatPalette(best);
}

function segmentReportingEscHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function segmentReportingGetThemeColors(view) {
    var accentColor = segmentReportingDetectAccentColor(view);
    var palette;
    var prefs = segmentReportingPreferencesCache;

    if (prefs && prefs.chartPalette && prefs.chartPalette !== 'auto') {
        if (prefs.chartPalette === 'custom') {
            palette = {
                name: 'Custom',
                bothSegments: prefs.customColorBoth || '#003366',
                introOnly: prefs.customColorIntro || '#87CEEB',
                creditsOnly: prefs.customColorCredits || '#F5F5DC',
                noSegments: prefs.customColorNone || '#d90429'
            };
        } else {
            palette = segmentReportingGetPaletteByName(prefs.chartPalette);
        }
    } else {
        palette = segmentReportingGenerateChartPalette(accentColor);
    }

    var isLight = segmentReportingIsLightTheme(view);
    palette.bothSegments = segmentReportingResolveColor(palette.bothSegments, isLight);
    palette.introOnly = segmentReportingResolveColor(palette.introOnly, isLight);
    palette.creditsOnly = segmentReportingResolveColor(palette.creditsOnly, isLight);
    palette.noSegments = segmentReportingResolveColor(palette.noSegments, isLight);

    var textColor = getComputedStyle(view).color || '#fff';

    return {
        accent: accentColor,
        text: textColor,
        chart: palette,
        cardBackground: 'rgba(128, 128, 128, 0.1)',
        hoverBackground: 'rgba(128, 128, 128, 0.15)',
        gridColor: '#99999944'
    };
}

function segmentReportingFormatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    var value = bytes;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return value.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function segmentReportingFormatDuration(ms) {
    if (!ms || ms === 0) return '-';
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
}

function segmentReportingRenderTimestamp(ticks, itemId) {
    var display = segmentReportingTicksToTime(ticks);
    if (!ticks || ticks === 0) {
        return display;
    }
    return '<a href="#" class="timestamp-link" data-ticks="' + ticks + '" data-item-id="' + segmentReportingEscHtml(itemId) + '" ' +
           'title="Click to play at ' + display + '" ' +
           'style="color: inherit; text-decoration: none; border-bottom: 1px dotted currentColor; cursor: pointer;">' +
           display + '</a>';
}

function segmentReportingApiCallWithLoading(endpoint, method, data) {
    segmentReportingShowLoading();
    return segmentReportingApiCall(endpoint, method, data)
        .then(function (result) { segmentReportingHideLoading(); return result; })
        .catch(function (err) { segmentReportingShowError(err.message || 'Request failed'); segmentReportingHideLoading(); throw err; });
}

function segmentReportingAttachHoverEffect(element, hoverBg, normalBg) {
    element.addEventListener('mouseenter', function () { this.style.backgroundColor = hoverBg || 'rgba(128,128,128,0.15)'; });
    element.addEventListener('mouseleave', function () { this.style.backgroundColor = normalBg || ''; });
}

function segmentReportingCreateEmptyRow(message, colspan) {
    var row = document.createElement('tr');
    row.innerHTML = '<td colspan="' + colspan + '" style="text-align:center;padding:2em;">' + segmentReportingEscHtml(message) + '</td>';
    return row;
}

function segmentReportingRegisterChartCleanup(view, getChart, setChart) {
    ['viewhide', 'viewdestroy'].forEach(function (evt) {
        view.addEventListener(evt, function () {
            var c = getChart();
            if (c) { c.destroy(); setChart(null); }
        });
    });
}

var segmentReportingCreditsDetectorCache = null;

function segmentReportingCheckCreditsDetector() {
    if (segmentReportingCreditsDetectorCache !== null) {
        return Promise.resolve(segmentReportingCreditsDetectorCache);
    }

    var url = ApiClient.getUrl('CreditsDetector/GetAllSeries');
    return ApiClient.ajax({ type: 'GET', url: url, dataType: 'json' })
        .then(function () {
            segmentReportingCreditsDetectorCache = true;
            return true;
        })
        .catch(function () {
            segmentReportingCreditsDetectorCache = false;
            return false;
        });
}

function segmentReportingCreditsDetectorCall(endpoint, queryParams) {
    var url = ApiClient.getUrl('CreditsDetector/' + endpoint, queryParams || {});
    return ApiClient.ajax({ type: 'POST', url: url, dataType: 'json' });
}

var segmentReportingPreferencesCache = null;

function segmentReportingLoadPreferences() {
    if (segmentReportingPreferencesCache !== null) {
        return Promise.resolve(segmentReportingPreferencesCache);
    }
    return segmentReportingApiCall('preferences', 'GET')
        .then(function (prefs) {
            segmentReportingPreferencesCache = prefs || {};
            return segmentReportingPreferencesCache;
        })
        .catch(function () {
            segmentReportingPreferencesCache = {};
            return segmentReportingPreferencesCache;
        });
}

function segmentReportingInvalidatePreferencesCache() {
    segmentReportingPreferencesCache = null;
}

function segmentReportingGetPreference(key) {
    if (segmentReportingPreferencesCache) {
        return segmentReportingPreferencesCache[key] || null;
    }
    return null;
}

function segmentReportingRenderBreadcrumbs(container, crumbs) {
    // crumbs: array of { label, page, params } objects
    // Last crumb is the current page (rendered as plain text), others are clickable links
    container.innerHTML = '';
    container.style.cssText = 'margin-bottom: 1em; font-size: 0.95em; display: flex; align-items: center; flex-wrap: wrap; gap: 0.25em;';

    for (var i = 0; i < crumbs.length; i++) {
        var crumb = crumbs[i];
        var isLast = (i === crumbs.length - 1);

        if (i > 0) {
            var sep = document.createElement('span');
            sep.textContent = '\u203A';
            sep.style.cssText = 'opacity: 0.5; margin: 0 0.35em; font-size: 1.1em;';
            container.appendChild(sep);
        }

        if (isLast) {
            var span = document.createElement('span');
            span.textContent = crumb.label;
            span.style.cssText = 'opacity: 0.7;';
            container.appendChild(span);
        } else {
            var link = document.createElement('a');
            link.textContent = crumb.label;
            link.href = '#';
            link.style.cssText = 'color: inherit; text-decoration: none; border-bottom: 1px dotted currentColor; cursor: pointer;';
            link.setAttribute('data-page', crumb.page);
            link.setAttribute('data-params', JSON.stringify(crumb.params || {}));
            link.addEventListener('click', function (e) {
                e.preventDefault();
                var page = this.getAttribute('data-page');
                var params = JSON.parse(this.getAttribute('data-params'));
                segmentReportingNavigate(page, params);
            });
            link.addEventListener('mouseenter', function () { this.style.opacity = '0.7'; });
            link.addEventListener('mouseleave', function () { this.style.opacity = '1'; });
            container.appendChild(link);
        }
    }
}

function segmentReportingApplyTableStyles(tableElement) {
    if (!tableElement) return;
    var prefs = segmentReportingPreferencesCache || {};
    var showGridlines = prefs.tableGridlines === 'true';
    var showStriped = prefs.tableStripedRows === 'true';

    var cells = tableElement.querySelectorAll('th, td');
    for (var i = 0; i < cells.length; i++) {
        if (showGridlines) {
            cells[i].style.borderBottom = '1px solid rgba(128, 128, 128, 0.25)';
            cells[i].style.borderRight = '1px solid rgba(128, 128, 128, 0.15)';
        } else {
            cells[i].style.borderBottom = '';
            cells[i].style.borderRight = '';
        }
    }

    var rows = tableElement.querySelectorAll('tbody tr');
    for (var j = 0; j < rows.length; j++) {
        if (showStriped && j % 2 === 1) {
            rows[j].style.backgroundColor = 'rgba(128, 128, 128, 0.08)';
        } else if (!showStriped) {
            rows[j].style.backgroundColor = '';
        }
    }
}

function segmentReportingWithButtonLoading(btn, workingText, promise) {
    var span = btn.querySelector('span');
    var original = span.textContent;
    btn.disabled = true;
    span.textContent = workingText;
    return promise.then(function (result) {
        btn.disabled = false;
        span.textContent = original;
        return result;
    }).catch(function (err) {
        btn.disabled = false;
        span.textContent = original;
        throw err;
    });
}

function segmentReportingGuardButton(btn, asyncFn) {
    if (btn.disabled) return Promise.resolve();
    btn.disabled = true;
    var result;
    try {
        result = asyncFn();
    } catch (e) {
        btn.disabled = false;
        return Promise.reject(e);
    }
    if (result && typeof result.then === 'function') {
        return result.then(
            function (v) { btn.disabled = false; return v; },
            function (e) { btn.disabled = false; throw e; }
        );
    }
    btn.disabled = false;
    return Promise.resolve(result);
}

function segmentReportingCreateSegmentChart(Chart, ctx, labels, segmentData, view, options) {
    options = options || {};
    var themeColors = segmentReportingGetThemeColors(view);
    var palette = themeColors.chart;
    var xTicks = { color: themeColors.text };
    if (options.xTickOptions) {
        var xKeys = Object.keys(options.xTickOptions);
        for (var xi = 0; xi < xKeys.length; xi++) {
            xTicks[xKeys[xi]] = options.xTickOptions[xKeys[xi]];
        }
    }
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Both Segments', data: segmentData.withBoth, backgroundColor: palette.bothSegments, borderColor: palette.bothSegments, borderWidth: 1 },
                { label: 'Intro Only', data: segmentData.introOnly, backgroundColor: palette.introOnly, borderColor: palette.introOnly, borderWidth: 1 },
                { label: 'Credits Only', data: segmentData.creditsOnly, backgroundColor: palette.creditsOnly, borderColor: palette.creditsOnly, borderWidth: 1 },
                { label: 'No Segments', data: segmentData.withNeither, backgroundColor: palette.noSegments, borderColor: palette.noSegments, borderWidth: 1 }
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
                    callbacks: options.tooltipCallbacks || {}
                }
            },
            scales: {
                x: { stacked: true, ticks: xTicks, grid: { color: themeColors.gridColor } },
                y: { stacked: true, ticks: { color: themeColors.text, beginAtZero: true }, grid: { color: themeColors.gridColor } }
            },
            onClick: options.onClick || undefined
        }
    });
}

function segmentReportingShowBulkResult(prefix, result) {
    if (!result) return;
    var resultMsg = prefix + ': ' + result.succeeded + ' succeeded';
    if (result.failed > 0) {
        resultMsg += ', ' + result.failed + ' failed';
        if (result.errors && result.errors.length > 0) {
            resultMsg += '\n\nErrors:\n' + result.errors.join('\n');
        }
        segmentReportingShowError(resultMsg);
    } else {
        segmentReportingShowSuccess(resultMsg);
    }
}

function segmentReportingBulkDelete(itemIds, markerTypes) {
    if (!itemIds || itemIds.length === 0) {
        segmentReportingShowError('No items to delete from.');
        return Promise.resolve(null);
    }

    var typeLabel = markerTypes.indexOf('CreditsStart') >= 0 ? 'credits' : 'intro';
    var msg = 'Delete all ' + typeLabel + ' segments from ' + itemIds.length + ' item(s)?\n\nThis cannot be undone.';
    if (!confirm(msg)) return Promise.resolve(null);

    segmentReportingShowLoading();

    return segmentReportingApiCall('bulk_delete', 'POST', JSON.stringify({
        ItemIds: itemIds.join(','),
        MarkerTypes: markerTypes.join(',')
    }))
    .then(function (result) {
        segmentReportingHideLoading();
        segmentReportingShowBulkResult('Bulk delete complete', result);
        return result;
    })
    .catch(function (error) {
        segmentReportingHideLoading();
        console.error('Bulk delete failed:', error);
        segmentReportingShowError('Bulk delete failed: ' + (error.message || 'Unknown error'));
        return null;
    });
}

function segmentReportingBulkSetCreditsEnd(itemIds, offsetTicks) {
    if (!itemIds || itemIds.length === 0) {
        segmentReportingShowError('No items to update.');
        return Promise.resolve(null);
    }

    var msg = 'Set CreditsStart to end of episode for ' + itemIds.length + ' item(s)?\n\nThis marks each item as having credits at its runtime end.';
    if (!confirm(msg)) return Promise.resolve(null);

    segmentReportingShowLoading();

    return segmentReportingApiCall('bulk_set_credits_end', 'POST', JSON.stringify({
        ItemIds: itemIds.join(','),
        OffsetTicks: offsetTicks || 0
    }))
    .then(function (result) {
        segmentReportingHideLoading();
        segmentReportingShowBulkResult('Set credits to end', result);
        return result;
    })
    .catch(function (error) {
        segmentReportingHideLoading();
        console.error('Bulk set credits to end failed:', error);
        segmentReportingShowError('Bulk set credits to end failed: ' + (error.message || 'Unknown error'));
        return null;
    });
}

function segmentReportingBulkDetectCredits(items) {
    if (!items || items.length === 0) {
        segmentReportingShowError('No items to detect credits for.');
        return Promise.resolve(null);
    }

    var msg = 'Detect credits for ' + items.length + ' item(s) using EmbyCredits? This runs in the background and may take a while.';
    if (!confirm(msg)) return Promise.resolve(null);

    segmentReportingShowLoading();

    var succeeded = 0;
    var failed = 0;
    var errors = [];

    var chain = Promise.resolve();
    items.forEach(function (item) {
        var itemId = typeof item === 'string' ? item : item.ItemId;
        var itemName = typeof item === 'string' ? item : (item.ItemName || item.ItemId);
        chain = chain.then(function () {
            return segmentReportingCreditsDetectorCall('ProcessEpisode', { ItemId: itemId })
                .then(function () { succeeded++; })
                .catch(function (err) {
                    failed++;
                    errors.push(itemName + ': ' + (err.message || 'failed'));
                });
        });
    });

    return chain.then(function () {
        segmentReportingHideLoading();
        var result = { succeeded: succeeded, failed: failed, errors: errors };
        segmentReportingShowBulkResult('Credits detection queued', result);
        return result;
    });
}

// ── Dropdown menu infrastructure (shared by series + custom query pages) ──

function segmentReportingGetMenuColors(viewEl) {
    var bg = segmentReportingDetectDropdownBg(viewEl);
    var isLight = segmentReportingIsLightBackground(bg);
    return {
        bg: bg,
        border: isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)',
        hoverBg: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)',
        dimmed: isLight ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)',
        divider: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
    };
}

function segmentReportingCreateMenuItem(label, enabled, colors, onClick) {
    var item = document.createElement('div');
    item.style.cssText = 'padding: 0.4em 1em; white-space: nowrap;' +
        (enabled ? ' cursor: pointer;' : ' opacity: 0.4; cursor: default;');
    item.textContent = label;
    if (enabled) {
        item.addEventListener('mouseenter', function () { this.style.backgroundColor = colors.hoverBg; });
        item.addEventListener('mouseleave', function () { this.style.backgroundColor = ''; });
        item.addEventListener('click', onClick);
    }
    return item;
}

function segmentReportingCreateMenuDivider(colors) {
    var div = document.createElement('div');
    div.style.cssText = 'height: 1px; margin: 0.3em 0; background-color: ' + colors.divider + ';';
    return div;
}

function segmentReportingCreateSubmenuItem(label, subItems, anyEnabled, colors) {
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'position: relative;';

    var item = document.createElement('div');
    item.style.cssText = 'padding: 0.4em 1em; white-space: nowrap; display: flex; justify-content: space-between; align-items: center;' +
        (anyEnabled ? ' cursor: pointer;' : ' opacity: 0.4; cursor: default;');

    var labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    item.appendChild(labelSpan);

    var arrow = document.createElement('span');
    arrow.textContent = ' \u25B6';
    arrow.style.cssText = 'margin-left: 1.5em; font-size: 0.65em;';
    item.appendChild(arrow);

    wrapper.appendChild(item);

    if (!anyEnabled) return wrapper;

    var submenu = document.createElement('div');
    submenu.style.cssText = 'position: absolute; right: 100%; top: -0.3em; background: ' + colors.bg +
        '; border: 1px solid ' + colors.border +
        '; border-radius: 4px; padding: 0.3em 0; z-index: 101; min-width: 140px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: none;';

    subItems.forEach(function (si) {
        submenu.appendChild(segmentReportingCreateMenuItem(si.label, si.enabled, colors, si.onClick));
    });

    wrapper.appendChild(submenu);

    var hideTimer = null;
    function showSub() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        submenu.style.display = 'block';
        item.style.backgroundColor = colors.hoverBg;
        // Flip to right if submenu overflows left edge of viewport
        var rect = submenu.getBoundingClientRect();
        if (rect.left < 0) {
            submenu.style.right = 'auto';
            submenu.style.left = '100%';
        }
    }
    function scheduleSub() {
        hideTimer = setTimeout(function () {
            submenu.style.display = 'none';
            item.style.backgroundColor = '';
        }, 200);
    }

    item.addEventListener('mouseenter', showSub);
    item.addEventListener('mouseleave', scheduleSub);
    submenu.addEventListener('mouseenter', showSub);
    submenu.addEventListener('mouseleave', scheduleSub);

    // Toggle on click for touch
    item.addEventListener('click', function (e) {
        e.stopPropagation();
        if (submenu.style.display === 'block') {
            submenu.style.display = 'none';
            item.style.backgroundColor = '';
        } else {
            showSub();
        }
    });

    return wrapper;
}

function segmentReportingPositionMenuBelowButton(menu, buttonEl) {
    var parent = buttonEl.parentNode;
    parent.style.position = 'relative';
    parent.style.zIndex = '10'; // Elevate above sibling sticky cells
    parent.appendChild(menu);
    var btnRect = buttonEl.getBoundingClientRect();
    var parentRect = parent.getBoundingClientRect();
    menu.style.top = (btnRect.bottom - parentRect.top) + 'px';
    // Right-align the menu to the button to avoid overflowing the table
    menu.style.right = (parentRect.right - btnRect.right) + 'px';
}

function segmentReportingAttachMenuCloseHandler(menu) {
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

function segmentReportingCreateActionsMenu(colors) {
    var menu = document.createElement('div');
    menu.className = 'actions-menu';
    menu.style.cssText = 'position: absolute; background: ' + colors.bg +
        '; border: 1px solid ' + colors.border +
        '; border-radius: 4px; padding: 0.3em 0; z-index: 100; min-width: 180px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);';

    // Override remove() so the parent cell's z-index is always restored,
    // regardless of which code path closes the menu (toggle, click-away, action).
    var origRemove = menu.remove.bind(menu);
    menu.remove = function () {
        if (menu.parentNode) menu.parentNode.style.zIndex = '';
        origRemove();
    };

    return menu;
}

function segmentReportingDetectDropdownBg(viewEl) {
    var el = viewEl;
    while (el) {
        var bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
            return bg;
        }
        el = el.parentElement;
    }
    return '#1a1a1a';
}

function segmentReportingIsLightBackground(bgColor) {
    var match = bgColor.match(/\d+/g);
    if (match && match.length >= 3) {
        var r = parseInt(match[0], 10);
        var g = parseInt(match[1], 10);
        var b = parseInt(match[2], 10);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
    }
    return false;
}

function segmentReportingIsLightTheme(view) {
    var bg = segmentReportingDetectDropdownBg(view);
    if (bg.charAt(0) === '#') {
        var hex = bg.replace('#', '');
        var r = parseInt(hex.substr(0, 2), 16);
        var g = parseInt(hex.substr(2, 2), 16);
        var b = parseInt(hex.substr(4, 2), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
    }
    return segmentReportingIsLightBackground(bg);
}

function segmentReportingResolveColor(color, isLight) {
    if (typeof color === 'string') return color;
    if (color && typeof color === 'object') {
        return isLight ? (color.light || color.dark) : (color.dark || color.light);
    }
    return '#888888';
}

// ── Shared inline editing ──

function segmentReportingCreateInlineEditor(config) {
    // config (required):
    //   row             - the <tr> element to edit
    //   getCellValue    - function(cell) returning current tick value for a .tick-cell
    //   getItemId       - function() returning the ItemId for API calls
    //   restoreCell     - function(cell) to restore a tick-cell's display content
    //   restoreActions  - function(actionsCell) to restore action buttons
    // config (optional):
    //   allowDelete          - boolean, empty input = delete segment (default true)
    //   actionsCellSelector  - CSS selector for the actions cell (default 'td:last-child')
    //   getRowBackground     - function() returning background color for non-editing state
    //   onStart              - function() called after edit UI is set up
    //   onSaveComplete       - function(updates) called after API success
    //   onCancel             - function() called after cancel completes

    var row = config.row;
    var active = false;

    function getMarkerType(cell) {
        var marker = cell.getAttribute('data-marker');
        if (marker) return marker;
        var col = cell.getAttribute('data-column');
        if (col) return col.replace(/Ticks$/, '');
        return '';
    }

    function getActionsCell() {
        return row.querySelector(config.actionsCellSelector || 'td:last-child');
    }

    function restoreDisplay() {
        active = false;
        row.classList.remove('editing');
        row.style.backgroundColor = config.getRowBackground ? config.getRowBackground() : '';

        var tickCells = row.querySelectorAll('.tick-cell');
        for (var i = 0; i < tickCells.length; i++) {
            config.restoreCell(tickCells[i]);
        }

        var actionsCell = getActionsCell();
        if (actionsCell) {
            config.restoreActions(actionsCell);
        }
    }

    function start() {
        active = true;
        row.classList.add('editing');
        row.style.backgroundColor = 'rgba(255, 235, 59, 0.1)';

        var tickCells = row.querySelectorAll('.tick-cell');
        for (var i = 0; i < tickCells.length; i++) {
            var cell = tickCells[i];
            var currentTicks = config.getCellValue(cell);
            var currentDisplay = segmentReportingTicksToTime(currentTicks);

            cell.setAttribute('data-original-ticks', currentTicks || '');

            var input = document.createElement('input');
            input.type = 'text';
            input.value = currentTicks ? currentDisplay : '';
            input.placeholder = '00:00:00.000';
            input.style.cssText = 'width: 120px; text-align: center; font-size: inherit; font-family: inherit; color: inherit; background: transparent; border: 1px solid rgba(128,128,128,0.4); border-radius: 3px; padding: 0.1em 0.3em;';

            cell.innerHTML = '';
            cell.appendChild(input);
        }

        var actionsCell = getActionsCell();
        if (actionsCell) {
            actionsCell.innerHTML =
                '<button class="raised emby-button btn-save" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em; background-color: #4CAF50;">Save</button>' +
                '<button class="raised button-cancel emby-button btn-cancel" style="margin: 0 0.2em; padding: 0.3em 0.6em; font-size: 0.85em;">Cancel</button>';

            actionsCell.querySelector('.btn-save').addEventListener('click', function (e) {
                e.stopPropagation();
                save();
            });
            actionsCell.querySelector('.btn-cancel').addEventListener('click', function (e) {
                e.stopPropagation();
                cancel();
            });
        }

        if (config.onStart) config.onStart();
    }

    function save() {
        var saveBtn = row.querySelector('.btn-save');
        if (saveBtn) saveBtn.disabled = true;

        var inputs = row.querySelectorAll('.tick-cell input');
        var updates = [];
        var allowDelete = config.allowDelete !== false;

        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            var cell = input.parentElement;
            var originalTicks = parseInt(cell.getAttribute('data-original-ticks'), 10) || 0;
            var newValue = input.value.trim();

            if (!newValue) {
                if (allowDelete && originalTicks > 0) {
                    updates.push({ cell: cell, type: 'delete', marker: getMarkerType(cell) });
                }
                continue;
            }

            var newTicks = segmentReportingTimeToTicks(newValue);
            if (newTicks === 0 && newValue !== '00:00:00.000') {
                if (saveBtn) saveBtn.disabled = false;
                segmentReportingShowError('Invalid time format for ' + getMarkerType(cell) + '. Use HH:MM:SS.fff');
                return;
            }

            if (newTicks !== originalTicks) {
                updates.push({ cell: cell, type: 'update', marker: getMarkerType(cell), ticks: newTicks });
            }
        }

        if (updates.length === 0) {
            cancel();
            return;
        }

        segmentReportingShowLoading();

        var itemId = config.getItemId();
        var chain = Promise.resolve();
        for (var j = 0; j < updates.length; j++) {
            (function (update) {
                chain = chain.then(function () {
                    if (update.type === 'delete') {
                        return segmentReportingApiCall('delete_segment', 'POST', JSON.stringify({
                            ItemId: itemId,
                            MarkerType: update.marker
                        }));
                    }
                    return segmentReportingApiCall('update_segment', 'POST', JSON.stringify({
                        ItemId: itemId,
                        MarkerType: update.marker,
                        Ticks: update.ticks
                    }));
                });
            })(updates[j]);
        }

        chain
            .then(function () {
                segmentReportingHideLoading();
                segmentReportingShowSuccess('Segments updated successfully.');
                if (config.onSaveComplete) config.onSaveComplete(updates);
            })
            .catch(function (error) {
                segmentReportingHideLoading();
                console.error('Failed to save segments:', error);
                segmentReportingShowError('Failed to save segment changes.');
            });
    }

    function cancel() {
        restoreDisplay();
        if (config.onCancel) config.onCancel();
    }

    return {
        start: start,
        save: save,
        cancel: cancel,
        restoreDisplay: restoreDisplay,
        isActive: function () { return active; }
    };
}

// ── Offset adjustment (issue #80) ──

var SEGMENT_REPORTING_OFFSET_STEP_TICKS = 2500000; // 250ms

// items: array of { ItemId, introStart, introEnd, credits } where each tick
// field is a number (absolute target) or null/undefined (leave untouched).
// Produces the index-aligned, comma-separated body for bulk_set_segments.
// A column that is untouched for ALL items is sent as an empty string.
function segmentReportingBuildBulkSetBody(items) {
    var ids = [];
    var intro = [];
    var introEnd = [];
    var credits = [];

    items.forEach(function (it) {
        ids.push(it.ItemId);
        intro.push(it.introStart != null ? String(it.introStart) : '');
        introEnd.push(it.introEnd != null ? String(it.introEnd) : '');
        credits.push(it.credits != null ? String(it.credits) : '');
    });

    function allEmpty(arr) {
        return arr.every(function (x) { return x === ''; });
    }

    return {
        ItemIds: ids.join(','),
        IntroStartTicks: allEmpty(intro) ? '' : intro.join(','),
        IntroEndTicks: allEmpty(introEnd) ? '' : introEnd.join(','),
        CreditsStartTicks: allEmpty(credits) ? '' : credits.join(',')
    };
}

function segmentReportingApplyBulkSet(items) {
    var body = segmentReportingBuildBulkSetBody(items);
    return segmentReportingApiCall('bulk_set_segments', 'POST', JSON.stringify(body))
        .then(function (res) {
            if (res && res.error) {
                return Promise.reject(new Error(res.error));
            }
            return res;
        });
}

// Strict variant for undo/restore flows. The main-apply callers inspect
// res.failed themselves (to show "Adjusted X, Y failed" partial-success
// messaging), but undo handlers rely on promise rejection to keep the
// snackbar open. This variant also rejects on in-band item failures so a
// failed restore cannot dismiss as if it succeeded.
function segmentReportingApplyBulkSetStrict(items) {
    return segmentReportingApplyBulkSet(items).then(function (res) {
        if (res && res.failed > 0) {
            var msg = res.errors && res.errors.length
                ? res.errors.join('; ')
                : res.failed + ' item(s) failed';
            return Promise.reject(new Error(msg));
        }
        return res;
    });
}

// config:
//   title    - string heading
//   mode     - 'individual' | 'bulk'
//   isLight  - boolean (theme)
//   current  - individual only: { introStart, introEnd, credits } absolute ticks
//              or null when that marker is absent (its row is disabled)
//   onApply  - function(result): may return a Promise. Modal closes on resolve.
//              individual result: { introStart, introEnd, credits } absolute (or null)
//              bulk result:       { introDelta, introEndDelta, creditsDelta } in ticks
//   onClose  - optional function() called after the modal is dismissed
function segmentReportingCreateOffsetModal(config) {
    if (document.querySelector('.segment-offset-overlay')) {
        return null;
    }
    var STEP = SEGMENT_REPORTING_OFFSET_STEP_TICKS;
    var isBulk = config.mode === 'bulk';

    var overlay = document.createElement('div');
    overlay.className = 'segment-offset-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;';

    var dialog = document.createElement('div');
    dialog.style.cssText = 'background: ' + (config.isLight ? '#ffffff' : '#1f1f1f') +
        '; color: ' + (config.isLight ? '#000000' : '#ffffff') +
        '; border-radius: 6px; padding: 1.25em 1.5em; min-width: 360px; max-width: 90vw; box-shadow: 0 4px 24px rgba(0,0,0,0.4);';

    var heading = document.createElement('h3');
    heading.textContent = config.title;
    heading.style.cssText = 'margin: 0 0 0.75em 0; font-size: 1.1em;';
    dialog.appendChild(heading);

    var state;
    if (isBulk) {
        state = { introDelta: 0, introEndDelta: 0, creditsDelta: 0 };
    } else {
        var c = config.current || {};
        state = {
            introStart: c.introStart != null ? c.introStart : null,
            introEnd: c.introEnd != null ? c.introEnd : null,
            credits: c.credits != null ? c.credits : null
        };
    }

    function fmtDelta(ticks) {
        if (!ticks) { return '0'; }
        return (ticks < 0 ? '-' : '+') + segmentReportingTicksToTime(Math.abs(ticks));
    }

    var rows = [];
    if (isBulk) {
        rows.push({ label: 'Intro', hint: 'moves whole intro', enabled: true,
            step: function (d) { state.introDelta += d * STEP; },
            leftDisabled: function () { return false; },
            display: function () { return fmtDelta(state.introDelta); } });
        rows.push({ label: 'Intro end', hint: 'trim / extend end', enabled: true,
            step: function (d) { state.introEndDelta += d * STEP; },
            leftDisabled: function () { return false; },
            display: function () { return fmtDelta(state.introEndDelta); } });
        rows.push({ label: 'Credits', hint: '', enabled: true,
            step: function (d) { state.creditsDelta += d * STEP; },
            leftDisabled: function () { return false; },
            display: function () { return fmtDelta(state.creditsDelta); } });
    } else {
        var hasIntro = state.introStart != null && state.introEnd != null;
        rows.push({ label: 'Intro', hint: 'moves whole intro, keeps length', enabled: hasIntro,
            step: function (d) {
                var delta = d * STEP;
                if (delta < 0) {
                    var present = [];
                    if (state.introStart != null) { present.push(state.introStart); }
                    if (state.introEnd != null) { present.push(state.introEnd); }
                    var floor = present.length ? Math.min.apply(null, present) : 0;
                    if (delta < -floor) { delta = -floor; }
                }
                if (state.introStart != null) { state.introStart += delta; }
                if (state.introEnd != null) { state.introEnd += delta; }
            },
            leftDisabled: function () {
                var vals = [];
                if (state.introStart != null) { vals.push(state.introStart); }
                if (state.introEnd != null) { vals.push(state.introEnd); }
                return vals.length === 0 || Math.min.apply(null, vals) <= 0;
            },
            display: function () {
                return segmentReportingTicksToTime(state.introStart) + ' -> ' + segmentReportingTicksToTime(state.introEnd);
            } });
        rows.push({ label: 'Intro end', hint: 'trim / extend the end only', enabled: state.introEnd != null,
            step: function (d) {
                if (state.introEnd != null) {
                    var floor = state.introStart != null ? state.introStart : 0;
                    state.introEnd = Math.max(floor, state.introEnd + d * STEP);
                }
            },
            leftDisabled: function () {
                var floor = state.introStart != null ? state.introStart : 0;
                return state.introEnd == null || state.introEnd <= floor;
            },
            display: function () { return segmentReportingTicksToTime(state.introEnd); } });
        rows.push({ label: 'Credits', hint: '', enabled: state.credits != null,
            step: function (d) { if (state.credits != null) { state.credits = Math.max(0, state.credits + d * STEP); } },
            leftDisabled: function () { return state.credits == null || state.credits <= 0; },
            display: function () { return segmentReportingTicksToTime(state.credits); } });
    }

    var refreshers = [];
    rows.forEach(function (r) {
        var rowEl = document.createElement('div');
        rowEl.style.cssText = 'display: flex; align-items: center; gap: 0.5em; margin: 0.5em 0; flex-wrap: wrap;' + (r.enabled ? '' : ' opacity: 0.4;');

        var labelEl = document.createElement('div');
        labelEl.textContent = r.label;
        labelEl.style.cssText = 'width: 5.5em; flex: 0 0 auto;';

        var leftBtn = document.createElement('button');
        leftBtn.type = 'button';
        leftBtn.className = 'raised emby-button';
        leftBtn.innerHTML = '&#8592;';
        leftBtn.style.cssText = 'padding: 0.1em 0.6em; font-size: 1.1em;';

        var valueEl = document.createElement('div');
        valueEl.style.cssText = 'flex: 1 1 auto; text-align: center; font-family: monospace; min-width: 9em;';

        var rightBtn = document.createElement('button');
        rightBtn.type = 'button';
        rightBtn.className = 'raised emby-button';
        rightBtn.innerHTML = '&#8594;';
        rightBtn.style.cssText = 'padding: 0.1em 0.6em; font-size: 1.1em;';

        function refresh() {
            valueEl.textContent = r.display();
            leftBtn.disabled = !r.enabled || r.leftDisabled();
        }

        if (r.enabled) {
            leftBtn.addEventListener('click', function () { r.step(-1); refreshAll(); });
            rightBtn.addEventListener('click', function () { r.step(1); refreshAll(); });
        } else {
            leftBtn.disabled = true;
            rightBtn.disabled = true;
        }

        rowEl.appendChild(labelEl);
        rowEl.appendChild(leftBtn);
        rowEl.appendChild(valueEl);
        rowEl.appendChild(rightBtn);

        if (r.hint) {
            var hintEl = document.createElement('div');
            hintEl.textContent = r.hint;
            hintEl.style.cssText = 'flex-basis: 100%; font-size: 0.75em; opacity: 0.6; padding-left: 6em;';
            rowEl.appendChild(hintEl);
        }

        dialog.appendChild(rowEl);
        refreshers.push(refresh);
    });

    function refreshAll() {
        refreshers.forEach(function (fn) { fn(); });
    }
    refreshAll();

    var footer = document.createElement('div');
    footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 0.5em; margin-top: 1em;';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'raised button-cancel emby-button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding: 0.4em 1em;';

    var applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'raised emby-button';
    applyBtn.textContent = 'Apply';
    applyBtn.style.cssText = 'padding: 0.4em 1em; background-color: #4CAF50;';

    footer.appendChild(cancelBtn);
    footer.appendChild(applyBtn);
    dialog.appendChild(footer);

    var applyInFlight = false;
    function close() {
        overlay.remove();
        if (config.onClose) { config.onClose(); }
    }

    cancelBtn.addEventListener('click', function () { if (applyInFlight) { return; } close(); });
    overlay.addEventListener('click', function (e) { if (applyInFlight) { return; } if (e.target === overlay) { close(); } });

    applyBtn.addEventListener('click', function () {
        var result;
        if (isBulk) {
            result = { introDelta: state.introDelta, introEndDelta: state.introEndDelta, creditsDelta: state.creditsDelta };
            if (!result.introDelta && !result.introEndDelta && !result.creditsDelta) { close(); return; }
        } else {
            result = { introStart: state.introStart, introEnd: state.introEnd, credits: state.credits };
        }
        applyBtn.disabled = true;
        applyInFlight = true;
        var ret = config.onApply(result);
        if (ret && typeof ret.then === 'function') {
            ret.then(close, function () { applyInFlight = false; applyBtn.disabled = false; });
        } else {
            close();
        }
    });

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    return { close: close };
}

// message - text shown in the snackbar
// onUndo  - function(): may return a Promise; the snackbar dismisses on resolve
function segmentReportingShowOffsetSnackbar(message, onUndo) {
    var existing = document.querySelector('.segment-offset-snackbar');
    if (existing) { existing.remove(); }

    var bar = document.createElement('div');
    bar.className = 'segment-offset-snackbar';
    bar.style.cssText = 'position: fixed; bottom: 1.5em; left: 50%; transform: translateX(-50%); background: #323232; color: #fff; padding: 0.75em 1.25em; border-radius: 4px; box-shadow: 0 2px 10px rgba(0,0,0,0.4); z-index: 1100; display: flex; align-items: center; gap: 1em;';

    var msgEl = document.createElement('span');
    msgEl.textContent = message;
    bar.appendChild(msgEl);

    var undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'emby-button';
    undoBtn.textContent = 'Undo';
    undoBtn.style.cssText = 'background: transparent; color: #80cbc4; font-weight: bold; padding: 0.2em 0.6em; cursor: pointer;';
    bar.appendChild(undoBtn);

    var timer = setTimeout(function () { bar.remove(); }, 12000);

    undoBtn.addEventListener('click', function () {
        clearTimeout(timer);
        undoBtn.disabled = true;
        Promise.resolve(onUndo()).then(function () {
            bar.remove();
        }, function () {
            undoBtn.disabled = false;
        });
    });

    document.body.appendChild(bar);
    return bar;
}

function getSegmentReportingHelpers() {
    return {
        ticksToTime: segmentReportingTicksToTime,
        timeToTicks: segmentReportingTimeToTicks,
        pad: segmentReportingPad,
        percentage: segmentReportingPercentage,
        relativeTime: segmentReportingRelativeTime,
        navigate: segmentReportingNavigate,
        getQueryParam: segmentReportingGetQueryParam,
        apiCall: segmentReportingApiCall,
        showLoading: segmentReportingShowLoading,
        hideLoading: segmentReportingHideLoading,
        showError: segmentReportingShowError,
        showSuccess: segmentReportingShowSuccess,
        escHtml: segmentReportingEscHtml,
        launchPlayback: segmentReportingLaunchPlayback,
        detectAccentColor: segmentReportingDetectAccentColor,
        rgbToHex: segmentReportingRgbToHex,
        hexToRgb: segmentReportingHexToRgb,
        rgbToHsl: segmentReportingRgbToHsl,
        hslToRgb: segmentReportingHslToRgb,
        hslToHexString: segmentReportingHslToHexString,
        chartPalettes: segmentReportingChartPalettes,
        getPaletteByName: segmentReportingGetPaletteByName,
        generateChartPalette: segmentReportingGenerateChartPalette,
        getThemeColors: segmentReportingGetThemeColors,
        formatBytes: segmentReportingFormatBytes,
        formatDuration: segmentReportingFormatDuration,
        renderTimestamp: segmentReportingRenderTimestamp,
        apiCallWithLoading: segmentReportingApiCallWithLoading,
        attachHoverEffect: segmentReportingAttachHoverEffect,
        createEmptyRow: segmentReportingCreateEmptyRow,
        registerChartCleanup: segmentReportingRegisterChartCleanup,
        withButtonLoading: segmentReportingWithButtonLoading,
        guardButton: segmentReportingGuardButton,
        createSegmentChart: segmentReportingCreateSegmentChart,
        checkCreditsDetector: segmentReportingCheckCreditsDetector,
        creditsDetectorCall: segmentReportingCreditsDetectorCall,
        loadPreferences: segmentReportingLoadPreferences,
        invalidatePreferencesCache: segmentReportingInvalidatePreferencesCache,
        getPreference: segmentReportingGetPreference,
        applyTableStyles: segmentReportingApplyTableStyles,
        renderBreadcrumbs: segmentReportingRenderBreadcrumbs,
        showBulkResult: segmentReportingShowBulkResult,
        bulkDelete: segmentReportingBulkDelete,
        bulkSetCreditsEnd: segmentReportingBulkSetCreditsEnd,
        bulkDetectCredits: segmentReportingBulkDetectCredits,
        detectDropdownBg: segmentReportingDetectDropdownBg,
        isLightBackground: segmentReportingIsLightBackground,
        isLightTheme: segmentReportingIsLightTheme,
        resolveColor: segmentReportingResolveColor,
        getMenuColors: segmentReportingGetMenuColors,
        createMenuItem: segmentReportingCreateMenuItem,
        createMenuDivider: segmentReportingCreateMenuDivider,
        createSubmenuItem: segmentReportingCreateSubmenuItem,
        positionMenuBelowButton: segmentReportingPositionMenuBelowButton,
        attachMenuCloseHandler: segmentReportingAttachMenuCloseHandler,
        createActionsMenu: segmentReportingCreateActionsMenu,
        createInlineEditor: segmentReportingCreateInlineEditor,
        buildBulkSetBody: segmentReportingBuildBulkSetBody,
        applyBulkSet: segmentReportingApplyBulkSet,
        applyBulkSetStrict: segmentReportingApplyBulkSetStrict,
        createOffsetModal: segmentReportingCreateOffsetModal,
        showOffsetSnackbar: segmentReportingShowOffsetSnackbar
    };
}

// Build-patched version constant (scripts/build-js.mjs replaces this during Release builds)
var SEGMENT_REPORTING_PLUGIN_VERSION = '__PLUGIN_VERSION__';

// Auto-check for stale cached resources on every page load
(function segmentReportingCheckPluginVersion() {
    if (SEGMENT_REPORTING_PLUGIN_VERSION.indexOf('__') === 0) return; // dev build, skip check

    var reloadKey = 'sr_version_reload';

    try {
        var url = ApiClient.getUrl('segment_reporting/version');
        ApiClient.ajax({ type: 'GET', url: url, dataType: 'json' }).then(function (data) {
            if (!data || !data.version) return;
            if (data.version === SEGMENT_REPORTING_PLUGIN_VERSION) return; // loaded JS already matches the server
            // Guard keyed to the SERVER target version: reload once per real version change,
            // so a single soft reload that fails to refresh does not permanently disarm the check.
            if (sessionStorage.getItem(reloadKey) === data.version) return;
            sessionStorage.setItem(reloadKey, data.version);
            location.reload();
        });
    } catch (_e) {
        // Version check is best-effort
    }
})();
