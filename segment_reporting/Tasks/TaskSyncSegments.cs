using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Persistence;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Tasks;
using segment_reporting.Data;

namespace segment_reporting.Tasks
{
    public class TaskSyncSegments : IScheduledTask
    {
        private const int ProgressReportInterval = 100;

        private readonly ILibraryManager _libraryManager;
        private readonly IItemRepository _itemRepository;
        private readonly ILogger _logger;
        private readonly IApplicationPaths _appPaths;

        public TaskSyncSegments(
            ILibraryManager libraryManager,
            IItemRepository itemRepository,
            IApplicationPaths appPaths,
            ILogger logger)
        {
            _libraryManager = libraryManager;
            _itemRepository = itemRepository;
            _appPaths = appPaths;
            _logger = logger;
        }

        public string Name => "Sync Segment Data";

        public string Key => "SegmentReportingSyncTask";

        public string Description => "Syncs media segment markers (Intros, Credits) from Emby into the reporting cache.";

        public string Category => "Segment Reporting";

        public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
        {
            return new[]
            {
                new TaskTriggerInfo
                {
                    Type = TaskTriggerInfo.TriggerDaily,
                    TimeOfDayTicks = TimeSpan.FromHours(2).Ticks
                }
            };
        }

        public Task Execute(CancellationToken cancellationToken, IProgress<double> progress)
        {
            progress.Report(0);
            var stopwatch = Stopwatch.StartNew();

            _logger.Info("TaskSyncSegments: Starting full segment sync");

            string dbPath = Path.Combine(_appPaths.DataPath, "segment_reporting.db");
            var repo = SegmentRepository.GetInstance(dbPath, _logger);
            repo.Initialize();

            var items = _libraryManager.GetItemList(new InternalItemsQuery
            {
                IncludeItemTypes = new[] { "Episode", "Movie" },
                Recursive = true,
                IsVirtualItem = false
            });

            int totalItems = items.Length;
            _logger.Info("TaskSyncSegments: Found {0} items to scan", totalItems);

            if (totalItems == 0)
            {
                repo.UpdateSyncStatus(0, 0);
                progress.Report(100);
                return Task.CompletedTask;
            }

            var segments = new List<SegmentInfo>(totalItems);
            var validItemIds = new List<string>(totalItems);
            var syncDate = DateTime.UtcNow;
            int skipped = 0;

            for (int i = 0; i < totalItems; i++)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var item = items[i];

                try
                {
                    var segment = BuildSegmentInfo(item, syncDate);
                    segments.Add(segment);
                    validItemIds.Add(segment.ItemId);
                }
                catch (Exception ex)
                {
                    skipped++;
                    _logger.Warn("TaskSyncSegments: Failed to build segment info for item {0} ({1}): {2}",
                        item.InternalId, item.Name, ex.Message);
                }

                if (i % ProgressReportInterval == 0)
                {
                    progress.Report((double)i / totalItems * 90);
                }
            }

            if (skipped > 0)
            {
                _logger.Warn("TaskSyncSegments: Skipped {0} items due to errors", skipped);
            }

            progress.Report(90);

            _logger.Info("TaskSyncSegments: Upserting {0} segments", segments.Count);
            repo.UpsertSegments(segments);
            progress.Report(95);

            repo.RemoveOrphanedRows(validItemIds);
            progress.Report(98);

            stopwatch.Stop();
            int durationMs = (int)stopwatch.ElapsedMilliseconds;
            repo.UpdateSyncStatus(totalItems, durationMs);

            _logger.Info("TaskSyncSegments: Completed. Scanned {0} items in {1}ms", totalItems, durationMs);
            progress.Report(100);

            return Task.CompletedTask;
        }

        private SegmentInfo BuildSegmentInfo(BaseItem item, DateTime syncDate)
        {
            long? introStart = null;
            long? introEnd = null;
            long? creditsStart = null;

            try
            {
                var chapters = _itemRepository.GetChapters(item);
                if (chapters != null)
                {
                    foreach (var chapter in chapters)
                    {
                        switch (chapter.MarkerType)
                        {
                            case MarkerType.IntroStart:
                                introStart = chapter.StartPositionTicks;
                                break;
                            case MarkerType.IntroEnd:
                                introEnd = chapter.StartPositionTicks;
                                break;
                            case MarkerType.CreditsStart:
                                creditsStart = chapter.StartPositionTicks;
                                break;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.Warn("BuildSegmentInfo: GetChapters failed for item {0}: {1}",
                    item.InternalId, ex.Message);
            }

            var segment = new SegmentInfo
            {
                ItemId = item.InternalId.ToString(),
                ItemName = item.Name,
                IntroStartTicks = introStart,
                IntroEndTicks = introEnd,
                CreditsStartTicks = creditsStart,
                HasIntro = (introStart.HasValue || introEnd.HasValue) ? 1 : 0,
                HasCredits = creditsStart.HasValue ? 1 : 0,
                LastSyncDate = syncDate
            };

            var topParent = item.GetTopParent();
            if (topParent != null)
            {
                segment.LibraryName = topParent.Name;
                segment.LibraryId = topParent.InternalId.ToString();
            }

            var episode = item as Episode;
            if (episode != null)
            {
                segment.ItemType = "Episode";
                segment.SeriesName = episode.SeriesName;

                var series = episode.FindParent<Series>();
                if (series != null)
                {
                    segment.SeriesId = series.InternalId.ToString();
                }

                var season = episode.FindParent<Season>();
                if (season != null)
                {
                    segment.SeasonName = season.Name;
                    segment.SeasonId = season.InternalId.ToString();
                    segment.SeasonNumber = season.IndexNumber;
                }

                segment.EpisodeNumber = episode.IndexNumber;
            }
            else
            {
                segment.ItemType = "Movie";
            }

            return segment;
        }
    }
}
