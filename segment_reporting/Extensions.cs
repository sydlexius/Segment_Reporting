using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Serialization;
using System.Collections.Generic;
using System.IO;

namespace segment_reporting
{
    public class SegmentReportingConfigurationFactory : IConfigurationFactory
    {
        private readonly IXmlSerializer _xmlSerializer;

        public SegmentReportingConfigurationFactory(IXmlSerializer xmlSerializer)
        {
            _xmlSerializer = xmlSerializer;
        }

        public IEnumerable<ConfigurationStore> GetConfigurations()
        {
            return new[]
            {
                new ConfigurationStore
                {
                    Key = "segment_reporting",
                    ConfigurationType = typeof(SegmentReportingOptions)
                }
            };
        }
    }

    public static class Extensions
    {
        public static SegmentReportingOptions GetSegmentReportingOptions(this IConfigurationManager configurationManager)
        {
            return configurationManager.GetConfiguration<SegmentReportingOptions>("segment_reporting");
        }

        public static void SaveSegmentReportingOptions(this IConfigurationManager configurationManager, SegmentReportingOptions options)
        {
            configurationManager.SaveConfiguration("segment_reporting", options);
        }
    }
}
