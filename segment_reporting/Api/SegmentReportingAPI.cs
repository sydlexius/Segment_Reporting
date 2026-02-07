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
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Services;
using segment_reporting.Data;

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

    public class SegmentReportingAPI : IService, IRequiresRequest
    {
        private readonly ILogger _logger;
        private readonly IServerConfigurationManager _config;
        private readonly ILibraryManager _libraryManager;

        public SegmentReportingAPI(ILogManager logger,
            IServerConfigurationManager config,
            ILibraryManager libraryManager)
        {
            _logger = logger.GetLogger("SegmentReporting - API");
            _config = config;
            _libraryManager = libraryManager;
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
    }
}
