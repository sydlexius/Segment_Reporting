using segment_reporting.Data;
using Xunit;

namespace segment_reporting.Tests
{
    // Exercises the custom-query security boundary in isolation. These are the
    // gate that protects the user-facing SQL console: only read-only SELECT /
    // PRAGMA / EXPLAIN may run, with no statement chaining or extension loading.
    public class CustomQueryValidationTests
    {
        [Theory]
        [InlineData("SELECT * FROM MediaSegments")]
        [InlineData("SELECT IntroStartTicks FROM MediaSegments WHERE ItemType = 'Episode'")]
        [InlineData("SELECT * FROM attachments")]
        [InlineData("EXPLAIN QUERY PLAN SELECT 1")]
        public void ContainsDangerousKeyword_AllowsSafeQueries(string sql)
        {
            Assert.False(SegmentRepository.ContainsDangerousKeyword(sql));
        }

        [Theory]
        [InlineData("SELECT 1; DROP TABLE MediaSegments")]
        [InlineData("ATTACH DATABASE 'evil.db' AS evil")]
        [InlineData("SELECT load_extension('x.so')")]
        [InlineData("SELECT * FROM t WHERE x = load_extension('a')")]
        public void ContainsDangerousKeyword_BlocksChainingAndExtensions(string sql)
        {
            Assert.True(SegmentRepository.ContainsDangerousKeyword(sql));
        }

        [Theory]
        [InlineData("PRAGMA table_info(MediaSegments)")]
        [InlineData("PRAGMA main.table_info(MediaSegments)")]
        [InlineData("PRAGMA integrity_check")]
        [InlineData("pragma Table_Info(MediaSegments)")]
        public void IsAllowedPragma_AllowsReadOnlyPragmas(string sql)
        {
            Assert.True(SegmentRepository.IsAllowedPragma(sql));
        }

        [Theory]
        [InlineData("PRAGMA user_version")]
        [InlineData("PRAGMA writable_schema = ON")]
        [InlineData("PRAGMA journal_mode = WAL")]
        public void IsAllowedPragma_RejectsWritableAndUnknownPragmas(string sql)
        {
            Assert.False(SegmentRepository.IsAllowedPragma(sql));
        }
    }
}
