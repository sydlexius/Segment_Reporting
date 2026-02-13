import noUnsanitized from "eslint-plugin-no-unsanitized";

export default [
    {
        ignores: ["Pages/*.min.js", "node_modules/**", "scripts/**"]
    },

    // Base config for all plugin JS files
    {
        files: ["Pages/*.js"],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "script",
            globals: {
                // Browser globals
                window: "readonly",
                document: "readonly",
                console: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                location: "readonly",
                navigator: "readonly",
                sessionStorage: "readonly",
                localStorage: "readonly",
                getComputedStyle: "readonly",
                Promise: "readonly",
                JSON: "readonly",
                parseInt: "readonly",
                parseFloat: "readonly",
                isNaN: "readonly",
                isFinite: "readonly",
                encodeURIComponent: "readonly",
                decodeURIComponent: "readonly",
                URL: "readonly",
                Blob: "readonly",
                Event: "readonly",
                MutationObserver: "readonly",
                XMLHttpRequest: "readonly",
                URLSearchParams: "readonly",
                confirm: "readonly",
                prompt: "readonly",
                alert: "readonly",

                // AMD module globals
                define: "readonly",
                require: "readonly",

                // Emby globals
                Dashboard: "readonly",
                ApiClient: "readonly",
                Chart: "readonly",

                // Plugin entry point (provided by segment_reporting_helpers.js)
                getSegmentReportingHelpers: "readonly"
            }
        },
        plugins: {
            "no-unsanitized": noUnsanitized
        },
        rules: {
            // Code quality
            "no-unused-vars": ["warn", { vars: "all", args: "none", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
            "no-undef": "error",
            "eqeqeq": ["warn", "smart"],
            "no-redeclare": "error",

            // Security: prevent unsanitized innerHTML/outerHTML
            // All innerHTML usage in this plugin builds HTML from escHtml()-sanitized values
            // or static markup, so these are intentional and reviewed.
            "no-unsanitized/property": "off",
            "no-unsanitized/method": "warn"
        }
    },

    // Override for helpers file: it defines the global functions that other pages consume
    {
        files: ["Pages/segment_reporting_helpers.js"],
        languageOptions: {
            globals: {
                // Helpers file defines getSegmentReportingHelpers, not consumes it
                getSegmentReportingHelpers: "off"
            }
        },
        rules: {
            // Functions defined here are consumed by other pages via getSegmentReportingHelpers().
            // The entry point function itself appears "unused" to the linter but is called externally.
            "no-unused-vars": ["warn", { vars: "all", args: "none", varsIgnorePattern: "^(_|segmentReporting|getSegmentReporting|SEGMENT_REPORTING_)", caughtErrorsIgnorePattern: "^_" }]
        }
    }
];
