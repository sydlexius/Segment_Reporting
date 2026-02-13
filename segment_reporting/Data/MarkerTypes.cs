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
            if (!Valid.Contains(markerType))
            {
                throw new ArgumentException("Unknown marker type: " + markerType, nameof(markerType));
            }
            return markerType + "Ticks";
        }

        public static bool IsIntroType(string markerType)
        {
            return string.Equals(markerType, IntroStart, StringComparison.OrdinalIgnoreCase)
                || string.Equals(markerType, IntroEnd, StringComparison.OrdinalIgnoreCase);
        }
    }
}
