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
    // http(s)://<host>:<port>/emby/segment_reporting/library_summary
    [Route("/segment_reporting/library_summary", "GET", Summary = "Gets per-library coverage stats")]
    [Authenticated(Roles = "admin")]
    public class GetLibrarySummary : IReturn<object>
    {
    }

    // http(s)://<host>:<port>/emby/segment_reporting/series_list?libraryId=X&search=&filter=
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

    // http(s)://<host>:<port>/emby/segment_reporting/season_list?seriesId=X
    [Route("/segment_reporting/season_list", "GET", Summary = "Gets seasons for a series with coverage stats")]
    [Authenticated(Roles = "admin")]
    public class GetSeasonList : IReturn<object>
    {
        [ApiMember(Name = "seriesId", Description = "Series ID", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "GET")]
        public string SeriesId { get; set; }
    }

    // http(s)://<host>:<port>/emby/segment_reporting/episode_list?seasonId=X or ?seriesId=X
    [Route("/segment_reporting/episode_list", "GET", Summary = "Gets episodes with full segment tick values")]
    [Authenticated(Roles = "admin")]
    public class GetEpisodeList : IReturn<object>
    {
        [ApiMember(Name = "seasonId", Description = "Season ID", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "GET")]
        public string SeasonId { get; set; }

        [ApiMember(Name = "seriesId", Description = "Series ID (alternative to seasonId for flat view)", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "GET")]
        public string SeriesId { get; set; }
    }

    // http(s)://<host>:<port>/emby/segment_reporting/item_segments?itemId=X
    [Route("/segment_reporting/item_segments", "GET", Summary = "Gets segment detail for a single item")]
    [Authenticated(Roles = "admin")]
    public class GetItemSegments : IReturn<object>
    {
        [ApiMember(Name = "itemId", Description = "Item ID", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "GET")]
        public string ItemId { get; set; }
    }

    // http(s)://<host>:<port>/emby/segment_reporting/update_segment
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

    // http(s)://<host>:<port>/emby/segment_reporting/delete_segment
    [Route("/segment_reporting/delete_segment", "POST", Summary = "Removes a segment marker from an item")]
    [Authenticated(Roles = "admin")]
    public class DeleteSegmentRequest : IReturn<object>
    {
        [ApiMember(Name = "ItemId", Description = "Item ID", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string ItemId { get; set; }

        [ApiMember(Name = "MarkerType", Description = "Segment type (IntroStart, IntroEnd, CreditsStart)", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string MarkerType { get; set; }
    }

    // http(s)://<host>:<port>/emby/segment_reporting/bulk_apply
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

    // http(s)://<host>:<port>/emby/segment_reporting/bulk_delete
    [Route("/segment_reporting/bulk_delete", "POST", Summary = "Removes segment types from multiple items")]
    [Authenticated(Roles = "admin")]
    public class BulkDelete : IReturn<object>
    {
        [ApiMember(Name = "ItemIds", Description = "Comma-separated item IDs", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string ItemIds { get; set; }

        [ApiMember(Name = "MarkerTypes", Description = "Comma-separated marker types (IntroStart, IntroEnd, CreditsStart)", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string MarkerTypes { get; set; }
    }

    // http(s)://<host>:<port>/emby/segment_reporting/bulk_set_credits_end
    [Route("/segment_reporting/bulk_set_credits_end", "POST", Summary = "Sets CreditsStart to runtime minus offset for items")]
    [Authenticated(Roles = "admin")]
    public class BulkSetCreditsEnd : IReturn<object>
    {
        [ApiMember(Name = "ItemIds", Description = "Comma-separated item IDs", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string ItemIds { get; set; }

        [ApiMember(Name = "OffsetTicks", Description = "Offset from end in ticks (default 0)", IsRequired = false, DataType = "long", ParameterType = "query", Verb = "POST")]
        public long OffsetTicks { get; set; }
    }

    // http(s)://<host>:<port>/emby/segment_reporting/sync_now
    [Route("/segment_reporting/sync_now", "POST", Summary = "Trigger immediate full sync")]
    [Authenticated(Roles = "admin")]
    public class SyncNow : IReturn<object>
    {
    }

    // http(s)://<host>:<port>/emby/segment_reporting/sync_status
    [Route("/segment_reporting/sync_status", "GET", Summary = "Get last sync time, items scanned, duration")]
    [Authenticated(Roles = "admin")]
    public class GetSyncStatus : IReturn<object>
    {
    }

    // http(s)://<host>:<port>/emby/segment_reporting/force_rescan
    [Route("/segment_reporting/force_rescan", "POST", Summary = "Drop and rebuild entire cache from scratch")]
    [Authenticated(Roles = "admin")]
    public class ForceRescan : IReturn<object>
    {
    }

    // http(s)://<host>:<port>/emby/segment_reporting/vacuum
    [Route("/segment_reporting/vacuum", "POST", Summary = "Run VACUUM on the cache database to reclaim disk space")]
    [Authenticated(Roles = "admin")]
    public class VacuumDatabase : IReturn<object>
    {
    }

    // http(s)://<host>:<port>/emby/segment_reporting/cache_stats
    [Route("/segment_reporting/cache_stats", "GET", Summary = "Get cache row count, DB file size, and last sync info")]
    [Authenticated(Roles = "admin")]
    public class GetCacheStats : IReturn<object>
    {
    }

    // http(s)://<host>:<port>/emby/segment_reporting/submit_custom_query
    [Route("/segment_reporting/submit_custom_query", "POST", Summary = "Execute read-only SQL against the cache")]
    [Authenticated(Roles = "admin")]
    public class SubmitCustomQuery : IReturn<object>
    {
        [ApiMember(Name = "query", Description = "SQL query to execute", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string Query { get; set; }
    }

    // http(s)://<host>:<port>/emby/segment_reporting/distinct_values?field=SeriesName
    [Route("/segment_reporting/distinct_values", "GET", Summary = "Get distinct values for a field from the cache")]
    [Authenticated(Roles = "admin")]
    public class GetDistinctValues : IReturn<object>
    {
        [ApiMember(Name = "field", Description = "Field name (ItemType, SeriesName, or LibraryName)", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "GET")]
        public string Field { get; set; }
    }

    // http(s)://<host>:<port>/emby/segment_reporting/canned_queries
    [Route("/segment_reporting/canned_queries", "GET", Summary = "Return list of built-in queries")]
    [Authenticated(Roles = "admin")]
    public class GetCannedQueries : IReturn<object>
    {
    }

    // http(s)://<host>:<port>/emby/segment_reporting/plugin_info
    [Route("/segment_reporting/plugin_info", "GET", Summary = "Get plugin name, version, and description")]
    [Authenticated(Roles = "admin")]
    public class GetPluginInfo : IReturn<object>
    {
    }

    // http(s)://<host>:<port>/emby/segment_reporting/preferences
    [Route("/segment_reporting/preferences", "GET", Summary = "Get all display preferences")]
    [Authenticated(Roles = "admin")]
    public class GetPreferences : IReturn<object>
    {
    }

    // http(s)://<host>:<port>/emby/segment_reporting/preferences
    [Route("/segment_reporting/preferences", "POST", Summary = "Save display preferences")]
    [Authenticated(Roles = "admin")]
    public class SavePreferences : IReturn<object>
    {
        [ApiMember(Name = "chartPalette", Description = "Palette name or 'auto'/'custom'", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string ChartPalette { get; set; }

        [ApiMember(Name = "customColorBoth", Description = "Custom hex color for Both Segments", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string CustomColorBoth { get; set; }

        [ApiMember(Name = "customColorIntro", Description = "Custom hex color for Intro Only", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string CustomColorIntro { get; set; }

        [ApiMember(Name = "customColorCredits", Description = "Custom hex color for Credits Only", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string CustomColorCredits { get; set; }

        [ApiMember(Name = "customColorNone", Description = "Custom hex color for No Segments", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string CustomColorNone { get; set; }

        [ApiMember(Name = "tableGridlines", Description = "Show table gridlines", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string TableGridlines { get; set; }

        [ApiMember(Name = "tableStripedRows", Description = "Show alternating row colors", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string TableStripedRows { get; set; }

        [ApiMember(Name = "hideMovieLibraries", Description = "Hide Movie libraries from dashboard", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string HideMovieLibraries { get; set; }

        [ApiMember(Name = "hideMixedLibraries", Description = "Hide Mixed libraries from dashboard", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string HideMixedLibraries { get; set; }

        [ApiMember(Name = "excludedLibraryIds", Description = "Comma-separated library IDs to exclude from dashboard", IsRequired = false, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string ExcludedLibraryIds { get; set; }
    }

    // http(s)://<host>:<port>/emby/segment_reporting/saved_queries
    [Route("/segment_reporting/saved_queries", "GET", Summary = "Get all saved queries")]
    [Authenticated(Roles = "admin")]
    public class GetSavedQueries : IReturn<object>
    {
    }

    // http(s)://<host>:<port>/emby/segment_reporting/saved_queries
    [Route("/segment_reporting/saved_queries", "POST", Summary = "Save a custom query")]
    [Authenticated(Roles = "admin")]
    public class AddSavedQuery : IReturn<object>
    {
        [ApiMember(Name = "name", Description = "Query name", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string Name { get; set; }

        [ApiMember(Name = "sql", Description = "SQL query text", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string Sql { get; set; }

        [ApiMember(Name = "id", Description = "Existing query ID to update (optional)", IsRequired = false, DataType = "long", ParameterType = "query", Verb = "POST")]
        public long? Id { get; set; }
    }

    // http(s)://<host>:<port>/emby/segment_reporting/saved_queries/{Id}
    [Route("/segment_reporting/saved_queries/{Id}", "DELETE", Summary = "Delete a saved query")]
    [Authenticated(Roles = "admin")]
    public class DeleteSavedQuery : IReturn<object>
    {
        [ApiMember(Name = "Id", Description = "Query ID to delete", IsRequired = true, DataType = "long", ParameterType = "path", Verb = "DELETE")]
        public long Id { get; set; }
    }

    // http(s)://<host>:<port>/emby/segment_reporting/version
    [Route("/segment_reporting/version", "GET", Summary = "Returns the plugin assembly version for cache validation")]
    [Authenticated(Roles = "admin")]
    public class GetPluginVersion : IReturn<object>
    {
    }

    public class SegmentReportingAPI : IService, IRequiresRequest
    {
        private readonly ILogger _logger;
        private readonly IServerConfigurationManager _config;
        private readonly ILibraryManager _libraryManager;
        private readonly IItemRepository _itemRepository;
        private readonly ITaskManager _taskManager;

        private const string DbFileName = "segment_reporting.db";
        private const int MaxBulkItems = 500;

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

        private string GetDbPath()
        {
            return Path.Combine(_config.ApplicationPaths.DataPath, DbFileName);
        }

        private SegmentRepository GetRepository()
        {
            return SegmentRepository.GetInstance(GetDbPath(), _logger);
        }

        private static bool IsJsNullString(string value)
        {
            return string.Equals(value, "null", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(value, "undefined", StringComparison.OrdinalIgnoreCase);
        }

        private static string[] SplitAndTrim(string input)
        {
            if (string.IsNullOrEmpty(input))
                return Array.Empty<string>();
            return input.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                        .Select(x => x.Trim())
                        .ToArray();
        }

        private object ValidateMarkerTypes(params string[] types)
        {
            foreach (var t in types)
            {
                if (!MarkerTypes.Valid.Contains(t))
                {
                    return new { error = "Invalid markerType: " + t };
                }
            }

            return null;
        }

        public object Get(GetPluginVersion request)
        {
            var v = GetType().Assembly.GetName().Version;
            return new { version = v.ToString() };
        }

        public object Get(GetLibrarySummary request)
        {
            _logger.Info("GetLibrarySummary");

            SegmentRepository repo = GetRepository();

            List<LibrarySummaryItem> summary = repo.GetLibrarySummary();

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

            SegmentRepository repo = GetRepository();

            string[] filters = SplitAndTrim(request.Filter);
            string contentType = repo.GetLibraryContentType(request.LibraryId);

            List<SeriesListItem> seriesList = null;
            List<SegmentInfo> movieList = null;

            if (contentType != "movies")
            {
                seriesList = repo.GetSeriesList(request.LibraryId, request.Search, filters);
            }
            if (contentType != "series")
            {
                movieList = repo.GetMovieList(request.LibraryId, request.Search, filters);
            }

            return new { contentType = contentType, series = seriesList, movies = movieList };
        }

        public object Get(GetSeasonList request)
        {
            _logger.Info("GetSeasonList: seriesId={0}", request.SeriesId);

            if (string.IsNullOrEmpty(request.SeriesId))
            {
                return new { error = "seriesId is required" };
            }

            SegmentRepository repo = GetRepository();

            List<SeasonListItem> seasonList = repo.GetSeasonList(request.SeriesId);

            return seasonList;
        }

        public object Get(GetEpisodeList request)
        {
            _logger.Info("GetEpisodeList: seasonId={0}, seriesId={1}", request.SeasonId, request.SeriesId);

            SegmentRepository repo = GetRepository();

            List<SegmentInfo> episodes;

            if (!string.IsNullOrEmpty(request.SeasonId))
            {
                // JS encodeURIComponent(null) sends literal "null" — treat as NULL SeasonId
                string seasonId = IsJsNullString(request.SeasonId) ? null : request.SeasonId;
                string seriesScope = IsJsNullString(request.SeriesId) ? null : request.SeriesId;

                // Null-season queries MUST be scoped to a series to avoid cross-series results
                if (seasonId == null && string.IsNullOrEmpty(seriesScope))
                {
                    _logger.Warn("GetEpisodeList: null seasonId without seriesId — returning empty");
                    return new List<SegmentInfo>();
                }

                episodes = repo.GetEpisodeList(seasonId, seriesScope);
            }
            else if (!string.IsNullOrEmpty(request.SeriesId))
            {
                episodes = repo.GetEpisodeListBySeries(request.SeriesId);
            }
            else
            {
                return new { error = "Either seasonId or seriesId is required" };
            }

            return episodes;
        }

        public object Get(GetItemSegments request)
        {
            _logger.Info("GetItemSegments: itemId={0}", request.ItemId);

            if (string.IsNullOrEmpty(request.ItemId))
            {
                return new { error = "itemId is required" };
            }

            SegmentRepository repo = GetRepository();

            SegmentInfo segment = repo.GetItemSegments(request.ItemId);

            if (segment == null)
            {
                return new { error = "Item not found" };
            }

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
            var validationError = ValidateMarkerTypes(request.MarkerType);
            if (validationError != null)
                return validationError;
            if (request.Ticks < 0)
            {
                return new { error = "ticks must be non-negative" };
            }

            try
            {
                long internalId = long.Parse(request.ItemId);
                WriteSegmentToEmby(internalId, request.MarkerType, request.Ticks);

                SegmentRepository repo = GetRepository();
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
            var validationError = ValidateMarkerTypes(request.MarkerType);
            if (validationError != null)
                return validationError;

            try
            {
                long internalId = long.Parse(request.ItemId);
                WriteSegmentToEmby(internalId, request.MarkerType, null);

                SegmentRepository repo = GetRepository();
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

            var targetIds = SplitAndTrim(request.TargetItemIds);
            var markerTypes = SplitAndTrim(request.MarkerTypes);

            if (targetIds.Length > MaxBulkItems)
            {
                return new { error = "Maximum " + MaxBulkItems + " items per batch" };
            }

            var validationError = ValidateMarkerTypes(markerTypes);
            if (validationError != null)
                return validationError;

            SegmentRepository repo = GetRepository();

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

            var itemIds = SplitAndTrim(request.ItemIds);
            var markerTypes = SplitAndTrim(request.MarkerTypes);

            if (itemIds.Length > MaxBulkItems)
            {
                return new { error = "Maximum " + MaxBulkItems + " items per batch" };
            }

            var validationError = ValidateMarkerTypes(markerTypes);
            if (validationError != null)
                return validationError;

            SegmentRepository repo = GetRepository();

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

            var itemIds = SplitAndTrim(request.ItemIds);

            if (itemIds.Length > MaxBulkItems)
            {
                return new { error = "Maximum " + MaxBulkItems + " items per batch" };
            }

            SegmentRepository repo = GetRepository();

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

                    WriteSegmentToEmby(internalId, MarkerTypes.CreditsStart, creditsStartTicks);
                    repo.UpdateSegmentTicks(itemId, MarkerTypes.CreditsStart, creditsStartTicks);
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

            SegmentRepository repo = GetRepository();

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
                SegmentRepository repo = GetRepository();

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

        public object Post(VacuumDatabase request)
        {
            _logger.Info("VacuumDatabase: Running VACUUM");

            try
            {
                SegmentRepository repo = GetRepository();
                repo.VacuumDatabase();

                long dbFileSize = 0;
                string dbPath = GetDbPath();
                if (File.Exists(dbPath))
                {
                    dbFileSize = new FileInfo(dbPath).Length;
                }

                return new { success = true, dbFileSize };
            }
            catch (Exception ex)
            {
                _logger.ErrorException("VacuumDatabase: Failed", ex);
                return new { error = ex.Message };
            }
        }

        public object Get(GetCacheStats request)
        {
            _logger.Info("GetCacheStats");

            SegmentRepository repo = GetRepository();

            int rowCount = repo.GetRowCount();
            SyncStatusInfo syncStatus = repo.GetSyncStatus();

            long dbFileSize = 0;
            string dbPath = GetDbPath();
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

            SegmentRepository repo = GetRepository();

            QueryResult result = repo.RunCustomQuery(request.Query);

            return result;
        }

        public object Get(GetDistinctValues request)
        {
            if (string.IsNullOrWhiteSpace(request.Field))
            {
                return new { error = "field is required" };
            }

            SegmentRepository repo = GetRepository();
            var values = repo.GetDistinctValues(request.Field);

            if (values == null)
            {
                return new { error = "Invalid field. Allowed: ItemType, SeriesName, LibraryName" };
            }

            return new { values };
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

        public object Get(GetPluginInfo request)
        {
            var plugin = Plugin.Instance;
            var version = plugin.GetType().Assembly.GetName().Version;

            return new
            {
                name = plugin.Name,
                version = version.ToString(),
                description = plugin.Description
            };
        }

        public object Get(GetPreferences request)
        {
            _logger.Info("GetPreferences");

            SegmentRepository repo = GetRepository();
            return repo.GetAllPreferences();
        }

        public object Post(SavePreferences request)
        {
            _logger.Info("SavePreferences");

            SegmentRepository repo = GetRepository();

            var entries = new Dictionary<string, string>
            {
                { "chartPalette", request.ChartPalette },
                { "customColorBoth", request.CustomColorBoth },
                { "customColorIntro", request.CustomColorIntro },
                { "customColorCredits", request.CustomColorCredits },
                { "customColorNone", request.CustomColorNone },
                { "tableGridlines", request.TableGridlines },
                { "tableStripedRows", request.TableStripedRows },
                { "hideMovieLibraries", request.HideMovieLibraries },
                { "hideMixedLibraries", request.HideMixedLibraries },
                { "excludedLibraryIds", request.ExcludedLibraryIds }
            };

            foreach (var entry in entries)
            {
                if (entry.Value != null)
                {
                    repo.SetPreference(entry.Key, entry.Value);
                }
            }

            return new { success = true };
        }

        public object Get(GetSavedQueries request)
        {
            _logger.Info("GetSavedQueries");
            SegmentRepository repo = GetRepository();
            return repo.GetSavedQueries();
        }

        public object Post(AddSavedQuery request)
        {
            _logger.Info("AddSavedQuery: {0}", request.Name);
            SegmentRepository repo = GetRepository();

            if (request.Id.HasValue && request.Id.Value > 0)
            {
                repo.UpdateSavedQuery(request.Id.Value, request.Name, request.Sql);
                return new { success = true, id = request.Id.Value };
            }

            long newId = repo.AddSavedQuery(request.Name, request.Sql);
            return new { success = true, id = newId };
        }

        public object Delete(DeleteSavedQuery request)
        {
            _logger.Info("DeleteSavedQuery: {0}", request.Id);
            SegmentRepository repo = GetRepository();
            repo.DeleteSavedQuery(request.Id);
            return new { success = true };
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
                case MarkerTypes.IntroStart:
                    embyMarkerType = MarkerType.IntroStart;
                    break;
                case MarkerTypes.IntroEnd:
                    embyMarkerType = MarkerType.IntroEnd;
                    break;
                case MarkerTypes.CreditsStart:
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
                case MarkerTypes.IntroStart:
                    return segment.IntroStartTicks;
                case MarkerTypes.IntroEnd:
                    return segment.IntroEndTicks;
                case MarkerTypes.CreditsStart:
                    return segment.CreditsStartTicks;
                default:
                    return null;
            }
        }
    }
}
