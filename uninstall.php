<?php
// Remove plugin options and cached API data on uninstall.
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;
delete_option( 'ace_wind_options' );
global $wpdb;
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_ace\_wind\_%' OR option_name LIKE '\_transient\_timeout\_ace\_wind\_%'" ); // phpcs:ignore
