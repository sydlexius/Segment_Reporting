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

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Persistence;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Services;
using MediaBrowser.Model.Tasks;
using segment_reporting.Data;
using segment_reporting.Tasks;

namespace segment_reporting.Api
{
    // http://localhost:8096/emby/segment_reporting/library_summary
    [Route("/segment_reporting/library_summary", "GET", Summary = "Gets per-library coverage stats")]
    [Authenticated(Roles = "admin")]
    public class GetLibrarySummary : IReturn<object>
    {
    }

    // http://localhost:8096/emby/segment_reporting/series_list?libraryId=X&search=&filter=
    [Route("/segment_reporting/series_list", "GET", Summary = "Gets series/movies in a library with coverage stats")]
    [Authenticated(Roles = "admin")]
    public class GetSeriesList : IReturn<object>
    {
        [ApiMember(Name = "libraryId", Description = "Library ID", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "GET")]
        public string LibraryId { get; set; }

        [ApiMember(Name = "search", Description = "Search term", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "GET")]
        public string Search { get; set; }

        [ApiMember(Name = "filter", Description = "Comma-separated filters (missing_intro, missing_credits)", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "GET")]
        public string Filter { get; set; }
    }

    // http://localhost:8096/emby/segment_reporting/season_list?seriesId=X
    [Route("/segment_reporting/season_list", "GET", Summary = "Gets seasons for a series with coverage stats")]
    [Authenticated(Roles = "admin")]
    public class GetSeasonList : IReturn<object>
    {
        [ApiMember(Name = "seriesId", Description = "Series ID", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "GET")]
        public string SeriesId { get; set; }
    }

    // http://localhost:8096/emby/segment_reporting/episode_list?seasonId=X or ?seriesId=X
    [Route("/segment_reporting/episode_list", "GET", Summary = "Gets episodes with full segment tick values")]
    [Authenticated(Roles = "admin")]
    public class GetEpisodeList : IReturn<object>
    {
        [ApiMember(Name = "seasonId", Description = "Season ID", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "GET")]
        public string SeasonId { get; set; }

        [ApiMember(Name = "seriesId", Description = "Series ID (alternative to seasonId for flat view)", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "GET")]
        public string SeriesId { get; set; }
    }

    // http://localhost:8096/emby/segment_reporting/item_segments?itemId=X
    [Route("/segment_reporting/item_segments", "GET", Summary = "Gets segment detail for a single item")]
    [Authenticated(Roles = "admin")]
    public class GetItemSegments : IReturn<object>
    {
        [ApiMember(Name = "itemId", Description = "Item ID", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "GET")]
        public string ItemId { get; set; }
    }

    // http://localhost:8096/emby/segment_reporting/update_segment
    [Route("/segment_reporting/update_segment", "POST", Summary = "Updates or adds a segment on one item")]
    [Authenticated(Roles = "admin")]
    public class UpdateSegment : IReturn<object>
    {
        [ApiMember(Name = "ItemId", Description = "Item ID", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string ItemId { get; set; }

        [ApiMember(Name = "MarkerType", Description = "Segment type (IntroStart, IntroEnd, CreditsStart)", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string MarkerType { get; set; }

        [ApiMember(Name = "Ticks", Description = "Timestamp in ticks", IsRequired = true, DataType = "long", ParameterType = "query", Verb = "POST")]
        public long Ticks { get; set; }
    }

    // http://localhost:8096/emby/segment_reporting/delete_segment
    [Route("/segment_reporting/delete_segment", "POST", Summary = "Removes a segment marker from an item")]
    [Authenticated(Roles = "admin")]
    public class DeleteSegmentRequest : IReturn<object>
    {
        [ApiMember(Name = "ItemId", Description = "Item ID", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string ItemId { get; set; }

        [ApiMember(Name = "MarkerType", Description = "Segment type (IntroStart, IntroEnd, CreditsStart)", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string MarkerType { get; set; }
    }

    // http://localhost:8096/emby/segment_reporting/bulk_apply
    [Route("/segment_reporting/bulk_apply", "POST", Summary = "Copies segments from source item to target items")]
    [Authenticated(Roles = "admin")]
    public class BulkApply : IReturn<object>
    {
        [ApiMember(Name = "SourceItemId", Description = "Source item ID to copy segments from", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string SourceItemId { get; set; }

        [ApiMember(Name = "TargetItemIds", Description = "Comma-separated target item IDs", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string TargetItemIds { get; set; }

        [ApiMember(Name = "MarkerTypes", Description = "Comma-separated marker types (IntroStart, IntroEnd, CreditsStart)", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string MarkerTypes { get; set; }
    }

    // http://localhost:8096/emby/segment_reporting/bulk_delete
    [Route("/segment_reporting/bulk_delete", "POST", Summary = "Removes segment types from multiple items")]
    [Authenticated(Roles = "admin")]
    public class BulkDelete : IReturn<object>
    {
        [ApiMember(Name = "ItemIds", Description = "Comma-separated item IDs", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string ItemIds { get; set; }

        [ApiMember(Name = "MarkerTypes", Description = "Comma-separated marker types (IntroStart, IntroEnd, CreditsStart)", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string MarkerTypes { get; set; }
    }

    // http://localhost:8096/emby/segment_reporting/bulk_set_credits_end
    [Route("/segment_reporting/bulk_set_credits_end", "POST", Summary = "Sets CreditsStart to runtime minus offset for items")]
    [Authenticated(Roles = "admin")]
    public class BulkSetCreditsEnd : IReturn<object>
    {
        [ApiMember(Name = "ItemIds", Description = "Comma-separated item IDs", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string ItemIds { get; set; }

        [ApiMember(Name = "OffsetTicks", Description = "Offset from end in ticks (default 0)", IsRequired = false, DataType = "long", ParameterType = "query", Verb = "POST")]
        public long OffsetTicks { get; set; }
    }

    // http://localhost:8096/emby/segment_reporting/sync_now
    [Route("/segment_reporting/sync_now", "POST", Summary = "Trigger immediate full sync")]
    [Authenticated(Roles = "admin")]
    public class SyncNow : IReturn<object>
    {
    }

    // http://localhost:8096/emby/segment_reporting/sync_status
    [Route("/segment_reporting/sync_status", "GET", Summary = "Get last sync time, items scanned, duration")]
    [Authenticated(Roles = "admin")]
    public class GetSyncStatus : IReturn<object>
    {
    }

    // http://localhost:8096/emby/segment_reporting/force_rescan
    [Route("/segment_reporting/force_rescan", "POST", Summary = "Drop and rebuild entire cache from scratch")]
    [Authenticated(Roles = "admin")]
    public class ForceRescan : IReturn<object>
    {
    }

    // http://localhost:8096/emby/segment_reporting/cache_stats
    [Route("/segment_reporting/cache_stats", "GET", Summary = "Get cache row count, DB file size, and last sync info")]
    [Authenticated(Roles = "admin")]
    public class GetCacheStats : IReturn<object>
    {
    }

    // http://localhost:8096/emby/segment_reporting/submit_custom_query
    [Route("/segment_reporting/submit_custom_query", "POST", Summary = "Execute read-only SQL against the cache")]
    [Authenticated(Roles = "admin")]
    public class SubmitCustomQuery : IReturn<object>
    {
        [ApiMember(Name = "query", Description = "SQL query to execute", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string Query { get; set; }
    }

    // http://localhost:8096/emby/segment_reporting/canned_queries
    [Route("/segment_reporting/canned_queries", "GET", Summary = "Return list of built-in queries")]
    [Authenticated(Roles = "admin")]
    public class GetCannedQueries : IReturn<object>
    {
    }

    public class SegmentReportingAPI : IService, IRequiresRequest
    {
        private readonly ILogger _logger;
        private readonly IServerConfigurationManager _config;
        private readonly ILibraryManager _libraryManager;
        private readonly IItemRepository _itemRepository;
        private readonly ITaskManager _taskManager;

        private static readonly HashSet<string> _validMarkerTypes = new HashSet<string>
        {
            "IntroStart", "IntroEnd", "CreditsStart"
        };

        public SegmentReportingAPI(ILogManager logger,
            IServerConfigurationManager config,
            ILibraryManager libraryManager,
            IItemRepository itemRepository,
            ITaskManager taskManager)
        {
            _logger = logger.GetLogger("SegmentReporting - API");
            _config = config;
            _libraryManager = libraryManager;
            _itemRepository = itemRepository;
            _taskManager = taskManager;
        }

        public IRequest Request { get; set; }

        public object Get(GetLibrarySummary request)
        {
            _logger.Info("GetLibrarySummary");

            string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
            SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);

            List<LibrarySummaryItem> summary = repo.GetLibrarySummary();

            // Note: Future enhancement - could enrich with image URLs using _libraryManager.GetItemById()
            return summary;
        }

        public object Get(GetSeriesList request)
        {
            _logger.Info("GetSeriesList: libraryId={0}, search={1}, filter={2}",
                request.LibraryId, request.Search, request.Filter);

            if (string.IsNullOrEmpty(request.LibraryId))
            {
                return new { error = "libraryId is required" };
            }

            string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
            SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);

            string[] filters = null;
            if (!string.IsNullOrEmpty(request.Filter))
            {
                filters = request.Filter.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                    .Select(f => f.Trim())
                    .ToArray();
            }

            List<SeriesListItem> seriesList = repo.GetSeriesList(request.LibraryId, request.Search, filters);

            // Note: Future enhancement - could enrich with image URLs using _libraryManager.GetItemById()
            return seriesList;
        }

        public object Get(GetSeasonList request)
        {
            _logger.Info("GetSeasonList: seriesId={0}", request.SeriesId);

            if (string.IsNullOrEmpty(request.SeriesId))
            {
                return new { error = "seriesId is required" };
            }

            string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
            SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);

            List<SeasonListItem> seasonList = repo.GetSeasonList(request.SeriesId);

            // Note: Future enhancement - could enrich with image URLs using _libraryManager.GetItemById()
            return seasonList;
        }

        public object Get(GetEpisodeList request)
        {
            _logger.Info("GetEpisodeList: seasonId={0}, seriesId={1}", request.SeasonId, request.SeriesId);

            string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
            SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);

            List<SegmentInfo> episodes;

            if (!string.IsNullOrEmpty(request.SeasonId))
            {
                episodes = repo.GetEpisodeList(request.SeasonId);
            }
            else if (!string.IsNullOrEmpty(request.SeriesId))
            {
                episodes = repo.GetEpisodeListBySeries(request.SeriesId);
            }
            else
            {
                return new { error = "Either seasonId or seriesId is required" };
            }

            // Note: Future enhancement - could enrich with image URLs using _libraryManager.GetItemById()
            return episodes;
        }

        public object Get(GetItemSegments request)
        {
            _logger.Info("GetItemSegments: itemId={0}", request.ItemId);

            if (string.IsNullOrEmpty(request.ItemId))
            {
                return new { error = "itemId is required" };
            }

            string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
            SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);

            SegmentInfo segment = repo.GetItemSegments(request.ItemId);

            if (segment == null)
            {
                return new { error = "Item not found" };
            }

            // Note: Future enhancement - could enrich with image URLs using _libraryManager.GetItemById()
            return segment;
        }

        public object Post(UpdateSegment request)
        {
            _logger.Info("UpdateSegment: itemId={0}, markerType={1}, ticks={2}",
                request.ItemId, request.MarkerType, request.Ticks);

            if (string.IsNullOrEmpty(request.ItemId))
            {
                return new { error = "itemId is required" };
            }
            if (!_validMarkerTypes.Contains(request.MarkerType))
            {
                return new { error = "markerType must be one of: IntroStart, IntroEnd, CreditsStart" };
            }
            if (request.Ticks < 0)
            {
                return new { error = "ticks must be non-negative" };
            }

            try
            {
                long internalId = long.Parse(request.ItemId);
                WriteSegmentToEmby(internalId, request.MarkerType, request.Ticks);

                string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
                SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);
                repo.UpdateSegmentTicks(request.ItemId, request.MarkerType, request.Ticks);

                return new { success = true };
            }
            catch (Exception ex)
            {
                _logger.ErrorException("UpdateSegment failed for item {0}", ex, request.ItemId);
                return new { error = ex.Message };
            }
        }

        public object Post(DeleteSegmentRequest request)
        {
            _logger.Info("DeleteSegment: itemId={0}, markerType={1}",
                request.ItemId, request.MarkerType);

            if (string.IsNullOrEmpty(request.ItemId))
            {
                return new { error = "itemId is required" };
            }
            if (!_validMarkerTypes.Contains(request.MarkerType))
            {
                return new { error = "markerType must be one of: IntroStart, IntroEnd, CreditsStart" };
            }

            try
            {
                long internalId = long.Parse(request.ItemId);
                WriteSegmentToEmby(internalId, request.MarkerType, null);

                string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
                SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);
                repo.DeleteSegment(request.ItemId, request.MarkerType);

                return new { success = true };
            }
            catch (Exception ex)
            {
                _logger.ErrorException("DeleteSegment failed for item {0}", ex, request.ItemId);
                return new { error = ex.Message };
            }
        }

        public object Post(BulkApply request)
        {
            _logger.Info("BulkApply: sourceItemId={0}, targetItemIds={1}, markerTypes={2}",
                request.SourceItemId, request.TargetItemIds, request.MarkerTypes);

            if (string.IsNullOrEmpty(request.SourceItemId))
            {
                return new { error = "sourceItemId is required" };
            }
            if (string.IsNullOrEmpty(request.TargetItemIds))
            {
                return new { error = "targetItemIds is required" };
            }
            if (string.IsNullOrEmpty(request.MarkerTypes))
            {
                return new { error = "markerTypes is required" };
            }

            var targetIds = request.TargetItemIds
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(id => id.Trim())
                .ToArray();

            var markerTypes = request.MarkerTypes
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(t => t.Trim())
                .ToArray();

            foreach (var mt in markerTypes)
            {
                if (!_validMarkerTypes.Contains(mt))
                {
                    return new { error = "Invalid markerType: " + mt };
                }
            }

            string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
            SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);

            SegmentInfo sourceSegment = repo.GetItemSegments(request.SourceItemId);
            if (sourceSegment == null)
            {
                return new { error = "Source item not found in cache" };
            }

            int succeeded = 0;
            int failed = 0;
            var errors = new List<string>();

            foreach (var targetId in targetIds)
            {
                foreach (var markerType in markerTypes)
                {
                    try
                    {
                        long? sourceTicks = GetTicksForMarkerType(sourceSegment, markerType);
                        if (!sourceTicks.HasValue)
                        {
                            continue;
                        }

                        long targetInternalId = long.Parse(targetId);
                        WriteSegmentToEmby(targetInternalId, markerType, sourceTicks.Value);
                        repo.UpdateSegmentTicks(targetId, markerType, sourceTicks.Value);
                        succeeded++;
                    }
                    catch (Exception ex)
                    {
                        failed++;
                        errors.Add(targetId + "/" + markerType + ": " + ex.Message);
                        _logger.Warn("BulkApply: Failed for item {0} marker {1}: {2}",
                            targetId, markerType, ex.Message);
                    }
                }
            }

            return new { succeeded, failed, errors };
        }

        public object Post(BulkDelete request)
        {
            _logger.Info("BulkDelete: itemIds={0}, markerTypes={1}",
                request.ItemIds, request.MarkerTypes);

            if (string.IsNullOrEmpty(request.ItemIds))
            {
                return new { error = "itemIds is required" };
            }
            if (string.IsNullOrEmpty(request.MarkerTypes))
            {
                return new { error = "markerTypes is required" };
            }

            var itemIds = request.ItemIds
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(id => id.Trim())
                .ToArray();

            var markerTypes = request.MarkerTypes
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(t => t.Trim())
                .ToArray();

            foreach (var mt in markerTypes)
            {
                if (!_validMarkerTypes.Contains(mt))
                {
                    return new { error = "Invalid markerType: " + mt };
                }
            }

            string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
            SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);

            int succeeded = 0;
            int failed = 0;
            var errors = new List<string>();

            foreach (var itemId in itemIds)
            {
                foreach (var markerType in markerTypes)
                {
                    try
                    {
                        long internalId = long.Parse(itemId);
                        WriteSegmentToEmby(internalId, markerType, null);
                        repo.DeleteSegment(itemId, markerType);
                        succeeded++;
                    }
                    catch (Exception ex)
                    {
                        failed++;
                        errors.Add(itemId + "/" + markerType + ": " + ex.Message);
                        _logger.Warn("BulkDelete: Failed for item {0} marker {1}: {2}",
                            itemId, markerType, ex.Message);
                    }
                }
            }

            return new { succeeded, failed, errors };
        }

        public object Post(BulkSetCreditsEnd request)
        {
            _logger.Info("BulkSetCreditsEnd: itemIds={0}, offsetTicks={1}",
                request.ItemIds, request.OffsetTicks);

            if (string.IsNullOrEmpty(request.ItemIds))
            {
                return new { error = "itemIds is required" };
            }

            var itemIds = request.ItemIds
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(id => id.Trim())
                .ToArray();

            string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
            SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);

            int succeeded = 0;
            int failed = 0;
            var errors = new List<string>();

            foreach (var itemId in itemIds)
            {
                try
                {
                    long internalId = long.Parse(itemId);
                    var item = _libraryManager.GetItemById(internalId);
                    if (item == null)
                    {
                        failed++;
                        errors.Add(itemId + ": Item not found");
                        continue;
                    }

                    long? runtimeTicks = item.RunTimeTicks;
                    if (!runtimeTicks.HasValue || runtimeTicks.Value <= 0)
                    {
                        failed++;
                        errors.Add(itemId + ": No runtime available");
                        continue;
                    }

                    long creditsStartTicks = runtimeTicks.Value - request.OffsetTicks;
                    if (creditsStartTicks < 0)
                    {
                        creditsStartTicks = 0;
                    }

                    WriteSegmentToEmby(internalId, "CreditsStart", creditsStartTicks);
                    repo.UpdateSegmentTicks(itemId, "CreditsStart", creditsStartTicks);
                    succeeded++;
                }
                catch (Exception ex)
                {
                    failed++;
                    errors.Add(itemId + ": " + ex.Message);
                    _logger.Warn("BulkSetCreditsEnd: Failed for item {0}: {1}",
                        itemId, ex.Message);
                }
            }

            return new { succeeded, failed, errors };
        }

        public object Post(SyncNow request)
        {
            _logger.Info("SyncNow: Triggering sync task");

            try
            {
                _taskManager.QueueScheduledTask<TaskSyncSegments>();
                return new { success = true, message = "Sync task queued" };
            }
            catch (Exception ex)
            {
                _logger.ErrorException("SyncNow: Failed to queue sync task", ex);
                return new { error = ex.Message };
            }
        }

        public object Get(GetSyncStatus request)
        {
            _logger.Info("GetSyncStatus");

            string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
            SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);

            SyncStatusInfo status = repo.GetSyncStatus();

            if (status == null)
            {
                return new
                {
                    lastFullSync = (DateTime?)null,
                    itemsScanned = 0,
                    syncDuration = 0,
                    message = "No sync has been performed yet"
                };
            }

            return new
            {
                lastFullSync = status.LastFullSync,
                itemsScanned = status.ItemsScanned,
                syncDuration = status.SyncDuration
            };
        }

        public object Post(ForceRescan request)
        {
            _logger.Info("ForceRescan: Dropping and rebuilding cache");

            try
            {
                string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
                SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);

                repo.DeleteAllData();

                _taskManager.QueueScheduledTask<TaskSyncSegments>();

                return new { success = true, message = "Cache dropped and sync task queued" };
            }
            catch (Exception ex)
            {
                _logger.ErrorException("ForceRescan: Failed", ex);
                return new { error = ex.Message };
            }
        }

        public object Get(GetCacheStats request)
        {
            _logger.Info("GetCacheStats");

            string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
            SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);

            int rowCount = repo.GetRowCount();
            SyncStatusInfo syncStatus = repo.GetSyncStatus();

            long dbFileSize = 0;
            if (File.Exists(dbPath))
            {
                dbFileSize = new FileInfo(dbPath).Length;
            }

            return new
            {
                rowCount,
                dbFileSize,
                lastFullSync = syncStatus?.LastFullSync,
                itemsScanned = syncStatus?.ItemsScanned ?? 0,
                syncDuration = syncStatus?.SyncDuration ?? 0
            };
        }

        public object Post(SubmitCustomQuery request)
        {
            _logger.Info("SubmitCustomQuery: query={0}", request.Query);

            if (string.IsNullOrWhiteSpace(request.Query))
            {
                return new { error = "query is required" };
            }

            string dbPath = Path.Combine(_config.ApplicationPaths.DataPath, "segment_reporting.db");
            SegmentRepository repo = SegmentRepository.GetInstance(dbPath, _logger);

            QueryResult result = repo.RunCustomQuery(request.Query);

            return result;
        }

        public object Get(GetCannedQueries request)
        {
            _logger.Info("GetCannedQueries");

            var queries = new List<object>
            {
                new
                {
                    name = "All movies missing intros",
                    sql = "SELECT * FROM MediaSegments WHERE ItemType = 'Movie' AND HasIntro = 0"
                },
                new
                {
                    name = "All movies missing credits",
                    sql = "SELECT * FROM MediaSegments WHERE ItemType = 'Movie' AND HasCredits = 0"
                },
                new
                {
                    name = "All episodes missing intros",
                    sql = "SELECT * FROM MediaSegments WHERE ItemType = 'Episode' AND HasIntro = 0"
                },
                new
                {
                    name = "All episodes missing credits",
                    sql = "SELECT * FROM MediaSegments WHERE ItemType = 'Episode' AND HasCredits = 0"
                },
                new
                {
                    name = "Longest intros",
                    sql = "SELECT ItemName, SeriesName, (IntroEndTicks - IntroStartTicks) / 10000000.0 AS DurationSec FROM MediaSegments WHERE HasIntro = 1 ORDER BY DurationSec DESC LIMIT 50"
                },
                new
                {
                    name = "Coverage summary by library",
                    sql = "SELECT LibraryName, COUNT(*) AS Total, SUM(HasIntro) AS WithIntro, SUM(HasCredits) AS WithCredits FROM MediaSegments GROUP BY LibraryName"
                }
            };

            return queries;
        }

        private void WriteSegmentToEmby(long internalId, string markerType, long? ticks)
        {
            var item = _libraryManager.GetItemById(internalId);
            if (item == null)
            {
                throw new ArgumentException("Item not found: " + internalId);
            }

            var chapters = _itemRepository.GetChapters(item);
            var chapterList = chapters != null
                ? new List<ChapterInfo>(chapters)
                : new List<ChapterInfo>();

            MarkerType embyMarkerType;
            switch (markerType)
            {
                case "IntroStart":
                    embyMarkerType = MarkerType.IntroStart;
                    break;
                case "IntroEnd":
                    embyMarkerType = MarkerType.IntroEnd;
                    break;
                case "CreditsStart":
                    embyMarkerType = MarkerType.CreditsStart;
                    break;
                default:
                    throw new ArgumentException("Invalid marker type: " + markerType);
            }

            var existing = chapterList.FindIndex(c => c.MarkerType == embyMarkerType);

            if (ticks.HasValue)
            {
                if (existing >= 0)
                {
                    chapterList[existing].StartPositionTicks = ticks.Value;
                }
                else
                {
                    chapterList.Add(new ChapterInfo
                    {
                        StartPositionTicks = ticks.Value,
                        MarkerType = embyMarkerType
                    });
                }
            }
            else
            {
                if (existing >= 0)
                {
                    chapterList.RemoveAt(existing);
                }
            }

            _itemRepository.SaveChapters(item.InternalId, chapterList);
        }

        private static long? GetTicksForMarkerType(SegmentInfo segment, string markerType)
        {
            switch (markerType)
            {
                case "IntroStart":
                    return segment.IntroStartTicks;
                case "IntroEnd":
                    return segment.IntroEndTicks;
                case "CreditsStart":
                    return segment.CreditsStartTicks;
                default:
                    return null;
            }
        }
    }
}
