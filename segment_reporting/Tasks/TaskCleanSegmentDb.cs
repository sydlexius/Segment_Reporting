using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Tasks;
using segment_reporting.Data;

namespace segment_reporting.Tasks
{
    public class TaskCleanSegmentDb : IScheduledTask
    {
        private readonly ILibraryManager _libraryManager;
        private readonly ILogger _logger;
        private readonly IApplicationPaths _appPaths;

        public TaskCleanSegmentDb(
            ILibraryManager libraryManager,
            IApplicationPaths appPaths,
            ILogger logger)
        {
            _libraryManager = libraryManager;
            _appPaths = appPaths;
            _logger = logger;
        }

        public string Name => "Clean Segment Cache";

        public string Key => "SegmentReportingCleanTask";

        public string Description => "Maintains the segment cache database: runs VACUUM to reclaim space and logs health statistics.";

        public string Category => "Segment Reporting";

        public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
        {
            return new[]
            {
                new TaskTriggerInfo
                {
                    Type = TaskTriggerInfo.TriggerWeekly,
                    DayOfWeek = DayOfWeek.Sunday,
                    TimeOfDayTicks = TimeSpan.FromHours(3).Ticks
                }
            };
        }

        public Task Execute(CancellationToken cancellationToken, IProgress<double> progress)
        {
            progress.Report(0);
            var stopwatch = Stopwatch.StartNew();

            _logger.Info("TaskCleanSegmentDb: Starting cache maintenance");

            string dbPath = Path.Combine(_appPaths.DataPath, "segment_reporting.db");
            var repo = SegmentRepository.GetInstance(dbPath, _logger);
            repo.Initialize();

            try
            {
                // Step 1: Vacuum database
                progress.Report(0);
                _logger.Info("TaskCleanSegmentDb: Running VACUUM");
                repo.VacuumDatabase();
                progress.Report(50);

                // Step 2: Get cache health statistics
                int rowCount = repo.GetRowCount();
                var dbInfo = new FileInfo(dbPath);
                long dbFileSizeBytes = dbInfo.Length;
                long dbFileSizeKb = dbFileSizeBytes / 1024;

                var syncStatus = repo.GetSyncStatus();
                string lastSyncStr = syncStatus?.LastFullSync != null
                    ? syncStatus.LastFullSync.ToString("yyyy-MM-dd HH:mm:ss")
                    : "Never";

                progress.Report(75);

                // Step 3: Compare row count to Emby item count
                var items = _libraryManager.GetItemList(new InternalItemsQuery
                {
                    IncludeItemTypes = new[] { "Episode", "Movie" },
                    Recursive = true,
                    IsVirtualItem = false
                });

                int itemCount = items.Length;
                progress.Report(90);

                // Step 4: Calculate divergence and log warning if needed
                double divergencePercent = itemCount > 0
                    ? Math.Abs(rowCount - itemCount) / (double)itemCount * 100
                    : 0;

                _logger.Info("TaskCleanSegmentDb: Cache health report");
                _logger.Info("  Cache rows: {0}", rowCount);
                _logger.Info("  Emby items: {0}", itemCount);
                _logger.Info("  Divergence: {0:F2}%", divergencePercent);
                _logger.Info("  DB file size: {0} KB", dbFileSizeKb);
                _logger.Info("  Last sync: {0}", lastSyncStr);

                if (divergencePercent > 5.0)
                {
                    _logger.Warn("TaskCleanSegmentDb: Cache divergence exceeds 5% ({0:F2}%) - consider running sync task", divergencePercent);
                }

                stopwatch.Stop();
                _logger.Info("TaskCleanSegmentDb: Completed in {0}ms", stopwatch.ElapsedMilliseconds);

                progress.Report(100);
            }
            catch (Exception ex)
            {
                _logger.ErrorException("TaskCleanSegmentDb: Unexpected error", ex);
                throw;
            }

            return Task.CompletedTask;
        }
    }
}
