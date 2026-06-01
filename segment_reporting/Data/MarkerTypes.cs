using System;
using System.Collections.Generic;

namespace segment_reporting.Data
{
    public static class MarkerTypes
    {
        public const string IntroStart = "IntroStart";
        public const string IntroEnd = "IntroEnd";
        public const string CreditsStart = "CreditsStart";

        public static readonly HashSet<string> Valid = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            IntroStart, IntroEnd, CreditsStart
        };

        public static string GetColumnName(string markerType)
        {
            // Normalize to the canonical constant so the column name is stable
            // regardless of the caller's casing (e.g. "introstart" -> "IntroStartTicks").
            if (string.Equals(markerType, IntroStart, StringComparison.OrdinalIgnoreCase))
            {
                return IntroStart + "Ticks";
            }
            if (string.Equals(markerType, IntroEnd, StringComparison.OrdinalIgnoreCase))
            {
                return IntroEnd + "Ticks";
            }
            if (string.Equals(markerType, CreditsStart, StringComparison.OrdinalIgnoreCase))
            {
                return CreditsStart + "Ticks";
            }
            throw new ArgumentException("Unknown marker type: " + markerType, nameof(markerType));
        }

        public static bool IsIntroType(string markerType)
        {
            return string.Equals(markerType, IntroStart, StringComparison.OrdinalIgnoreCase)
                || string.Equals(markerType, IntroEnd, StringComparison.OrdinalIgnoreCase);
        }
    }
}
