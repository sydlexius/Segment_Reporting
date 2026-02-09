/**
 * Custom Chart.js entry point - includes only the modules used by this plugin.
 *
 * Used modules: BarController, BarElement, CategoryScale, LinearScale,
 *               Legend, Tooltip (stacked bar charts with legend/tooltip).
 *
 * To add more chart types later, import and register the required controllers,
 * elements, scales, and plugins here, then rebuild with: npm run build:chart
 */
import {
    Chart,
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    Legend,
    Tooltip
} from 'chart.js';

Chart.register(
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    Legend,
    Tooltip
);

export default Chart;
