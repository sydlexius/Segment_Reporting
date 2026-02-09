define([Dashboard.getConfigurationResourceUrl('segment_reporting_helpers.js')], function () {
    'use strict';

    return function (view, params) {

        var helpers = getSegmentReportingHelpers();

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
                    helpers.showLoading();
                    helpers.apiCall('force_rescan', 'POST').then(function (result) {
                        helpers.hideLoading();
                        if (result.error) {
                            helpers.showError(result.error);
                        } else {
                            helpers.showSuccess('Cache dropped and rescan queued. Stats will update after the sync completes.');
                            loadCacheStats();
                        }
                    }).catch(function () {
                        helpers.hideLoading();
                        helpers.showError('Failed to trigger force rescan.');
                    });
                }
            );
        }

        view.addEventListener('viewshow', function () {
            loadCacheStats();
            view.querySelector('#btnForceRescan').addEventListener('click', onForceRescanClick);
            view.querySelector('#btnRefreshStats').addEventListener('click', loadCacheStats);
        });

        view.addEventListener('viewhide', function () {
            view.querySelector('#btnForceRescan').removeEventListener('click', onForceRescanClick);
            view.querySelector('#btnRefreshStats').removeEventListener('click', loadCacheStats);
        });
    };
});
