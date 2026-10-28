<?php
/**
 * Plugin Name:       ACE Wind Turbine Dashboard
 * Plugin URI:        https://ambitioncommunityenergy.org/
 * Description:       Live data dashboard for the Ambition Community Energy wind turbine, powered by the ACE public data API. Add it to any page with the [ace_wind_dashboard] shortcode.
 * Version:           0.9.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Ambition Community Energy
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       ace-wind-dashboard
 *
 * Data: ACE Wind Turbine Data, CC BY 4.0, https://doi.org/10.5281/zenodo.22662372
 */

defined( 'ABSPATH' ) || exit;

final class ACE_Wind_Dashboard {

	const VERSION = '0.9.0';
	const OPT     = 'ace_wind_options';
	const NS      = 'ace-wind/v1';

	/** Hard limits that keep requests to the upstream API small and polite. */
	const MAX_POINTS = 12000; // Maximum points per chart request.
	const MAX_PAGES  = 12;    // Maximum sequential upstream pages per request.

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_shortcode( 'ace_wind_dashboard', array( $this, 'shortcode' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'register_assets' ) );
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );

		add_action( 'admin_menu', array( $this, 'admin_menu' ) );
		add_action( 'admin_init', array( $this, 'admin_init' ) );
		add_action( 'admin_post_ace_wind_clear_cache', array( $this, 'handle_clear_cache' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), array( $this, 'action_links' ) );
	}

	/* ---------------------------------------------------------------------
	 * Options
	 * ------------------------------------------------------------------- */

	public function opts() {
		return wp_parse_args(
			get_option( self::OPT, array() ),
			array(
				'api_base'     => 'https://ace-api.duckdns.org',
				'site_id'      => 'ace',
				'rated_kw'     => 4200,
				'live_refresh' => 2,
				'timezone'     => 'Europe/London',
			)
		);
	}

	/* ---------------------------------------------------------------------
	 * Front end: assets + shortcode
	 * ------------------------------------------------------------------- */

	public function register_assets() {
		$u = plugin_dir_url( __FILE__ ) . 'assets/';
		wp_register_style( 'uplot', $u . 'vendor/uPlot.min.css', array(), '1.6.31' );
		wp_register_script( 'uplot', $u . 'vendor/uPlot.iife.min.js', array(), '1.6.31', true );
		wp_register_style( 'ace-wind-dashboard', $u . 'css/dashboard.css', array( 'uplot' ), self::VERSION );
		wp_register_script( 'ace-wind-dashboard', $u . 'js/dashboard.js', array( 'uplot' ), self::VERSION, true );
	}

	public function shortcode( $atts ) {
		$a = shortcode_atts(
			array(
				'title'    => 'Our wind turbine – live data',
				'family'   => 'site_instantaneous',
				'field'    => 'aggregate_active_power',
				'compare'  => 'aggregate_wind_speed',
				'range'    => 1800,
				'height'   => 420,
				'tiles'    => 'yes',
				'controls' => 'yes',
			),
			$atts,
			'ace_wind_dashboard'
		);

		wp_enqueue_style( 'ace-wind-dashboard' );
		wp_enqueue_script( 'ace-wind-dashboard' );

		$o   = $this->opts();
		$cfg = array(
			'rest'        => esc_url_raw( rest_url( self::NS . '/' ) ),
			'title'       => sanitize_text_field( $a['title'] ),
			'family'      => sanitize_key( $a['family'] ),
			'field'       => sanitize_key( $a['field'] ),
			'compare'     => sanitize_key( $a['compare'] ),
			'range'       => max( 60, (int) $a['range'] ),
			'height'      => min( 900, max( 240, (int) $a['height'] ) ),
			'tiles'       => 'no' !== strtolower( $a['tiles'] ),
			'controls'    => 'no' !== strtolower( $a['controls'] ),
			'ratedKw'     => (int) $o['rated_kw'],
			'liveRefresh' => (int) $o['live_refresh'],
			'tz'          => $o['timezone'],
		);

		return '<div class="acewd" data-config="' . esc_attr( wp_json_encode( $cfg ) ) . '">'
			. '<noscript>' . esc_html__( 'Please enable JavaScript to see the live wind turbine dashboard.', 'ace-wind-dashboard' ) . '</noscript>'
			. '<p class="acewd-loading">' . esc_html__( 'Loading turbine data…', 'ace-wind-dashboard' ) . '</p>'
			. '</div>';
	}

	/* ---------------------------------------------------------------------
	 * REST proxy (public, read-only, cached, whitelisted)
	 * ------------------------------------------------------------------- */

	public function register_routes() {
		register_rest_route(
			self::NS,
			'/catalogue',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'rest_catalogue' ),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			self::NS,
			'/data',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'rest_data' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'family'     => array( 'required' => true, 'sanitize_callback' => 'sanitize_key' ),
					'resolution' => array( 'required' => true, 'sanitize_callback' => 'sanitize_text_field' ),
					'fields'     => array( 'required' => true, 'sanitize_callback' => 'sanitize_text_field' ),
					'asset'      => array( 'sanitize_callback' => 'sanitize_text_field' ),
					'limit'      => array( 'sanitize_callback' => 'absint' ),
					'span'       => array( 'sanitize_callback' => 'absint' ),
					'start'      => array( 'sanitize_callback' => 'sanitize_text_field' ),
					'end'        => array( 'sanitize_callback' => 'sanitize_text_field' ),
				),
			)
		);
	}

	private function error( $code, $message, $status, $retry = 0 ) {
		return new WP_Error( $code, $message, array( 'status' => $status, 'retry' => $retry ) );
	}

	/** Convert a WP_Error into a REST response, passing Retry-After through. */
	private function error_response( WP_Error $e ) {
		$d      = $e->get_error_data();
		$status = isset( $d['status'] ) ? (int) $d['status'] : 502;
		$resp   = new WP_REST_Response( array( 'error' => $e->get_error_message(), 'code' => $e->get_error_code() ), $status );
		if ( ! empty( $d['retry'] ) ) {
			$resp->header( 'Retry-After', (string) (int) $d['retry'] );
		}
		$resp->header( 'Cache-Control', 'no-store' );
		return $resp;
	}

	/**
	 * GET from the ACE API with caching, stale-on-error and Retry-After handling.
	 *
	 * @return array|WP_Error Decoded JSON body.
	 */
	private function upstream( $path, $query, $ttl ) {
		$o   = $this->opts();
		$url = untrailingslashit( $o['api_base'] ) . $path;
		if ( $query ) {
			$url .= '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 );
		}
		$key = 'ace_wind_' . md5( $url );

		$hit = get_transient( $key );
		if ( false !== $hit ) {
			return $hit;
		}
		$stale = get_transient( $key . '_s' );

		$until = (int) get_transient( 'ace_wind_backoff' );
		if ( $until > time() ) {
			return false !== $stale ? $stale : $this->error( 'ace_rate_limited', 'The data service is busy. Please retry shortly.', 429, $until - time() );
		}

		$res = wp_safe_remote_get(
			$url,
			array(
				'timeout'     => 12,
				'redirection' => 2,
				'headers'     => array( 'Accept' => 'application/json' ),
				'user-agent'  => 'ACE-Wind-Dashboard-WP/' . self::VERSION . '; ' . home_url( '/' ),
			)
		);

		if ( is_wp_error( $res ) ) {
			return false !== $stale ? $stale : $this->error( 'ace_unreachable', 'The data service could not be reached.', 502 );
		}

		$code = (int) wp_remote_retrieve_response_code( $res );

		if ( 429 === $code ) {
			$ra = (int) wp_remote_retrieve_header( $res, 'retry-after' );
			$ra = max( 1, min( 300, $ra ? $ra : 5 ) );
			set_transient( 'ace_wind_backoff', time() + $ra, $ra );
			return false !== $stale ? $stale : $this->error( 'ace_rate_limited', 'The data service is busy. Please retry shortly.', 429, $ra );
		}

		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( 200 !== $code || ! is_array( $body ) ) {
			if ( false !== $stale ) {
				return $stale;
			}
			$msg = ( is_array( $body ) && isset( $body['error']['message'] ) ) ? (string) $body['error']['message'] : 'Unexpected response from the data service.';
			return $this->error( 'ace_upstream', $msg, ( $code >= 400 && $code < 500 ) ? 400 : 502 );
		}

		// The licence/citation block is shown in the dashboard footer; don't cache it repeatedly.
		unset( $body['attribution'] );

		set_transient( $key, $body, $ttl );
		set_transient( $key . '_s', $body, HOUR_IN_SECONDS );
		return $body;
	}

	/* ---- Catalogue --------------------------------------------------- */

	private static function res_seconds( $r ) {
		if ( preg_match( '/^(\d+)s$/', $r, $m ) ) {
			return (int) $m[1];
		}
		if ( preg_match( '/^(\d+)m$/', $r, $m ) ) {
			return (int) $m[1] * 60;
		}
		if ( 'daily' === $r ) {
			return 86400;
		}
		return 0;
	}

	private static function family_labels() {
		// Ordered: this is the order of the "Data" pull-down.
		return array(
			'site_instantaneous'      => 'Site – live power & wind',
			'wec_instantaneous'       => 'Turbine – live signals',
			'wecstd'                  => 'Turbine – statistics (mean / min / max)',
			'fcu2ctr1'                => 'Grid connection 1 – electrical',
			'fcu2ctr2'                => 'Grid connection 2 – electrical',
			'controller_instantaneous'=> 'Site controller – live electrical',
			'tep3c021'                => 'Temperatures – bearings, blades & cabinets',
			'tep3c022'                => 'Temperatures – inverters',
			'wecshad'                 => 'Shadow control',
			'wec_availability'        => 'Turbine availability (daily)',
			'controller_availability' => 'Controller availability (daily)',
		);
	}

	/** Build (and cache) the trimmed catalogue used for the pull-down menus and validation. */
	private function get_catalogue() {
		$o      = $this->opts();
		$ckey   = 'ace_wind_cat_' . md5( $o['api_base'] . '|' . $o['site_id'] );
		$cached = get_transient( $ckey );
		if ( false !== $cached ) {
			return $cached;
		}

		$fam = $this->upstream( '/v1/families', array(), 6 * HOUR_IN_SECONDS );
		if ( is_wp_error( $fam ) ) {
			return $fam;
		}
		$ast = $this->upstream( '/v1/sites/' . rawurlencode( $o['site_id'] ) . '/assets', array(), HOUR_IN_SECONDS );
		if ( is_wp_error( $ast ) ) {
			return $ast;
		}

		$assets = array();
		foreach ( (array) ( $ast['assets'] ?? array() ) as $a ) {
			if ( empty( $a['id'] ) || isset( $a['is_active'] ) && ! $a['is_active'] ) {
				continue;
			}
			$assets[ $a['id'] ] = array(
				'id'   => (string) $a['id'],
				'name' => (string) ( $a['display_name'] ?? $a['id'] ),
				'type' => (string) ( $a['asset_type'] ?? '' ),
			);
		}

		$labels = self::family_labels();
		$out    = array();
		foreach ( (array) ( $fam['families'] ?? array() ) as $f ) {
			$name = $f['family'] ?? '';
			if ( ! $name || empty( $f['public'] ) || empty( $f['capabilities'] ) ) {
				continue;
			}
			$scope = $f['scope'] ?? 'site';

			$fassets = array();
			if ( 'asset' === $scope ) {
				foreach ( $assets as $id => $a ) {
					if ( in_array( $a['type'], (array) ( $f['compatible_asset_types'] ?? array() ), true ) ) {
						$fassets[] = $id;
					}
				}
				if ( ! $fassets ) {
					continue; // Nothing to query.
				}
			}

			$res = array();
			foreach ( $f['capabilities'] as $c ) {
				$s = self::res_seconds( $c['resolution'] ?? '' );
				if ( ! $s ) {
					continue;
				}
				$res[] = array(
					'resolution' => $c['resolution'],
					'seconds'    => $s,
					'refresh'    => (int) ( $c['recommended_refresh_seconds'] ?? max( 1, $s ) ),
					'max_page'   => (int) ( $c['maximum_page_records'] ?? 1000 ),
					'max_latest' => (int) ( $c['maximum_latest_records'] ?? 2000 ),
				);
			}
			usort( $res, function ( $x, $y ) {
				return $x['seconds'] <=> $y['seconds'];
			} );
			if ( ! $res ) {
				continue;
			}

			$fields = array();
			foreach ( (array) ( $f['fields'] ?? array() ) as $fd ) {
				if ( empty( $fd['name'] ) || 'sample_count' === $fd['name'] ) {
					continue;
				}
				$fields[] = array(
					'name'  => (string) $fd['name'],
					'label' => (string) ( $fd['display_name'] ?? $fd['name'] ),
					'unit'  => isset( $fd['unit'] ) ? (string) $fd['unit'] : '',
				);
			}
			if ( ! $fields ) {
				continue;
			}

			$out[ $name ] = array(
				'family'      => $name,
				'label'       => $labels[ $name ] ?? ( $f['display_name'] ?? $name ),
				'scope'       => $scope,
				'assets'      => $fassets,
				'resolutions' => $res,
				'fields'      => $fields,
			);
		}

		// Known families first, in our order; unknown/new ones afterwards.
		$ordered = array();
		foreach ( array_keys( $labels ) as $k ) {
			if ( isset( $out[ $k ] ) ) {
				$ordered[ $k ] = $out[ $k ];
			}
		}
		foreach ( $out as $k => $v ) {
			$ordered[ $k ] = $v;
		}

		if ( ! $ordered ) {
			return $this->error( 'ace_empty_catalogue', 'No public data sets were found.', 502 );
		}

		$cat = array(
			'site'     => $o['site_id'],
			'assets'   => $assets,
			'families' => $ordered,
		);
		set_transient( $ckey, $cat, HOUR_IN_SECONDS );
		return $cat;
	}

	public function rest_catalogue() {
		$cat = $this->get_catalogue();
		if ( is_wp_error( $cat ) ) {
			return $this->error_response( $cat );
		}
		$resp = new WP_REST_Response(
			array(
				'site'     => $cat['site'],
				'assets'   => array_values( $cat['assets'] ),
				'families' => array_values( $cat['families'] ),
			)
		);
		$resp->header( 'Cache-Control', 'public, max-age=300' );
		return $resp;
	}

	/* ---- Data -------------------------------------------------------- */

	private static function to_iso( $v ) {
		$t = is_numeric( $v ) ? (int) $v : strtotime( (string) $v );
		return $t ? gmdate( 'Y-m-d\TH:i:s\Z', $t ) : null;
	}

	/** The API's integer timestamps may be seconds or milliseconds; normalise to seconds. */
	private static function norm_ts( $t ) {
		$t = (float) $t;
		return $t > 1e11 ? $t / 1000 : $t;
	}

	public function rest_data( WP_REST_Request $r ) {
		$cat = $this->get_catalogue();
		if ( is_wp_error( $cat ) ) {
			return $this->error_response( $cat );
		}
		$o = $this->opts();

		// --- Validate everything against the catalogue (this is not an open proxy).
		$fam = $cat['families'][ $r['family'] ] ?? null;
		if ( ! $fam ) {
			return $this->error_response( $this->error( 'ace_bad_family', 'Unknown data set.', 400 ) );
		}
		$res = null;
		foreach ( $fam['resolutions'] as $x ) {
			if ( $x['resolution'] === $r['resolution'] ) {
				$res = $x;
			}
		}
		if ( ! $res ) {
			return $this->error_response( $this->error( 'ace_bad_resolution', 'Unsupported resolution for this data set.', 400 ) );
		}
		$valid  = wp_list_pluck( $fam['fields'], 'name' );
		$fields = array_values( array_unique( array_filter( array_map( 'trim', explode( ',', (string) $r['fields'] ) ) ) ) );
		if ( ! $fields || count( $fields ) > 8 || array_diff( $fields, $valid ) ) {
			return $this->error_response( $this->error( 'ace_bad_fields', 'Unknown measurement.', 400 ) );
		}

		$base = '/v1/sites/' . rawurlencode( $o['site_id'] );
		if ( 'asset' === $fam['scope'] ) {
			$asset = (string) $r['asset'];
			if ( '' === $asset ) {
				$asset = $fam['assets'][0];
			}
			if ( ! in_array( $asset, $fam['assets'], true ) ) {
				return $this->error_response( $this->error( 'ace_bad_asset', 'Unknown turbine/asset.', 400 ) );
			}
			$base .= '/assets/' . rawurlencode( $asset );
		}
		$base .= '/data/' . rawurlencode( $fam['family'] );

		$rs     = $res['seconds'];
		$common = array(
			'resolution' => $res['resolution'],
			'fields'     => implode( ',', $fields ),
		);

		$limit = (int) $r['limit'];
		$span  = (int) $r['span'];
		$ts    = array();
		$ser   = array_fill_keys( $fields, array() );
		$ttl   = 30;
		$trunc = false;

		if ( $limit > 0 || ( $span > 0 && (int) ceil( $span / $rs ) + 1 <= $res['max_latest'] ) ) {
			// ---- "Latest N records": the live path.
			$n = $limit > 0 ? $limit : (int) ceil( $span / $rs ) + 1;
			$n = max( 1, min( $n, $res['max_latest'] ) );
			$b = $this->upstream( $base . '/latest', $common + array( 'limit' => $n ), $rs <= 1 ? 1 : 5 );
			if ( is_wp_error( $b ) ) {
				return $this->error_response( $b );
			}
			$this->merge_page( $b, $fields, $ts, $ser );
			$ttl = $rs <= 1 ? 1 : 5;
		} else {
			// ---- Historical range, paginated sequentially (as the API asks).
			if ( $span > 0 ) {
				$bucket = max( 30, $rs );
				$end    = (int) ( ceil( time() / $bucket ) * $bucket );
				$start  = $end - $span;
			} else {
				$start = self::to_iso( $r['start'] ) ? strtotime( self::to_iso( $r['start'] ) ) : 0;
				$end   = self::to_iso( $r['end'] ) ? strtotime( self::to_iso( $r['end'] ) ) : 0;
			}
			if ( $start <= 0 || $end <= $start ) {
				return $this->error_response( $this->error( 'ace_bad_range', 'Invalid time range.', 400 ) );
			}
			if ( ( $end - $start ) / $rs > self::MAX_POINTS ) {
				return $this->error_response( $this->error( 'ace_too_many', 'That period is too long for this resolution.', 400 ) );
			}
			$common += array(
				'start'     => gmdate( 'Y-m-d\TH:i:s\Z', $start ),
				'end'       => gmdate( 'Y-m-d\TH:i:s\Z', $end ),
				'page_size' => max( 1, min( 5000, $res['max_page'] ) ),
			);
			$cursor = null;
			for ( $i = 0; $i < self::MAX_PAGES; $i++ ) {
				$q = $common;
				if ( $cursor ) {
					$q['cursor'] = $cursor;
				}
				$b = $this->upstream( $base . '/range', $q, 30 );
				if ( is_wp_error( $b ) ) {
					return $this->error_response( $b );
				}
				$this->merge_page( $b, $fields, $ts, $ser );
				if ( empty( $b['page']['has_more'] ) || empty( $b['page']['next_cursor'] ) ) {
					break;
				}
				$cursor = $b['page']['next_cursor'];
				if ( self::MAX_PAGES - 1 === $i ) {
					$trunc = true;
				}
			}
		}

		$meta = array();
		foreach ( $fam['fields'] as $f ) {
			if ( in_array( $f['name'], $fields, true ) ) {
				$meta[ $f['name'] ] = $f;
			}
		}

		$resp = new WP_REST_Response(
			array(
				'family'     => $fam['family'],
				'resolution' => $res['resolution'],
				'seconds'    => $rs,
				'fields'     => $meta,
				'timestamps' => $ts,
				'series'     => $ser,
				'truncated'  => $trunc,
			)
		);
		$resp->header( 'Cache-Control', 'public, max-age=' . (int) $ttl );
		return $resp;
	}

	private function merge_page( $b, $fields, &$ts, &$ser ) {
		$bt = (array) ( $b['timestamps'] ?? array() );
		$n  = count( $bt );
		foreach ( $bt as $t ) {
			$ts[] = self::norm_ts( $t );
		}
		foreach ( $fields as $f ) {
			$col = isset( $b['series'][ $f ] ) ? array_values( (array) $b['series'][ $f ] ) : array();
			for ( $i = 0; $i < $n; $i++ ) {
				$v            = $col[ $i ] ?? null;
				$ser[ $f ][] = is_numeric( $v ) ? $v + 0 : null;
			}
		}
	}

	/* ---------------------------------------------------------------------
	 * Admin: settings page
	 * ------------------------------------------------------------------- */

	public function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=ace-wind-dashboard' ) ) . '">' . esc_html__( 'Settings', 'ace-wind-dashboard' ) . '</a>' );
		return $links;
	}

	public function admin_menu() {
		add_options_page( 'ACE Wind Dashboard', 'ACE Wind Dashboard', 'manage_options', 'ace-wind-dashboard', array( $this, 'settings_page' ) );
	}

	public function admin_init() {
		register_setting( 'ace_wind', self::OPT, array( 'sanitize_callback' => array( $this, 'sanitize' ) ) );
	}

	public function sanitize( $in ) {
		$d   = $this->opts();
		$out = array();

		$base            = esc_url_raw( trim( (string) ( $in['api_base'] ?? $d['api_base'] ) ), array( 'https', 'http' ) );
		$out['api_base'] = $base ? untrailingslashit( $base ) : 'https://ace-api.duckdns.org';
		$site            = preg_replace( '/[^A-Za-z0-9_\-]/', '', (string) ( $in['site_id'] ?? '' ) );
		$out['site_id']  = $site ? $site : 'ace';
		$out['rated_kw'] = max( 1, (int) ( $in['rated_kw'] ?? 4200 ) );
		$out['live_refresh'] = max( 1, min( 60, (int) ( $in['live_refresh'] ?? 2 ) ) );
		$tz              = (string) ( $in['timezone'] ?? 'Europe/London' );
		$out['timezone'] = in_array( $tz, timezone_identifiers_list(), true ) ? $tz : 'Europe/London';

		$this->clear_cache();
		return $out;
	}

	private function clear_cache() {
		global $wpdb;
		$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_ace\_wind\_%' OR option_name LIKE '\_transient\_timeout\_ace\_wind\_%'" ); // phpcs:ignore
		wp_cache_flush();
	}

	public function handle_clear_cache() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Not allowed.', 'ace-wind-dashboard' ) );
		}
		check_admin_referer( 'ace_wind_clear_cache' );
		$this->clear_cache();
		wp_safe_redirect( add_query_arg( 'cache-cleared', '1', admin_url( 'options-general.php?page=ace-wind-dashboard' ) ) );
		exit;
	}

	public function settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$o = $this->opts();
		?>
		<div class="wrap">
			<h1>ACE Wind Turbine Dashboard</h1>
			<?php if ( isset( $_GET['cache-cleared'] ) ) : // phpcs:ignore ?>
				<div class="notice notice-success is-dismissible"><p>Cache cleared.</p></div>
			<?php endif; ?>

			<p>Add the dashboard to any page or post with <code>[ace_wind_dashboard]</code>.</p>

			<form method="post" action="options.php">
				<?php settings_fields( 'ace_wind' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="ace_api_base">API base URL</label></th>
						<td><input type="url" id="ace_api_base" class="regular-text" name="<?php echo esc_attr( self::OPT ); ?>[api_base]" value="<?php echo esc_attr( $o['api_base'] ); ?>"></td>
					</tr>
					<tr>
						<th scope="row"><label for="ace_site_id">Site ID</label></th>
						<td><input type="text" id="ace_site_id" class="small-text" name="<?php echo esc_attr( self::OPT ); ?>[site_id]" value="<?php echo esc_attr( $o['site_id'] ); ?>">
						<p class="description">As listed by <code>/v1/sites</code> (normally <code>ace</code>).</p></td>
					</tr>
					<tr>
						<th scope="row"><label for="ace_rated">Turbine rated power (kW)</label></th>
						<td><input type="number" min="1" id="ace_rated" class="small-text" name="<?php echo esc_attr( self::OPT ); ?>[rated_kw]" value="<?php echo esc_attr( $o['rated_kw'] ); ?>">
						<p class="description">Used for the "% of rated output" gauge. The ACE turbine is 4.2&nbsp;MW.</p></td>
					</tr>
					<tr>
						<th scope="row"><label for="ace_live">Live refresh (seconds)</label></th>
						<td><input type="number" min="1" max="60" id="ace_live" class="small-text" name="<?php echo esc_attr( self::OPT ); ?>[live_refresh]" value="<?php echo esc_attr( $o['live_refresh'] ); ?>">
						<p class="description">How often each visitor's browser asks for new 1-second data. Responses are cached on your server for 1&nbsp;second, so the API is called at most about once per second however many visitors you have.</p></td>
					</tr>
					<tr>
						<th scope="row"><label for="ace_tz">Chart time zone</label></th>
						<td><select id="ace_tz" name="<?php echo esc_attr( self::OPT ); ?>[timezone]">
							<?php foreach ( timezone_identifiers_list() as $tz ) : ?>
								<option value="<?php echo esc_attr( $tz ); ?>" <?php selected( $o['timezone'], $tz ); ?>><?php echo esc_html( $tz ); ?></option>
							<?php endforeach; ?>
						</select></td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<hr>
			<h2>Shortcode options</h2>
			<p><code>[ace_wind_dashboard title="Our turbine" family="site_instantaneous" field="aggregate_active_power" compare="aggregate_wind_speed" range="1800" height="420" tiles="yes" controls="yes"]</code></p>
			<ul style="list-style:disc;margin-left:2em">
				<li><code>family</code>, <code>field</code>, <code>compare</code> – initial data set and measurements (names as in the API's <code>/v1/families</code>). Use <code>compare=""</code> for a single line.</li>
				<li><code>range</code> – initial period in seconds (e.g. <code>3600</code> = 1 hour, <code>86400</code> = 24 hours).</li>
				<li><code>tiles="no"</code> hides the live summary tiles; <code>controls="no"</code> hides the pull-down menus.</li>
			</ul>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="ace_wind_clear_cache">
				<?php wp_nonce_field( 'ace_wind_clear_cache' ); ?>
				<?php submit_button( 'Clear cached API data', 'secondary', 'submit', false ); ?>
			</form>

			<p style="margin-top:2em;color:#555">Data: ACE Wind Turbine Data, licensed
				<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>,
				<a href="https://doi.org/10.5281/zenodo.22662372" target="_blank" rel="noopener">doi:10.5281/zenodo.22662372</a>.
				Charts by <a href="https://github.com/leeoniya/uPlot" target="_blank" rel="noopener">uPlot</a> (MIT).</p>
		</div>
		<?php
	}
}

ACE_Wind_Dashboard::instance();
