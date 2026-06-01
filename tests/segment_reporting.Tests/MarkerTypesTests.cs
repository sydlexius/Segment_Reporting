using System;
using segment_reporting.Data;
using Xunit;

namespace segment_reporting.Tests
{
    public class MarkerTypesTests
    {
        [Theory]
        [InlineData("IntroStart", "IntroStartTicks")]
        [InlineData("IntroEnd", "IntroEndTicks")]
        [InlineData("CreditsStart", "CreditsStartTicks")]
        [InlineData("introstart", "IntroStartTicks")]
        public void GetColumnName_NormalizesAndAppendsTicks_ForValidTypes(string markerType, string expected)
        {
            Assert.Equal(expected, MarkerTypes.GetColumnName(markerType));
        }

        [Fact]
        public void GetColumnName_Throws_ForUnknownType()
        {
            Assert.Throws<ArgumentException>(() => MarkerTypes.GetColumnName("NotAMarker"));
        }

        [Theory]
        [InlineData("IntroStart", true)]
        [InlineData("IntroEnd", true)]
        [InlineData("introstart", true)]
        [InlineData("CreditsStart", false)]
        [InlineData("Bogus", false)]
        public void IsIntroType_RecognizesIntroMarkers(string markerType, bool expected)
        {
            Assert.Equal(expected, MarkerTypes.IsIntroType(markerType));
        }
    }
}
