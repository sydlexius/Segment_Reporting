using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
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
            var ns = GetType().Namespace;
            var tag = GetCacheTag();

            var pages = new List<PluginPageInfo>
            {
                // HTML pages — stable, unversioned names (entry points for navigation)
                new PluginPageInfo
                {
                    Name = "segment_dashboard",
                    EmbeddedResourcePath = ns + ".Pages.segment_dashboard.html",
                    EnableInMainMenu = true,
                    MenuSection = "server",
                    MenuIcon = "assessment",
                    DisplayName = "Segment Reporting"
                },
                new PluginPageInfo { Name = "segment_library", EmbeddedResourcePath = ns + ".Pages.segment_library.html" },
                new PluginPageInfo { Name = "segment_series", EmbeddedResourcePath = ns + ".Pages.segment_series.html" },
                new PluginPageInfo { Name = "segment_settings", EmbeddedResourcePath = ns + ".Pages.segment_settings.html" },
                new PluginPageInfo { Name = "segment_custom_query", EmbeddedResourcePath = ns + ".Pages.segment_custom_query.html" },
                new PluginPageInfo { Name = "segment_about", EmbeddedResourcePath = ns + ".Pages.segment_about.html" }
            };

            // JS resources — register both unversioned (dev/fallback) and versioned (cache-busted release builds).
            // The build script patches HTML data-controller attrs and JS getConfigurationResourceUrl() calls
            // to reference versioned names. The unversioned name remains for dev builds and cached-HTML compat.
            var jsFiles = new[]
            {
                "segment_dashboard.js",
                "segment_library.js",
                "segment_series.js",
                "segment_settings.js",
                "segment_custom_query.js",
                "segment_about.js",
                "segment_reporting_helpers.js",
                "segment_reporting_chart.min.js"
            };

            foreach (var js in jsFiles)
            {
                var resourcePath = ns + ".Pages." + js;

                // Unversioned name (always registered — used by dev builds and as fallback for cached HTML)
                pages.Add(new PluginPageInfo { Name = js, EmbeddedResourcePath = resourcePath });

                // Versioned name (used by release builds where HTML/JS are patched with the cache tag)
                var versioned = VersionedJsName(js, tag);
                if (versioned != js)
                {
                    pages.Add(new PluginPageInfo { Name = versioned, EmbeddedResourcePath = resourcePath });
                }
            }

            return pages;
        }

        /// <summary>
        /// Cache tag derived from the assembly version, e.g. "v1_0_0_0".
        /// Must match the format produced by scripts/build-js.mjs cacheTag().
        /// </summary>
        private string GetCacheTag()
        {
            var v = GetType().Assembly.GetName().Version;
            return string.Format("v{0}_{1}_{2}_{3}", v.Major, v.Minor, v.Build, v.Revision);
        }

        /// <summary>
        /// Insert a version tag before the .js extension.
        /// "segment_dashboard.js" + "v1_0_0_0" → "segment_dashboard.v1_0_0_0.js"
        /// "segment_reporting_chart.min.js" + "v1_0_0_0" → "segment_reporting_chart.min.v1_0_0_0.js"
        /// </summary>
        private static string VersionedJsName(string baseName, string tag)
        {
            var idx = baseName.LastIndexOf(".js", StringComparison.Ordinal);
            if (idx < 0)
            {
                return baseName;
            }

            return baseName.Substring(0, idx) + "." + tag + ".js";
        }
    }
}
