using System;
using System.Collections.Generic;

namespace segment_reporting.Data
{
    public class SegmentInfo
    {
        public int Id { get; set; }
        public string ItemId { get; set; }
        public string ItemName { get; set; }
        public string ItemType { get; set; }
        public string SeriesName { get; set; }
        public string SeriesId { get; set; }
        public string SeasonName { get; set; }
        public string SeasonId { get; set; }
        public int? SeasonNumber { get; set; }
        public int? EpisodeNumber { get; set; }
        public string LibraryName { get; set; }
        public string LibraryId { get; set; }
        public long? IntroStartTicks { get; set; }
        public long? IntroEndTicks { get; set; }
        public long? CreditsStartTicks { get; set; }
        public int HasIntro { get; set; }
        public int HasCredits { get; set; }
        public DateTime LastSyncDate { get; set; }
    }

    public class LibrarySummaryItem
    {
        public string LibraryId { get; set; }
        public string LibraryName { get; set; }
        public int TotalItems { get; set; }
        public int WithIntro { get; set; }
        public int WithCredits { get; set; }
        public int WithBoth { get; set; }
        public int WithNeither { get; set; }
    }

    public class SeriesListItem
    {
        public string SeriesId { get; set; }
        public string SeriesName { get; set; }
        public int TotalEpisodes { get; set; }
        public int WithIntro { get; set; }
        public int WithCredits { get; set; }
    }

    public class SeasonListItem
    {
        public string SeasonId { get; set; }
        public string SeasonName { get; set; }
        public int SeasonNumber { get; set; }
        public string SeriesName { get; set; }
        public string LibraryId { get; set; }
        public int TotalEpisodes { get; set; }
        public int WithIntro { get; set; }
        public int WithCredits { get; set; }
    }

    public class SyncStatusInfo
    {
        public DateTime LastFullSync { get; set; }
        public int ItemsScanned { get; set; }
        public int SyncDuration { get; set; }
    }

    public class QueryResult
    {
        public List<string> Columns { get; set; }
        public List<List<string>> Rows { get; set; }
        public string Message { get; set; }
    }
}
