=== ACE Wind Turbine Dashboard ===
Contributors: WillSabido, WebiSabi, ambitioncommunityenergy
Tags: wind, energy, dashboard, chart, renewable, live data
Requires at least: 6.3
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.1.2
License: GPLv2 or later

Live data dashboard for the Ambition Community Energy wind turbine, powered by the ACE public data API.

== Description ==
Add `[ace_wind_dashboard]` to any page. Shows live tiles (power, wind speed, direction, rotor speed) and an interactive chart with pull-down menus for data set, measurement, comparison measurement, time period (5 minutes to 1 year, or a custom range) and chart style. Includes CSV download.

The browser only talks to the ACE WordPress site; the plugin calls https://ace-api.duckdns.org server-side, caches responses (1 second for live data), follows the API's pagination and Retry-After guidance, and only forwards whitelisted data sets/fields.

= ACE Live Reading block =
In the block editor add the **ACE Live Reading** block (Widgets category) to show one live number, like the tiles at the top of the dashboard:

* **Measurement:** power output, share of rated output, wind speed (m/s, mph, km/h or knots), wind direction (compass point and/or degrees), rotor speed, or "Other measurement..." for any live value the API offers.
* **Icon:** wind turbine, wind, compass, lightning bolt, gauge, your own image or SVG from the Media Library, or none. Place it left, right, above, or as a faint background.
* **Animated by the real data:** the turbine turns at the actual rotor speed, wind lines flow faster in stronger wind, the compass needle points the way the wind is blowing, the bolt glows with power. Animation can be switched off per block and stops automatically for visitors who prefer reduced motion.
* Colours, spacing, font size, borders and alignment use the normal block settings. The editor preview is live.
* Any number of blocks on a page share one data request.

Shortcode options: title, family, field, compare, range (seconds), height, tiles (yes/no), controls (yes/no).

== Data licence ==
ACE Wind Turbine Data, CC BY 4.0. Plumley, Garrad, Burke, Jonsson & Smirthwaite. https://doi.org/10.5281/zenodo.22662372 (attribution is shown in the dashboard footer; please keep it).

== Third party ==
uPlot 1.6.31 (MIT) by Leon Sorokin is bundled in assets/vendor.

== Frequently Asked Questions ==

= The chart is blank or the times are old until I change a menu =
A cache (a WordPress cache plugin, your host, or a CDN) is probably storing the plugin's `/wp-json/ace-wind/v1/` responses. The plugin asks caches not to store them and makes every live request URL unique, but some caches ignore both. Exclude `/wp-json/ace-wind/` from caching (LiteSpeed Cache: Cache > Excludes > Do Not Cache URIs; WP Rocket: Advanced Rules > Never Cache URL(s); Cloudflare: a Cache Rule to bypass cache for that path). If the chart shows an error, the reason is printed under it and in the browser console.

= Times on the dashboard are wrong =
Open Settings > ACE Wind Dashboard > Diagnostics and click "Check timestamps now".

== Changelog ==
= 1.1.2 =
Add missing type info to dashboard class.

= 1.1.1 =
Revert to previous MAX_POINTS value following testing. Add more specific author info.

= 1.1.0 =
New **ACE Live Reading** Gutenberg block: a live readout tile with a choice of measurement, units and an animated icon (turbine, wind, compass, bolt, gauge or your own image). Requires WordPress 6.3 or later.

= 1.0.0 =
Live responses are now sent as uncacheable (Cache-Control, LiteSpeed and DONOTCACHEPAGE signals) and every live request URL is unique, so cached copies can't leave the default chart blank or stale. Request failures now show their cause. If the default view has no data it automatically widens to the next longer period.

= 0.12.0 =
Timestamp unit is now detected automatically (seconds, milliseconds, microseconds, nanoseconds or Windows FILETIME) instead of guessing seconds vs milliseconds. New Settings > ACE Wind Dashboard > Diagnostics panel shows how the API's timestamps are being read.

= 0.11.0 =
Refactored JS to TS.

= 0.10.0 =
Added tests for PHP & JS.

= 0.9.0 =
Initial commit - alpha version for testing.

= 0.8.0 =
Add styles.

= 0.7.0 =
Add uPlot for dashboard graph.

= 0.5.0 =
Basic functionality for ACE API connection, caching & REST proxy.

= 0.4.0 =
Add WP settings.

= 0.3.0 =
Outline structure.

= 0.2.0 =
Readme & todo.

= 0.1.0 =
Basic plugin boilerplate.
