namespace segment_reporting
{
    public class SegmentReportingOptions
    {
        public SegmentReportingOptions()
        {
            TimeFormat = "HH:MM:SS.fff";
            ChartColorPalette = new[] { "#4285F4", "#EA4335", "#FBBC04", "#34A853", "#FF6D00", "#46BDC6" };
        }

        public string TimeFormat { get; set; }
        public string[] ChartColorPalette { get; set; }
    }
}
