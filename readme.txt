=== ACE Wind Turbine Dashboard ===
Contributors: WillSabido, WebiSabi, ambitioncommunityenergy
Tags: wind, energy, dashboard, chart, renewable
Requires at least: 5.8
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.9.0
License: GPLv2 or later

Live data dashboard for the Ambition Community Energy wind turbine, powered by the ACE public data API.

== Description ==
Add `[ace_wind_dashboard]` to any page. Shows live tiles (power, wind speed, direction, rotor speed) and an interactive chart with pull-down menus for data set, measurement, comparison measurement, time period (5 minutes to 1 year, or a custom range) and chart style. Includes CSV download.

The browser only talks to the ACE WordPress site; the plugin calls https://ace-api.duckdns.org server-side, caches responses (1 second for live data), follows the API's pagination and Retry-After guidance, and only forwards whitelisted data sets/fields.

Shortcode options: title, family, field, compare, range (seconds), height, tiles (yes/no), controls (yes/no).

== Data licence ==
ACE Wind Turbine Data, CC BY 4.0. Plumley, Garrad, Burke, Jonsson & Smirthwaite. https://doi.org/10.5281/zenodo.22662372 (attribution is shown in the dashboard footer; please keep it).

== Third party ==
uPlot 1.6.31 (MIT) by Leon Sorokin is bundled in assets/vendor.

== Changelog ==
= 0.9.0 =
Initial alpha version for testing.
