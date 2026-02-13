using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using MediaBrowser.Model.Logging;
using SQLitePCL.pretty;

namespace segment_reporting.Data
{
    public sealed class SegmentRepository : IDisposable
    {
        public const string DbFileName = "segment_reporting.db";

        private static SegmentRepository _instance;
        private static readonly object _instanceLock = new object();

        private readonly SQLiteDatabaseConnection _connection;
        private readonly object _dbLock = new object();
        private readonly ILogger _logger;
        private readonly string _dbPath;
        private bool _disposed;

        private void ThrowIfDisposed()
        {
            if (_disposed)
                throw new ObjectDisposedException(nameof(SegmentRepository));
        }

        private static readonly char[] _pragmaNameDelimiters = new[] { '(', '=', ' ', '\t', '\n', '\r' };
        private static readonly char[] _whitespaceDelimiters = new[] { ' ', '\t', '\n', '\r' };

        private static readonly string[] _dateFormats = new[]
        {
            "yyyy-MM-dd HH:mm:ss.fff",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-ddTHH:mm:ss.fff",
            "yyyy-MM-ddTHH:mm:ss"
        };

        private SegmentRepository(string dbPath, ILogger logger)
        {
            _dbPath = dbPath;
            _logger = logger;
            _connection = CreateConnection();
            Initialize();
        }

        public static SegmentRepository GetInstance(string dbPath, ILogger logger)
        {
            lock (_instanceLock)
            {
                if (_instance == null || _instance._disposed)
                {
#pragma warning disable IDISP003 // Dispose previous before re-assigning - _disposed means already disposed
                    _instance = new SegmentRepository(dbPath, logger);
#pragma warning restore IDISP003
                }
                else if (!string.Equals(_instance._dbPath, dbPath, StringComparison.OrdinalIgnoreCase))
                {
                    logger.Warn("SegmentRepository: requested path {0} differs from existing {1}", dbPath, _instance._dbPath);
                }
                return _instance;
            }
        }

        private SQLiteDatabaseConnection CreateConnection()
        {
            var flags = ConnectionFlags.Create | ConnectionFlags.ReadWrite |
                        ConnectionFlags.PrivateCache | ConnectionFlags.FullMutex;

            var db = SQLite3.Open(_dbPath, flags, null, true);

            db.ExecuteAll(string.Join(";",
                "PRAGMA synchronous=Normal",
                "PRAGMA temp_store=file",
                "PRAGMA journal_mode=WAL"));

            return db;
        }

        #region Schema

        public void Initialize()
        {
            lock (_dbLock)
            {
                InitializeUnlocked();
            }
        }

        private void InitializeUnlocked()
        {
            ThrowIfDisposed();
            _logger.Info("SegmentRepository: Initializing database at {0}", _dbPath);

            _connection.Execute(
                "CREATE TABLE IF NOT EXISTS MediaSegments (" +
                "Id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "ItemId TEXT NOT NULL, " +
                "ItemName TEXT, " +
                "ItemType TEXT, " +
                "SeriesName TEXT, " +
                "SeriesId TEXT, " +
                "SeasonName TEXT, " +
                "SeasonId TEXT, " +
                "SeasonNumber INT, " +
                "EpisodeNumber INT, " +
                "LibraryName TEXT, " +
                "LibraryId TEXT, " +
                "IntroStartTicks BIGINT, " +
                "IntroEndTicks BIGINT, " +
                "CreditsStartTicks BIGINT, " +
                "HasIntro INT, " +
                "HasCredits INT)");

            _connection.Execute(
                "CREATE TABLE IF NOT EXISTS SyncStatus (" +
                "Id INTEGER PRIMARY KEY, " +
                "LastFullSync DATETIME, " +
                "ItemsScanned INT, " +
                "SyncDuration INT)");

            _connection.Execute(
                "CREATE TABLE IF NOT EXISTS UserPreferences (" +
                "[Key] TEXT PRIMARY KEY, " +
                "[Value] TEXT)");

            _connection.Execute(
                "CREATE TABLE IF NOT EXISTS SavedQueries (" +
                "Id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "QueryName TEXT NOT NULL, " +
                "QuerySql TEXT NOT NULL, " +
                "CreatedDate DATETIME DEFAULT CURRENT_TIMESTAMP)");

            CheckMigration();

            _connection.Execute("CREATE INDEX IF NOT EXISTS idx_segments_library ON MediaSegments(LibraryId)");
            _connection.Execute("CREATE INDEX IF NOT EXISTS idx_segments_series ON MediaSegments(SeriesId)");
            _connection.Execute("CREATE INDEX IF NOT EXISTS idx_segments_season ON MediaSegments(SeasonId)");
            _connection.Execute("CREATE INDEX IF NOT EXISTS idx_segments_missing ON MediaSegments(HasIntro, HasCredits)");
            _connection.Execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_segments_itemid ON MediaSegments(ItemId)");

            _logger.Info("SegmentRepository: Database initialized");
        }

        private void CheckMigration()
        {
            var existingColumns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            using (var statement = _connection.PrepareStatement("PRAGMA table_info('MediaSegments')"))
            {
                while (statement.MoveNext())
                {
                    var row = statement.Current;
                    existingColumns.Add(row.GetString(1));
                }
            }

            var requiredColumns = new Dictionary<string, string>
            {
                { "ItemId", "TEXT NOT NULL DEFAULT ''" },
                { "ItemName", "TEXT" },
                { "ItemType", "TEXT" },
                { "SeriesName", "TEXT" },
                { "SeriesId", "TEXT" },
                { "SeasonName", "TEXT" },
                { "SeasonId", "TEXT" },
                { "SeasonNumber", "INT" },
                { "EpisodeNumber", "INT" },
                { "LibraryName", "TEXT" },
                { "LibraryId", "TEXT" },
                { "IntroStartTicks", "BIGINT" },
                { "IntroEndTicks", "BIGINT" },
                { "CreditsStartTicks", "BIGINT" },
                { "HasIntro", "INT DEFAULT 0" },
                { "HasCredits", "INT DEFAULT 0" }
            };

            foreach (var col in requiredColumns)
            {
                if (!existingColumns.Contains(col.Key))
                {
                    _logger.Info("SegmentRepository: Adding column {0}", col.Key);
                    _connection.Execute("ALTER TABLE MediaSegments ADD COLUMN " + col.Key + " " + col.Value);
                }
            }

            // LastSyncDate was removed in v1.0.4 - sync timing is tracked in the
            // SyncStatus table. Try to drop the column entirely; fall back to
            // nulling it out on older SQLite versions that lack DROP COLUMN.
            if (existingColumns.Contains("LastSyncDate"))
            {
                try
                {
                    _connection.Execute("ALTER TABLE MediaSegments DROP COLUMN LastSyncDate");
                    _logger.Info("SegmentRepository: Dropped obsolete LastSyncDate column");
                }
                catch (Exception)
                {
                    _logger.Info("SegmentRepository: DROP COLUMN not supported, clearing LastSyncDate values");
                    _connection.Execute("UPDATE MediaSegments SET LastSyncDate = NULL WHERE LastSyncDate IS NOT NULL");
                }
            }
        }

        #endregion

        #region Bind Helpers

        private void TryBind(IStatement statement, string name, string value)
        {
            IBindParameter bindParam;
            if (statement.BindParameters.TryGetValue(name, out bindParam))
            {
                if (value == null)
                    bindParam.BindNull();
                else
                    bindParam.Bind(value);
            }
        }

        private void TryBind(IStatement statement, string name, int value)
        {
            IBindParameter bindParam;
            if (statement.BindParameters.TryGetValue(name, out bindParam))
            {
                bindParam.Bind(value);
            }
        }

        private void TryBind(IStatement statement, string name, long value)
        {
            IBindParameter bindParam;
            if (statement.BindParameters.TryGetValue(name, out bindParam))
            {
                bindParam.Bind(value);
            }
        }

        private void TryBindNullableInt(IStatement statement, string name, int? value)
        {
            IBindParameter bindParam;
            if (statement.BindParameters.TryGetValue(name, out bindParam))
            {
                if (value.HasValue)
                    bindParam.Bind(value.Value);
                else
                    bindParam.BindNull();
            }
        }

        private void TryBindNullableLong(IStatement statement, string name, long? value)
        {
            IBindParameter bindParam;
            if (statement.BindParameters.TryGetValue(name, out bindParam))
            {
                if (value.HasValue)
                    bindParam.Bind(value.Value);
                else
                    bindParam.BindNull();
            }
        }

        private void TryBindDateTime(IStatement statement, string name, DateTime value)
        {
            IBindParameter bindParam;
            if (statement.BindParameters.TryGetValue(name, out bindParam))
            {
                bindParam.Bind(value.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture));
            }
        }

        #endregion

        #region Read Helpers

        private string ReadString(IResultSet row, int index)
        {
            if (row.IsDBNull(index))
                return null;
            return row.GetString(index);
        }

        private int ReadInt(IResultSet row, int index)
        {
            if (row.IsDBNull(index))
                return 0;
            return row.GetInt(index);
        }

        private int? ReadNullableInt(IResultSet row, int index)
        {
            if (row.IsDBNull(index))
                return null;
            return row.GetInt(index);
        }

        private long? ReadNullableLong(IResultSet row, int index)
        {
            if (row.IsDBNull(index))
                return null;
            return row.GetInt64(index);
        }

        private DateTime ReadDateTime(IResultSet row, int index)
        {
            if (row.IsDBNull(index))
                return DateTime.MinValue;

            var str = row.GetString(index);
            DateTime result;
            if (DateTime.TryParseExact(str, _dateFormats, CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out result))
            {
                return result;
            }
            return DateTime.MinValue;
        }

        private SegmentInfo ReadSegmentInfo(IResultSet row)
        {
            return new SegmentInfo
            {
                Id = ReadInt(row, 0),
                ItemId = ReadString(row, 1),
                ItemName = ReadString(row, 2),
                ItemType = ReadString(row, 3),
                SeriesName = ReadString(row, 4),
                SeriesId = ReadString(row, 5),
                SeasonName = ReadString(row, 6),
                SeasonId = ReadString(row, 7),
                SeasonNumber = ReadNullableInt(row, 8),
                EpisodeNumber = ReadNullableInt(row, 9),
                LibraryName = ReadString(row, 10),
                LibraryId = ReadString(row, 11),
                IntroStartTicks = ReadNullableLong(row, 12),
                IntroEndTicks = ReadNullableLong(row, 13),
                CreditsStartTicks = ReadNullableLong(row, 14),
                HasIntro = ReadInt(row, 15),
                HasCredits = ReadInt(row, 16)
            };
        }

        #endregion

        #region Upsert

        private const int DefaultChunkSize = 500;

        public void UpsertSegments(List<SegmentInfo> segments, CancellationToken cancellationToken = default(CancellationToken),
            IProgress<double> progress = null, int chunkSize = DefaultChunkSize)
        {
            if (segments.Count == 0)
                return;

            int total = segments.Count;

            for (int offset = 0; offset < total; offset += chunkSize)
            {
                cancellationToken.ThrowIfCancellationRequested();

                int end = Math.Min(offset + chunkSize, total);

                lock (_dbLock)
                {
                    ThrowIfDisposed();
                    _connection.Execute("BEGIN TRANSACTION");
                    try
                    {
                        for (int i = offset; i < end; i++)
                        {
                            UpsertSegmentInternal(segments[i]);
                        }
                        _connection.Execute("COMMIT");
                    }
                    catch (OperationCanceledException)
                    {
                        _logger.Info("SegmentRepository: UpsertSegments cancelled at chunk offset {0}, rolling back", offset);
                        _connection.Execute("ROLLBACK");
                        throw;
                    }
                    catch (Exception ex)
                    {
                        _logger.ErrorException("SegmentRepository: UpsertSegments failed at chunk offset " + offset + ", rolling back", ex);
                        _connection.Execute("ROLLBACK");
                        throw;
                    }
                }

                if (progress != null)
                {
                    progress.Report((double)end / total * 100);
                }
            }
        }

        private void UpsertSegmentInternal(SegmentInfo segment)
        {
            using (var stmt = _connection.PrepareStatement(
                "INSERT INTO MediaSegments " +
                "(ItemId, ItemName, ItemType, SeriesName, SeriesId, " +
                "SeasonName, SeasonId, SeasonNumber, EpisodeNumber, " +
                "LibraryName, LibraryId, IntroStartTicks, IntroEndTicks, " +
                "CreditsStartTicks, HasIntro, HasCredits) " +
                "VALUES " +
                "(@ItemId, @ItemName, @ItemType, @SeriesName, @SeriesId, " +
                "@SeasonName, @SeasonId, @SeasonNumber, @EpisodeNumber, " +
                "@LibraryName, @LibraryId, @IntroStartTicks, @IntroEndTicks, " +
                "@CreditsStartTicks, @HasIntro, @HasCredits) " +
                "ON CONFLICT(ItemId) DO UPDATE SET " +
                "ItemName = excluded.ItemName, ItemType = excluded.ItemType, " +
                "SeriesName = excluded.SeriesName, SeriesId = excluded.SeriesId, " +
                "SeasonName = excluded.SeasonName, SeasonId = excluded.SeasonId, " +
                "SeasonNumber = excluded.SeasonNumber, EpisodeNumber = excluded.EpisodeNumber, " +
                "LibraryName = excluded.LibraryName, LibraryId = excluded.LibraryId, " +
                "IntroStartTicks = excluded.IntroStartTicks, IntroEndTicks = excluded.IntroEndTicks, " +
                "CreditsStartTicks = excluded.CreditsStartTicks, " +
                "HasIntro = excluded.HasIntro, HasCredits = excluded.HasCredits"))
            {
                BindSegmentParams(stmt, segment);
                stmt.MoveNext();
            }
        }

        public void UpdateSegmentTicks(string itemId, string markerType, long ticks)
        {
            if (!MarkerTypes.Valid.Contains(markerType))
            {
                _logger.Warn("SegmentRepository: Unknown marker type {0}", markerType);
                return;
            }

            string column = MarkerTypes.GetColumnName(markerType);

            lock (_dbLock)
            {
                ThrowIfDisposed();
                var sql = "UPDATE MediaSegments SET " + column + " = @Ticks";

                if (MarkerTypes.IsIntroType(markerType))
                {
                    sql += ", HasIntro = 1";
                }
                else
                {
                    sql += ", HasCredits = 1";
                }

                sql += " WHERE ItemId = @ItemId";

                using (var stmt = _connection.PrepareStatement(sql))
                {
                    TryBind(stmt, "@Ticks", ticks);
                    TryBind(stmt, "@ItemId", itemId);
                    stmt.MoveNext();
                }
            }
        }

        private void BindSegmentParams(IStatement stmt, SegmentInfo segment)
        {
            TryBind(stmt, "@ItemId", segment.ItemId);
            TryBind(stmt, "@ItemName", segment.ItemName);
            TryBind(stmt, "@ItemType", segment.ItemType);
            TryBind(stmt, "@SeriesName", segment.SeriesName);
            TryBind(stmt, "@SeriesId", segment.SeriesId);
            TryBind(stmt, "@SeasonName", segment.SeasonName);
            TryBind(stmt, "@SeasonId", segment.SeasonId);
            TryBindNullableInt(stmt, "@SeasonNumber", segment.SeasonNumber);
            TryBindNullableInt(stmt, "@EpisodeNumber", segment.EpisodeNumber);
            TryBind(stmt, "@LibraryName", segment.LibraryName);
            TryBind(stmt, "@LibraryId", segment.LibraryId);
            TryBindNullableLong(stmt, "@IntroStartTicks", segment.IntroStartTicks);
            TryBindNullableLong(stmt, "@IntroEndTicks", segment.IntroEndTicks);
            TryBindNullableLong(stmt, "@CreditsStartTicks", segment.CreditsStartTicks);
            TryBind(stmt, "@HasIntro", segment.HasIntro);
            TryBind(stmt, "@HasCredits", segment.HasCredits);
        }

        #endregion

        private static void ApplySegmentFilters(List<string> clauses, string[] filters)
        {
            if (filters == null)
                return;
            foreach (var f in filters)
            {
                if (string.Equals(f, "missing_intro", StringComparison.OrdinalIgnoreCase))
                    clauses.Add("HasIntro = 0");
                else if (string.Equals(f, "missing_credits", StringComparison.OrdinalIgnoreCase))
                    clauses.Add("HasCredits = 0");
            }
        }

        private static void ApplySegmentHavingFilters(List<string> clauses, string[] filters)
        {
            if (filters == null)
                return;
            foreach (var f in filters)
            {
                if (string.Equals(f, "missing_intro", StringComparison.OrdinalIgnoreCase))
                    clauses.Add("SUM(HasIntro) < COUNT(*)");
                else if (string.Equals(f, "missing_credits", StringComparison.OrdinalIgnoreCase))
                    clauses.Add("SUM(HasCredits) < COUNT(*)");
            }
        }

        #region Reporting Queries

        public List<LibrarySummaryItem> GetLibrarySummary()
        {
            var results = new List<LibrarySummaryItem>();
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(
                    "SELECT LibraryId, LibraryName, " +
                    "COUNT(*) as TotalItems, " +
                    "SUM(HasIntro) as WithIntro, " +
                    "SUM(HasCredits) as WithCredits, " +
                    "SUM(CASE WHEN HasIntro = 1 AND HasCredits = 1 THEN 1 ELSE 0 END) as WithBoth, " +
                    "SUM(CASE WHEN HasIntro = 0 AND HasCredits = 0 THEN 1 ELSE 0 END) as WithNeither, " +
                    "CASE " +
                    "  WHEN SUM(CASE WHEN ItemType = 'Episode' THEN 1 ELSE 0 END) > 0 " +
                    "   AND SUM(CASE WHEN ItemType = 'Movie' THEN 1 ELSE 0 END) > 0 THEN 'mixed' " +
                    "  WHEN SUM(CASE WHEN ItemType = 'Movie' THEN 1 ELSE 0 END) > 0 THEN 'movies' " +
                    "  ELSE 'series' " +
                    "END as ContentType " +
                    "FROM MediaSegments " +
                    "GROUP BY LibraryId, LibraryName " +
                    "ORDER BY LibraryName"))
                {
                    while (stmt.MoveNext())
                    {
                        var row = stmt.Current;
                        results.Add(new LibrarySummaryItem
                        {
                            LibraryId = ReadString(row, 0),
                            LibraryName = ReadString(row, 1),
                            TotalItems = ReadInt(row, 2),
                            WithIntro = ReadInt(row, 3),
                            WithCredits = ReadInt(row, 4),
                            WithBoth = ReadInt(row, 5),
                            WithNeither = ReadInt(row, 6),
                            ContentType = ReadString(row, 7)
                        });
                    }
                }
            }
            return results;
        }

        public List<SeriesListItem> GetSeriesList(string libraryId, string search, string[] filters)
        {
            var results = new List<SeriesListItem>();
            var whereClauses = new List<string> { "LibraryId = @LibraryId", "ItemType = 'Episode'" };

            if (!string.IsNullOrWhiteSpace(search))
            {
                whereClauses.Add("SeriesName LIKE @Search");
            }

            var havingClauses = new List<string>();
            ApplySegmentHavingFilters(havingClauses, filters);

            var sql = "SELECT SeriesId, SeriesName, " +
                      "COUNT(*) as TotalEpisodes, " +
                      "SUM(HasIntro) as WithIntro, " +
                      "SUM(HasCredits) as WithCredits " +
                      "FROM MediaSegments " +
                      "WHERE " + string.Join(" AND ", whereClauses) + " " +
                      "GROUP BY SeriesId, SeriesName " +
                      (havingClauses.Count > 0 ? "HAVING " + string.Join(" AND ", havingClauses) + " " : string.Empty) +
                      "ORDER BY SeriesName";

            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(sql))
                {
                    TryBind(stmt, "@LibraryId", libraryId);
                    if (!string.IsNullOrWhiteSpace(search))
                    {
                        TryBind(stmt, "@Search", "%" + search + "%");
                    }

                    while (stmt.MoveNext())
                    {
                        var row = stmt.Current;
                        results.Add(new SeriesListItem
                        {
                            SeriesId = ReadString(row, 0),
                            SeriesName = ReadString(row, 1),
                            TotalEpisodes = ReadInt(row, 2),
                            WithIntro = ReadInt(row, 3),
                            WithCredits = ReadInt(row, 4)
                        });
                    }
                }
            }
            return results;
        }

        public string GetLibraryContentType(string libraryId)
        {
            bool hasEpisodes = false;
            bool hasMovies = false;
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(
                    "SELECT DISTINCT ItemType FROM MediaSegments WHERE LibraryId = @LibraryId"))
                {
                    TryBind(stmt, "@LibraryId", libraryId);
                    while (stmt.MoveNext())
                    {
                        string itemType = ReadString(stmt.Current, 0);
                        if (string.Equals(itemType, "Episode", StringComparison.OrdinalIgnoreCase))
                            hasEpisodes = true;
                        else if (string.Equals(itemType, "Movie", StringComparison.OrdinalIgnoreCase))
                            hasMovies = true;
                    }
                }
            }

            if (hasEpisodes && hasMovies)
                return "mixed";
            if (hasMovies)
                return "movies";
            return "series";
        }

        public List<SegmentInfo> GetMovieList(string libraryId, string search, string[] filters)
        {
            var results = new List<SegmentInfo>();
            var whereClauses = new List<string> { "LibraryId = @LibraryId", "ItemType = 'Movie'" };

            if (!string.IsNullOrWhiteSpace(search))
            {
                whereClauses.Add("ItemName LIKE @Search");
            }

            ApplySegmentFilters(whereClauses, filters);

            var sql = "SELECT * FROM MediaSegments " +
                      "WHERE " + string.Join(" AND ", whereClauses) + " " +
                      "ORDER BY ItemName";

            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(sql))
                {
                    TryBind(stmt, "@LibraryId", libraryId);
                    if (!string.IsNullOrWhiteSpace(search))
                    {
                        TryBind(stmt, "@Search", "%" + search + "%");
                    }

                    while (stmt.MoveNext())
                    {
                        results.Add(ReadSegmentInfo(stmt.Current));
                    }
                }
            }
            return results;
        }

        public List<SeasonListItem> GetSeasonList(string seriesId)
        {
            var results = new List<SeasonListItem>();
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(
                    "SELECT SeasonId, SeasonName, SeasonNumber, SeriesName, LibraryId, " +
                    "COUNT(*) as TotalEpisodes, " +
                    "SUM(HasIntro) as WithIntro, " +
                    "SUM(HasCredits) as WithCredits " +
                    "FROM MediaSegments " +
                    "WHERE SeriesId = @SeriesId " +
                    "GROUP BY SeasonId, SeasonName, SeasonNumber, SeriesName, LibraryId " +
                    "ORDER BY SeasonNumber"))
                {
                    TryBind(stmt, "@SeriesId", seriesId);
                    while (stmt.MoveNext())
                    {
                        var row = stmt.Current;
                        results.Add(new SeasonListItem
                        {
                            SeasonId = ReadString(row, 0),
                            SeasonName = ReadString(row, 1),
                            SeasonNumber = ReadInt(row, 2),
                            SeriesName = ReadString(row, 3),
                            LibraryId = ReadString(row, 4),
                            TotalEpisodes = ReadInt(row, 5),
                            WithIntro = ReadInt(row, 6),
                            WithCredits = ReadInt(row, 7)
                        });
                    }
                }
            }
            return results;
        }

        public List<SegmentInfo> GetEpisodeList(string seasonId, string seriesId = null)
        {
            var results = new List<SegmentInfo>();
            bool isNullSeason = string.IsNullOrEmpty(seasonId);

            string sql;
            if (isNullSeason)
            {
                // Episodes with no season parent — scope to series when available
                sql = !string.IsNullOrEmpty(seriesId)
                    ? "SELECT * FROM MediaSegments WHERE SeasonId IS NULL AND SeriesId = @SeriesId AND ItemType = 'Episode' ORDER BY EpisodeNumber"
                    : "SELECT * FROM MediaSegments WHERE SeasonId IS NULL AND ItemType = 'Episode' ORDER BY EpisodeNumber";
            }
            else
            {
                sql = "SELECT * FROM MediaSegments WHERE SeasonId = @SeasonId ORDER BY EpisodeNumber";
            }

            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(sql))
                {
                    if (!isNullSeason)
                    {
                        TryBind(stmt, "@SeasonId", seasonId);
                    }
                    else if (!string.IsNullOrEmpty(seriesId))
                    {
                        TryBind(stmt, "@SeriesId", seriesId);
                    }

                    while (stmt.MoveNext())
                    {
                        results.Add(ReadSegmentInfo(stmt.Current));
                    }
                }
            }
            return results;
        }

        public List<SegmentInfo> GetEpisodeListBySeries(string seriesId)
        {
            var results = new List<SegmentInfo>();
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(
                    "SELECT * FROM MediaSegments " +
                    "WHERE SeriesId = @SeriesId " +
                    "ORDER BY SeasonNumber, EpisodeNumber"))
                {
                    TryBind(stmt, "@SeriesId", seriesId);
                    while (stmt.MoveNext())
                    {
                        results.Add(ReadSegmentInfo(stmt.Current));
                    }
                }
            }
            return results;
        }

        public SegmentInfo GetItemSegments(string itemId)
        {
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(
                    "SELECT * FROM MediaSegments WHERE ItemId = @ItemId"))
                {
                    TryBind(stmt, "@ItemId", itemId);
                    if (stmt.MoveNext())
                    {
                        return ReadSegmentInfo(stmt.Current);
                    }
                }
            }
            return null;
        }

        #endregion

        #region Delete / Cleanup

        public void DeleteSegment(string itemId, string markerType)
        {
            if (!MarkerTypes.Valid.Contains(markerType))
            {
                _logger.Warn("SegmentRepository: Unknown marker type {0}", markerType);
                return;
            }

            string column = MarkerTypes.GetColumnName(markerType);

            lock (_dbLock)
            {
                ThrowIfDisposed();
                var sql = "UPDATE MediaSegments SET " + column + " = NULL";

                if (MarkerTypes.IsIntroType(markerType))
                {
                    string otherColumn = markerType == MarkerTypes.IntroStart
                        ? MarkerTypes.GetColumnName(MarkerTypes.IntroEnd)
                        : MarkerTypes.GetColumnName(MarkerTypes.IntroStart);
                    sql += ", HasIntro = CASE WHEN " + otherColumn + " IS NOT NULL THEN 1 ELSE 0 END";
                }
                else
                {
                    sql += ", HasCredits = 0";
                }

                sql += " WHERE ItemId = @ItemId";

                using (var stmt = _connection.PrepareStatement(sql))
                {
                    TryBind(stmt, "@ItemId", itemId);
                    stmt.MoveNext();
                }
            }
        }

        public void RemoveOrphanedRows(List<string> validItemIds, CancellationToken cancellationToken = default(CancellationToken),
            int chunkSize = DefaultChunkSize)
        {
            if (validItemIds == null || validItemIds.Count == 0)
            {
                return;
            }

            lock (_dbLock)
            {
                ThrowIfDisposed();
                _connection.Execute("CREATE TEMP TABLE IF NOT EXISTS _valid_items (ItemId TEXT PRIMARY KEY)");
                _connection.Execute("DELETE FROM _valid_items");
            }

            int total = validItemIds.Count;

            for (int offset = 0; offset < total; offset += chunkSize)
            {
                cancellationToken.ThrowIfCancellationRequested();

                int end = Math.Min(offset + chunkSize, total);

                lock (_dbLock)
                {
                    ThrowIfDisposed();
                    _connection.Execute("BEGIN TRANSACTION");
                    try
                    {
                        using (var stmt = _connection.PrepareStatement(
                            "INSERT OR IGNORE INTO _valid_items VALUES (@id)"))
                        {
                            for (int i = offset; i < end; i++)
                            {
                                stmt.Reset();
                                stmt.ClearBindings();
                                TryBind(stmt, "@id", validItemIds[i]);
                                stmt.MoveNext();
                            }
                        }
                        _connection.Execute("COMMIT");
                    }
                    catch (OperationCanceledException)
                    {
                        _logger.Info("SegmentRepository: RemoveOrphanedRows cancelled at chunk offset {0}, rolling back", offset);
                        _connection.Execute("ROLLBACK");
                        DropValidItemsTableUnlocked();
                        throw;
                    }
                    catch (Exception ex)
                    {
                        _logger.ErrorException("SegmentRepository: RemoveOrphanedRows insert failed at chunk offset " + offset, ex);
                        _connection.Execute("ROLLBACK");
                        DropValidItemsTableUnlocked();
                        throw;
                    }
                }
            }

            lock (_dbLock)
            {
                ThrowIfDisposed();
                var deleted = 0;
                using (var stmt = _connection.PrepareStatement(
                    "SELECT COUNT(*) FROM MediaSegments WHERE ItemId NOT IN (SELECT ItemId FROM _valid_items)"))
                {
                    if (stmt.MoveNext())
                    {
                        deleted = stmt.Current.GetInt(0);
                    }
                }

                if (deleted > 0)
                {
                    _connection.Execute(
                        "DELETE FROM MediaSegments WHERE ItemId NOT IN (SELECT ItemId FROM _valid_items)");
                    _logger.Info("SegmentRepository: Removed {0} orphaned rows", deleted);
                }

                _connection.Execute("DROP TABLE IF EXISTS _valid_items");
            }
        }

        private void DropValidItemsTable()
        {
            lock (_dbLock)
            {
                DropValidItemsTableUnlocked();
            }
        }

        private void DropValidItemsTableUnlocked()
        {
            try
            {
                _connection.Execute("DROP TABLE IF EXISTS _valid_items");
            }
            catch (Exception ex)
            {
                _logger.ErrorException("SegmentRepository: Failed to drop _valid_items temp table", ex);
            }
        }

        public void DeleteAllData()
        {
            lock (_dbLock)
            {
                ThrowIfDisposed();
                _logger.Info("SegmentRepository: Dropping and recreating MediaSegments table");
                _connection.Execute("DROP TABLE IF EXISTS MediaSegments");
                _connection.Execute("DROP TABLE IF EXISTS SyncStatus");
                InitializeUnlocked();
            }
        }

        #endregion

        #region Sync Status

        public void UpdateSyncStatus(int itemsScanned, int durationMs)
        {
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(
                    "INSERT OR REPLACE INTO SyncStatus (Id, LastFullSync, ItemsScanned, SyncDuration) " +
                    "VALUES (1, @LastFullSync, @ItemsScanned, @SyncDuration)"))
                {
                    TryBindDateTime(stmt, "@LastFullSync", DateTime.UtcNow);
                    TryBind(stmt, "@ItemsScanned", itemsScanned);
                    TryBind(stmt, "@SyncDuration", durationMs);
                    stmt.MoveNext();
                }
            }
        }

        public SyncStatusInfo GetSyncStatus()
        {
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(
                    "SELECT LastFullSync, ItemsScanned, SyncDuration FROM SyncStatus WHERE Id = 1"))
                {
                    if (stmt.MoveNext())
                    {
                        var row = stmt.Current;
                        return new SyncStatusInfo
                        {
                            LastFullSync = ReadDateTime(row, 0),
                            ItemsScanned = ReadInt(row, 1),
                            SyncDuration = ReadInt(row, 2)
                        };
                    }
                }
            }
            return null;
        }

        #endregion

        #region Admin

        public void VacuumDatabase()
        {
            lock (_dbLock)
            {
                ThrowIfDisposed();
                _logger.Info("SegmentRepository: Running VACUUM");
                _connection.Execute("VACUUM");
            }
        }

        public int GetRowCount()
        {
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement("SELECT COUNT(*) FROM MediaSegments"))
                {
                    if (stmt.MoveNext())
                    {
                        return stmt.Current.GetInt(0);
                    }
                }
            }
            return 0;
        }

        private static readonly HashSet<string> _allowedPragmas = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "table_info", "table_list", "table_xinfo",
            "database_list", "index_list", "index_info",
            "foreign_key_list", "compile_options", "integrity_check"
        };

        private static bool ContainsDangerousKeyword(string sql)
        {
            if (sql.Contains(";"))
            {
                return true;
            }

            var upper = sql.ToUpperInvariant();

            // Word-boundary check: keyword must be preceded/followed by non-letter
            foreach (var keyword in new[] { "ATTACH", "LOAD_EXTENSION" })
            {
                int idx = 0;
                while ((idx = upper.IndexOf(keyword, idx, StringComparison.Ordinal)) >= 0)
                {
                    bool startOk = idx == 0 || !char.IsLetterOrDigit(upper[idx - 1]);
                    int end = idx + keyword.Length;
                    bool endOk = end >= upper.Length || !char.IsLetterOrDigit(upper[end]);
                    if (startOk && endOk)
                    {
                        return true;
                    }
                    idx = end;
                }
            }

            return false;
        }

        private static bool IsAllowedPragma(string trimmedSql)
        {
            // Extract pragma name from "PRAGMA [schema.]name" or "PRAGMA [schema.]name(...)"
            var afterPragma = trimmedSql.Substring(6).TrimStart();

            // Remove optional schema prefix (e.g., "main.")
            var dotIdx = afterPragma.IndexOf('.');
            var parenIdx = afterPragma.IndexOf('(');
            if (dotIdx >= 0 && (parenIdx < 0 || dotIdx < parenIdx))
            {
                afterPragma = afterPragma.Substring(dotIdx + 1);
            }

            // Pragma name ends at '(', '=', space, or end of string
            var nameEnd = afterPragma.IndexOfAny(_pragmaNameDelimiters);
            var pragmaName = nameEnd >= 0 ? afterPragma.Substring(0, nameEnd) : afterPragma;
            pragmaName = pragmaName.Trim();

            return _allowedPragmas.Contains(pragmaName);
        }

        public QueryResult RunCustomQuery(string sql)
        {
            if (string.IsNullOrWhiteSpace(sql))
            {
                return new QueryResult
                {
                    Columns = new List<string>(),
                    Rows = new List<List<string>>(),
                    Message = "Empty query"
                };
            }

            var trimmed = sql.TrimStart();
            var firstWord = trimmed.Split(_whitespaceDelimiters, 2)[0].ToUpperInvariant();
            if (firstWord != "SELECT" && firstWord != "PRAGMA" && firstWord != "EXPLAIN")
            {
                return new QueryResult
                {
                    Columns = new List<string>(),
                    Rows = new List<List<string>>(),
                    Message = "Error: Only SELECT, PRAGMA, and EXPLAIN queries are allowed"
                };
            }

            if (ContainsDangerousKeyword(trimmed))
            {
                return new QueryResult
                {
                    Columns = new List<string>(),
                    Rows = new List<List<string>>(),
                    Message = "Error: Query contains disallowed keywords (semicolons, ATTACH, or load_extension)"
                };
            }

            if (firstWord == "PRAGMA" && !IsAllowedPragma(trimmed))
            {
                return new QueryResult
                {
                    Columns = new List<string>(),
                    Rows = new List<List<string>>(),
                    Message = "Error: Only read-only PRAGMAs are allowed: " + string.Join(", ", _allowedPragmas)
                };
            }

            var result = new QueryResult
            {
                Columns = new List<string>(),
                Rows = new List<List<string>>()
            };

            try
            {
                lock (_dbLock)
                {
                    ThrowIfDisposed();
                    using (var stmt = _connection.PrepareStatement(sql))
                    {
                        var colCount = stmt.Columns.Count;

                        for (int i = 0; i < colCount; i++)
                        {
                            result.Columns.Add(stmt.Columns[i].Name);
                        }

                        while (stmt.MoveNext())
                        {
                            var row = stmt.Current;
                            var rowData = new List<string>();
                            for (int i = 0; i < colCount; i++)
                            {
                                rowData.Add(row.IsDBNull(i) ? null : row.GetString(i));
                            }
                            result.Rows.Add(rowData);
                        }
                    }
                }

                result.Message = result.Rows.Count + " row(s) returned";
            }
            catch (Exception ex)
            {
                _logger.ErrorException("RunCustomQuery failed for: " + sql, ex);
                result.Message = "Error: " + ex.Message;
            }

            return result;
        }

        private static readonly HashSet<string> _distinctValueFields = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "ItemType", "SeriesName", "LibraryName"
        };

        public List<string> GetDistinctValues(string field)
        {
            if (!_distinctValueFields.Contains(field))
            {
                return null;
            }

            var values = new List<string>();

            // Resolve to exact casing to avoid SQL injection
            string safeField = null;
            foreach (var f in _distinctValueFields)
            {
                if (string.Equals(f, field, StringComparison.OrdinalIgnoreCase))
                {
                    safeField = f;
                    break;
                }
            }

            if (safeField == null)
            {
                return values;
            }

            var sql = "SELECT DISTINCT " + safeField + " FROM MediaSegments WHERE " + safeField + " IS NOT NULL AND " + safeField + " != '' ORDER BY " + safeField;

            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(sql))
                {
                    while (stmt.MoveNext())
                    {
                        var row = stmt.Current;
                        if (!row.IsDBNull(0))
                        {
                            values.Add(row.GetString(0));
                        }
                    }
                }
            }

            return values;
        }

        #endregion

        #region User Preferences

        public Dictionary<string, string> GetAllPreferences()
        {
            var prefs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement("SELECT [Key], [Value] FROM UserPreferences"))
                {
                    while (stmt.MoveNext())
                    {
                        var row = stmt.Current;
                        prefs[ReadString(row, 0)] = ReadString(row, 1);
                    }
                }
            }
            return prefs;
        }

        public void SetPreference(string key, string value)
        {
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(
                    "INSERT OR REPLACE INTO UserPreferences ([Key], [Value]) VALUES (@Key, @Value)"))
                {
                    TryBind(stmt, "@Key", key);
                    TryBind(stmt, "@Value", value);
                    stmt.MoveNext();
                }
            }
        }

        #endregion

        #region Saved Queries

        public List<Dictionary<string, object>> GetSavedQueries()
        {
            var results = new List<Dictionary<string, object>>();
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(
                    "SELECT Id, QueryName, QuerySql, CreatedDate FROM SavedQueries ORDER BY QueryName"))
                {
                    while (stmt.MoveNext())
                    {
                        var row = stmt.Current;
                        results.Add(new Dictionary<string, object>
                        {
                            { "id", ReadInt(row, 0) },
                            { "name", ReadString(row, 1) },
                            { "sql", ReadString(row, 2) },
                            { "createdDate", ReadString(row, 3) }
                        });
                    }
                }
            }
            return results;
        }

        public long AddSavedQuery(string name, string sql)
        {
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(
                    "INSERT INTO SavedQueries (QueryName, QuerySql) VALUES (@Name, @Sql)"))
                {
                    TryBind(stmt, "@Name", name);
                    TryBind(stmt, "@Sql", sql);
                    stmt.MoveNext();
                }

                using (var stmt = _connection.PrepareStatement("SELECT last_insert_rowid()"))
                {
                    if (stmt.MoveNext())
                    {
                        return stmt.Current.GetInt64(0);
                    }
                }

                return 0;
            }
        }

        public void UpdateSavedQuery(long id, string name, string sql)
        {
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(
                    "UPDATE SavedQueries SET QueryName = @Name, QuerySql = @Sql WHERE Id = @Id"))
                {
                    TryBind(stmt, "@Id", id);
                    TryBind(stmt, "@Name", name);
                    TryBind(stmt, "@Sql", sql);
                    stmt.MoveNext();
                }
            }
        }

        public void DeleteSavedQuery(long id)
        {
            lock (_dbLock)
            {
                ThrowIfDisposed();
                using (var stmt = _connection.PrepareStatement(
                    "DELETE FROM SavedQueries WHERE Id = @Id"))
                {
                    TryBind(stmt, "@Id", id);
                    stmt.MoveNext();
                }
            }
        }

        #endregion

        public void Dispose()
        {
            lock (_dbLock)
            {
                if (_disposed)
                    return;

                _disposed = true;
                _connection?.Dispose();
            }

            lock (_instanceLock)
            {
#pragma warning disable IDISP003 // Dispose previous before re-assigning - clearing singleton reference, instance already disposed above
                if (_instance == this)
                {
                    _instance = null;
                }
#pragma warning restore IDISP003
            }
        }
    }
}
