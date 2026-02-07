using System;
using System.Collections.Generic;
using System.Globalization;
using MediaBrowser.Model.Logging;
using SQLitePCL.pretty;

namespace segment_reporting.Data
{
    public class SegmentRepository
    {
        private static SegmentRepository _instance;
        private static readonly object _instanceLock = new object();

        private readonly IDatabaseConnection _connection;
        private readonly object _dbLock = new object();
        private readonly ILogger _logger;
        private readonly string _dbPath;

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
        }

        public static SegmentRepository GetInstance(string dbPath, ILogger logger)
        {
            lock (_instanceLock)
            {
                if (_instance == null)
                {
                    _instance = new SegmentRepository(dbPath, logger);
                }
                return _instance;
            }
        }

        private IDatabaseConnection CreateConnection()
        {
            var flags = ConnectionFlags.Create | ConnectionFlags.ReadWrite |
                        ConnectionFlags.PrivateCache | ConnectionFlags.NoMutex;

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
                    "HasCredits INT, " +
                    "LastSyncDate DATETIME)");

                _connection.Execute(
                    "CREATE TABLE IF NOT EXISTS SyncStatus (" +
                    "Id INTEGER PRIMARY KEY, " +
                    "LastFullSync DATETIME, " +
                    "ItemsScanned INT, " +
                    "SyncDuration INT)");

                CheckMigration();

                _connection.Execute("CREATE INDEX IF NOT EXISTS idx_segments_library ON MediaSegments(LibraryId)");
                _connection.Execute("CREATE INDEX IF NOT EXISTS idx_segments_series ON MediaSegments(SeriesId)");
                _connection.Execute("CREATE INDEX IF NOT EXISTS idx_segments_season ON MediaSegments(SeasonId)");
                _connection.Execute("CREATE INDEX IF NOT EXISTS idx_segments_missing ON MediaSegments(HasIntro, HasCredits)");
                _connection.Execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_segments_itemid ON MediaSegments(ItemId)");

                _logger.Info("SegmentRepository: Database initialized");
            }
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
                { "HasCredits", "INT DEFAULT 0" },
                { "LastSyncDate", "DATETIME" }
            };

            foreach (var col in requiredColumns)
            {
                if (!existingColumns.Contains(col.Key))
                {
                    _logger.Info("SegmentRepository: Adding column {0}", col.Key);
                    _connection.Execute("ALTER TABLE MediaSegments ADD COLUMN " + col.Key + " " + col.Value);
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
                HasCredits = ReadInt(row, 16),
                LastSyncDate = ReadDateTime(row, 17)
            };
        }

        #endregion

        #region Upsert

        public void UpsertSegment(SegmentInfo segment)
        {
            lock (_dbLock)
            {
                UpsertSegmentInternal(segment);
            }
        }

        public void UpsertSegments(List<SegmentInfo> segments)
        {
            lock (_dbLock)
            {
                _connection.Execute("BEGIN TRANSACTION");
                try
                {
                    foreach (var segment in segments)
                    {
                        UpsertSegmentInternal(segment);
                    }
                    _connection.Execute("COMMIT");
                }
                catch (Exception ex)
                {
                    _logger.ErrorException("SegmentRepository: UpsertSegments failed, rolling back", ex);
                    _connection.Execute("ROLLBACK");
                    throw;
                }
            }
        }

        private void UpsertSegmentInternal(SegmentInfo segment)
        {
            bool exists = false;
            using (var stmt = _connection.PrepareStatement(
                "SELECT COUNT(*) FROM MediaSegments WHERE ItemId = @ItemId"))
            {
                TryBind(stmt, "@ItemId", segment.ItemId);
                if (stmt.MoveNext())
                {
                    exists = stmt.Current.GetInt(0) > 0;
                }
            }

            if (exists)
            {
                using (var stmt = _connection.PrepareStatement(
                    "UPDATE MediaSegments SET " +
                    "ItemName = @ItemName, ItemType = @ItemType, " +
                    "SeriesName = @SeriesName, SeriesId = @SeriesId, " +
                    "SeasonName = @SeasonName, SeasonId = @SeasonId, " +
                    "SeasonNumber = @SeasonNumber, EpisodeNumber = @EpisodeNumber, " +
                    "LibraryName = @LibraryName, LibraryId = @LibraryId, " +
                    "IntroStartTicks = @IntroStartTicks, IntroEndTicks = @IntroEndTicks, " +
                    "CreditsStartTicks = @CreditsStartTicks, " +
                    "HasIntro = @HasIntro, HasCredits = @HasCredits, " +
                    "LastSyncDate = @LastSyncDate " +
                    "WHERE ItemId = @ItemId"))
                {
                    BindSegmentParams(stmt, segment);
                    stmt.MoveNext();
                }
            }
            else
            {
                using (var stmt = _connection.PrepareStatement(
                    "INSERT INTO MediaSegments " +
                    "(ItemId, ItemName, ItemType, SeriesName, SeriesId, " +
                    "SeasonName, SeasonId, SeasonNumber, EpisodeNumber, " +
                    "LibraryName, LibraryId, IntroStartTicks, IntroEndTicks, " +
                    "CreditsStartTicks, HasIntro, HasCredits, LastSyncDate) " +
                    "VALUES " +
                    "(@ItemId, @ItemName, @ItemType, @SeriesName, @SeriesId, " +
                    "@SeasonName, @SeasonId, @SeasonNumber, @EpisodeNumber, " +
                    "@LibraryName, @LibraryId, @IntroStartTicks, @IntroEndTicks, " +
                    "@CreditsStartTicks, @HasIntro, @HasCredits, @LastSyncDate)"))
                {
                    BindSegmentParams(stmt, segment);
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
            TryBindDateTime(stmt, "@LastSyncDate", segment.LastSyncDate);
        }

        #endregion

        #region Reporting Queries

        public List<LibrarySummaryItem> GetLibrarySummary()
        {
            var results = new List<LibrarySummaryItem>();
            lock (_dbLock)
            {
                using (var stmt = _connection.PrepareStatement(
                    "SELECT LibraryId, LibraryName, " +
                    "COUNT(*) as TotalItems, " +
                    "SUM(HasIntro) as WithIntro, " +
                    "SUM(HasCredits) as WithCredits, " +
                    "SUM(CASE WHEN HasIntro = 1 AND HasCredits = 1 THEN 1 ELSE 0 END) as WithBoth, " +
                    "SUM(CASE WHEN HasIntro = 0 AND HasCredits = 0 THEN 1 ELSE 0 END) as WithNeither " +
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
                            WithNeither = ReadInt(row, 6)
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

            if (filters != null)
            {
                foreach (var filter in filters)
                {
                    if (string.Equals(filter, "missing_intro", StringComparison.OrdinalIgnoreCase))
                        whereClauses.Add("HasIntro = 0");
                    else if (string.Equals(filter, "missing_credits", StringComparison.OrdinalIgnoreCase))
                        whereClauses.Add("HasCredits = 0");
                }
            }

            var sql = "SELECT SeriesId, SeriesName, " +
                      "COUNT(*) as TotalEpisodes, " +
                      "SUM(HasIntro) as WithIntro, " +
                      "SUM(HasCredits) as WithCredits " +
                      "FROM MediaSegments " +
                      "WHERE " + string.Join(" AND ", whereClauses) + " " +
                      "GROUP BY SeriesId, SeriesName " +
                      "ORDER BY SeriesName";

            lock (_dbLock)
            {
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

        public List<SeasonListItem> GetSeasonList(string seriesId)
        {
            var results = new List<SeasonListItem>();
            lock (_dbLock)
            {
                using (var stmt = _connection.PrepareStatement(
                    "SELECT SeasonId, SeasonName, SeasonNumber, " +
                    "COUNT(*) as TotalEpisodes, " +
                    "SUM(HasIntro) as WithIntro, " +
                    "SUM(HasCredits) as WithCredits " +
                    "FROM MediaSegments " +
                    "WHERE SeriesId = @SeriesId " +
                    "GROUP BY SeasonId, SeasonName, SeasonNumber " +
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
                            TotalEpisodes = ReadInt(row, 3),
                            WithIntro = ReadInt(row, 4),
                            WithCredits = ReadInt(row, 5)
                        });
                    }
                }
            }
            return results;
        }

        public List<SegmentInfo> GetEpisodeList(string seasonId)
        {
            var results = new List<SegmentInfo>();
            lock (_dbLock)
            {
                using (var stmt = _connection.PrepareStatement(
                    "SELECT * FROM MediaSegments " +
                    "WHERE SeasonId = @SeasonId " +
                    "ORDER BY EpisodeNumber"))
                {
                    TryBind(stmt, "@SeasonId", seasonId);
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

        public List<SegmentInfo> GetItemsByLibrary(string libraryId, string itemType, string search, string[] filters)
        {
            var results = new List<SegmentInfo>();
            var whereClauses = new List<string> { "LibraryId = @LibraryId" };

            if (!string.IsNullOrEmpty(itemType))
            {
                whereClauses.Add("ItemType = @ItemType");
            }

            if (!string.IsNullOrWhiteSpace(search))
            {
                whereClauses.Add("ItemName LIKE @Search");
            }

            if (filters != null)
            {
                foreach (var filter in filters)
                {
                    if (string.Equals(filter, "missing_intro", StringComparison.OrdinalIgnoreCase))
                        whereClauses.Add("HasIntro = 0");
                    else if (string.Equals(filter, "missing_credits", StringComparison.OrdinalIgnoreCase))
                        whereClauses.Add("HasCredits = 0");
                }
            }

            var sql = "SELECT * FROM MediaSegments " +
                      "WHERE " + string.Join(" AND ", whereClauses) + " " +
                      "ORDER BY ItemName";

            lock (_dbLock)
            {
                using (var stmt = _connection.PrepareStatement(sql))
                {
                    TryBind(stmt, "@LibraryId", libraryId);
                    if (!string.IsNullOrEmpty(itemType))
                        TryBind(stmt, "@ItemType", itemType);
                    if (!string.IsNullOrWhiteSpace(search))
                        TryBind(stmt, "@Search", "%" + search + "%");

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
            string column;
            string hasColumn;

            switch (markerType)
            {
                case "IntroStart":
                    column = "IntroStartTicks";
                    hasColumn = null;
                    break;
                case "IntroEnd":
                    column = "IntroEndTicks";
                    hasColumn = null;
                    break;
                case "CreditsStart":
                    column = "CreditsStartTicks";
                    hasColumn = "HasCredits";
                    break;
                default:
                    _logger.Warn("SegmentRepository: Unknown marker type {0}", markerType);
                    return;
            }

            lock (_dbLock)
            {
                var sql = "UPDATE MediaSegments SET " + column + " = NULL";

                if (markerType == "IntroStart" || markerType == "IntroEnd")
                {
                    sql += ", HasIntro = CASE WHEN " +
                           (markerType == "IntroStart" ? "IntroEndTicks" : "IntroStartTicks") +
                           " IS NOT NULL THEN 1 ELSE 0 END";
                }
                else if (hasColumn != null)
                {
                    sql += ", " + hasColumn + " = 0";
                }

                sql += " WHERE ItemId = @ItemId";

                using (var stmt = _connection.PrepareStatement(sql))
                {
                    TryBind(stmt, "@ItemId", itemId);
                    stmt.MoveNext();
                }
            }
        }

        public void RemoveOrphanedRows(List<string> validItemIds)
        {
            if (validItemIds == null || validItemIds.Count == 0)
            {
                return;
            }

            lock (_dbLock)
            {
                _connection.Execute("CREATE TEMP TABLE IF NOT EXISTS _valid_items (ItemId TEXT PRIMARY KEY)");
                _connection.Execute("DELETE FROM _valid_items");

                _connection.Execute("BEGIN TRANSACTION");
                try
                {
                    using (var stmt = _connection.PrepareStatement(
                        "INSERT OR IGNORE INTO _valid_items VALUES (@id)"))
                    {
                        foreach (var id in validItemIds)
                        {
                            stmt.Reset();
                            stmt.ClearBindings();
                            TryBind(stmt, "@id", id);
                            stmt.MoveNext();
                        }
                    }
                    _connection.Execute("COMMIT");
                }
                catch (Exception ex)
                {
                    _logger.ErrorException("SegmentRepository: RemoveOrphanedRows insert failed", ex);
                    _connection.Execute("ROLLBACK");
                    _connection.Execute("DROP TABLE IF EXISTS _valid_items");
                    throw;
                }

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

        public void DeleteAllData()
        {
            lock (_dbLock)
            {
                _logger.Info("SegmentRepository: Dropping and recreating MediaSegments table");
                _connection.Execute("DROP TABLE IF EXISTS MediaSegments");
                _connection.Execute("DROP TABLE IF EXISTS SyncStatus");
                Initialize();
            }
        }

        #endregion

        #region Sync Status

        public void UpdateSyncStatus(int itemsScanned, int durationMs)
        {
            lock (_dbLock)
            {
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
                _logger.Info("SegmentRepository: Running VACUUM");
                _connection.Execute("VACUUM");
            }
        }

        public int GetRowCount()
        {
            lock (_dbLock)
            {
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
            var firstWord = trimmed.Split(new[] { ' ', '\t', '\n', '\r' }, 2)[0].ToUpperInvariant();
            if (firstWord != "SELECT" && firstWord != "PRAGMA" && firstWord != "EXPLAIN")
            {
                return new QueryResult
                {
                    Columns = new List<string>(),
                    Rows = new List<List<string>>(),
                    Message = "Only SELECT, PRAGMA, and EXPLAIN queries are allowed"
                };
            }

            var result = new QueryResult
            {
                Columns = new List<string>(),
                Rows = new List<List<string>>()
            };

            lock (_dbLock)
            {
                try
                {
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

                    result.Message = result.Rows.Count + " row(s) returned";
                }
                catch (Exception ex)
                {
                    result.Message = "Error: " + ex.Message;
                }
            }

            return result;
        }

        #endregion
    }
}
