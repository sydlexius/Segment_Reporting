using System;
using System.Collections.Generic;
using System.IO;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Drawing;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace segment_reporting
{
    public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages, IHasThumbImage
    {
        public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
            : base(applicationPaths, xmlSerializer)
        {
            Instance = this;
        }

        public static Plugin Instance { get; private set; }

        public override string Name => "Segment Reporting";

        public override string Description => "Caches and reports on media segment markers (Intros, Credits) with interactive charts, inline editing, and bulk management.";

        private Guid _id = new Guid("e921fa9a-8b1c-4d5e-9f2a-3c7b6d8e4a1f");
        public override Guid Id => _id;

        public Stream GetThumbImage()
        {
            var type = GetType();
            return type.Assembly.GetManifestResourceStream(type.Namespace + ".thumb.png");
        }

        public ImageFormat ThumbImageFormat => ImageFormat.Png;

        public IEnumerable<PluginPageInfo> GetPages()
        {
            return new[]
            {
                new PluginPageInfo
                {
                    Name = "segment_dashboard",
                    EmbeddedResourcePath = GetType().Namespace + ".Pages.segment_dashboard.html",
                    EnableInMainMenu = true,
                    MenuSection = "server",
                    MenuIcon = "assessment",
                    DisplayName = "Segment Reporting"
                },
                new PluginPageInfo
                {
                    Name = "segment_library",
                    EmbeddedResourcePath = GetType().Namespace + ".Pages.segment_library.html"
                },
                new PluginPageInfo
                {
                    Name = "segment_series",
                    EmbeddedResourcePath = GetType().Namespace + ".Pages.segment_series.html"
                },
                new PluginPageInfo
                {
                    Name = "segment_settings",
                    EmbeddedResourcePath = GetType().Namespace + ".Pages.segment_settings.html"
                },
                new PluginPageInfo
                {
                    Name = "segment_custom_query",
                    EmbeddedResourcePath = GetType().Namespace + ".Pages.segment_custom_query.html"
                },
                new PluginPageInfo
                {
                    Name = "segment_dashboard.js",
                    EmbeddedResourcePath = GetType().Namespace + ".Pages.segment_dashboard.js"
                },
                new PluginPageInfo
                {
                    Name = "segment_library.js",
                    EmbeddedResourcePath = GetType().Namespace + ".Pages.segment_library.js"
                },
                new PluginPageInfo
                {
                    Name = "segment_series.js",
                    EmbeddedResourcePath = GetType().Namespace + ".Pages.segment_series.js"
                },
                new PluginPageInfo
                {
                    Name = "segment_settings.js",
                    EmbeddedResourcePath = GetType().Namespace + ".Pages.segment_settings.js"
                },
                new PluginPageInfo
                {
                    Name = "segment_custom_query.js",
                    EmbeddedResourcePath = GetType().Namespace + ".Pages.segment_custom_query.js"
                },
                new PluginPageInfo
                {
                    Name = "helper_function.js",
                    EmbeddedResourcePath = GetType().Namespace + ".Pages.helper_function.js"
                },
                new PluginPageInfo
                {
                    Name = "chart.min.js",
                    EmbeddedResourcePath = GetType().Namespace + ".Pages.chart.min.js"
                }
            };
        }
    }
}
