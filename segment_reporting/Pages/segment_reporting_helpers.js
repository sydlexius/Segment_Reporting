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
    if (params && Object.keys(params).length > 0) {
        sessionStorage.setItem('segment_reporting_nav_params', JSON.stringify(params));
    }

    var url = 'configurationpage?name=' + page;

    var knownPages = ['segment_dashboard', 'segment_library', 'segment_series', 'segment_settings', 'segment_custom_query'];
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
    var storedParams = sessionStorage.getItem('segment_reporting_nav_params');
    if (storedParams) {
        try {
            var params = JSON.parse(storedParams);
            if (params && params[name]) {
                return params[name];
            }
        } catch (e) {
            console.error('Failed to parse navigation params:', e);
        }
    }

    var urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

function segmentReportingClearNavParams() {
    sessionStorage.removeItem('segment_reporting_nav_params');
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

function segmentReportingGenerateChartPalette(accentHex) {
    var rgb = segmentReportingHexToRgb(accentHex);
    var hsl = segmentReportingRgbToHsl(rgb.r, rgb.g, rgb.b);

    var isReddish = (hsl.h >= 340 || hsl.h <= 20);

    return {
        bothSegments: segmentReportingHslToHexString(hsl.h, Math.min(hsl.s + 10, 100), Math.min(hsl.l + 15, 85)),
        introOnly: accentHex,
        creditsOnly: segmentReportingHslToHexString((hsl.h + 30) % 360, hsl.s, hsl.l),
        noSegments: isReddish ? '#FF9800' : '#F44336'
    };
}

function segmentReportingEscHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function segmentReportingGetThemeColors(view) {
    var accentColor = segmentReportingDetectAccentColor(view);
    var palette = segmentReportingGenerateChartPalette(accentColor);
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

function getSegmentReportingHelpers() {
    return {
        ticksToTime: segmentReportingTicksToTime,
        timeToTicks: segmentReportingTimeToTicks,
        pad: segmentReportingPad,
        percentage: segmentReportingPercentage,
        relativeTime: segmentReportingRelativeTime,
        navigate: segmentReportingNavigate,
        getQueryParam: segmentReportingGetQueryParam,
        clearNavParams: segmentReportingClearNavParams,
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
        createSegmentChart: segmentReportingCreateSegmentChart
    };
}
