<?php

/**
 * Plugin Name:       ACE Wind Turbine Dashboard
 * Plugin URI:        https://ambitioncommunityenergy.org/
 * Description:       Live data dashboard for the Ambition Community Energy wind turbine, powered by the ACE public data API. Add it with the [ace_wind_dashboard] shortcode, or add specified live readings with the "ACE Live Reading" block.
 * Version:           1.1.3
 * Requires at least: 6.3
 * Requires PHP:      7.4
 * Author:            Will Sabido
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       ace-wind-dashboard
 *
 * Data: ACE Wind Turbine Data, CC BY 4.0, https://doi.org/10.5281/zenodo.22662372
 */

defined('ABSPATH') || exit;

require_once __DIR__ . '/includes/class-ace-wind-live-reading.php';

final class ACE_Wind_Dashboard
{

	const VERSION = '1.1.3';
	const OPT     = 'ace_wind_options';
	const NS      = 'ace-wind/v1';

	/** Hard limits that keep requests to the upstream API small and polite. */
	const MAX_POINTS = 14000; // Maximum points per chart request.
	const MAX_PAGES  = 12;   // Maximum sequential upstream pages per request.

	private static ?self $instance = null;

	public static function instance(): self
	{
		if (null === self::$instance) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct()
	{
		add_shortcode('ace_wind_dashboard', array($this, 'shortcode'));
		new ACE_Wind_Live_Reading($this);
		add_action('wp_enqueue_scripts', array($this, 'register_assets'));
		add_action('rest_api_init', array($this, 'register_routes'));

		add_action('admin_menu', array($this, 'admin_menu'));
		add_action('admin_init', array($this, 'admin_init'));
		add_action('admin_post_ace_wind_clear_cache', array($this, 'handle_clear_cache'));
		add_filter('plugin_action_links_' . plugin_basename(__FILE__), array($this, 'action_links'));
	}

	/* ---------------------------------------------------------------------
	 * Options
	 * ------------------------------------------------------------------- */

	public function opts()
	{
		return wp_parse_args(
			get_option(self::OPT, array()),
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

	public function register_assets()
	{
		$u = plugin_dir_url(__FILE__) . 'assets/';
		wp_register_style('uplot', $u . 'vendor/uPlot.min.css', array(), '1.6.31');
		wp_register_script('uplot', $u . 'vendor/uPlot.iife.min.js', array(), '1.6.31', true);
		wp_register_style('ace-wind-dashboard', $u . 'css/dashboard.css', array('uplot'), self::VERSION);
		wp_register_script('ace-wind-dashboard', $u . 'js/dashboard.js', array('uplot'), self::VERSION, true);
	}

	public function shortcode(array $atts = [])
	{
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

		wp_enqueue_style('ace-wind-dashboard');
		wp_enqueue_script('ace-wind-dashboard');

		$o   = $this->opts();
		$cfg = array(
			'rest'        => esc_url_raw(rest_url(self::NS . '/')),
			'title'       => sanitize_text_field($a['title']),
			'family'      => sanitize_key($a['family']),
			'field'       => sanitize_key($a['field']),
			'compare'     => sanitize_key($a['compare']),
			'range'       => max(60, (int) $a['range']),
			'height'      => min(900, max(240, (int) $a['height'])),
			'tiles'       => 'no' !== strtolower($a['tiles']),
			'controls'    => 'no' !== strtolower($a['controls']),
			'ratedKw'     => (int) $o['rated_kw'],
			'liveRefresh' => (int) $o['live_refresh'],
			'tz'          => $o['timezone'],
		);

		return '<div class="acewd" data-config="' . esc_attr(wp_json_encode($cfg)) . '">'
			. '<noscript>' . esc_html__('Please enable JavaScript to see the live wind turbine dashboard.', 'ace-wind-dashboard') . '</noscript>'
			. '<p class="acewd-loading">' . esc_html__('Loading turbine data…', 'ace-wind-dashboard') . '</p>'
			. '</div>';
	}

	/* ---------------------------------------------------------------------
	 * REST proxy (public, read-only, cached, whitelisted)
	 * ------------------------------------------------------------------- */

	public function register_routes()
	{
		register_rest_route(
			self::NS,
			'/catalogue',
			array(
				'methods'             => 'GET',
				'callback'            => array($this, 'rest_catalogue'),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			self::NS,
			'/data',
			array(
				'methods'             => 'GET',
				'callback'            => array($this, 'rest_data'),
				'permission_callback' => '__return_true',
				'args'                => array(
					'family'     => array('required' => true, 'sanitize_callback' => 'sanitize_key'),
					'resolution' => array('required' => true, 'sanitize_callback' => 'sanitize_text_field'),
					'fields'     => array('required' => true, 'sanitize_callback' => 'sanitize_text_field'),
					'asset'      => array('sanitize_callback' => 'sanitize_text_field'),
					'limit'      => array('sanitize_callback' => 'absint'),
					'span'       => array('sanitize_callback' => 'absint'),
					'start'      => array('sanitize_callback' => 'sanitize_text_field'),
					'end'        => array('sanitize_callback' => 'sanitize_text_field'),
				),
			)
		);
	}

	private function error(string $code, string $message, int $status, int $retry = 0)
	{
		return new WP_Error($code, $message, array('status' => $status, 'retry' => $retry));
	}

	/**
	 * Mark a response as uncacheable by browsers, CDNs and WordPress cache plugins.
	 * Live readings must never be served from a cache; our own transients already protect the upstream API.
	 */
	private function no_cache(WP_REST_Response $resp): WP_REST_Response
	{
		$resp->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
		$resp->header('Pragma', 'no-cache');
		$resp->header('X-LiteSpeed-Cache-Control', 'no-cache');
		if (! defined('DONOTCACHEPAGE')) {
			define('DONOTCACHEPAGE', true); // W3 Total Cache, WP Super Cache, WP Rocket and others honour this.
		}
		do_action('litespeed_control_set_nocache', 'ace-wind-dashboard live data');
		return $resp;
	}

	/** Convert a WP_Error into a REST response, passing Retry-After through. */
	private function error_response(WP_Error $e)
	{
		$d      = $e->get_error_data();
		$status = isset($d['status']) ? (int) $d['status'] : 502;
		$resp   = new WP_REST_Response(array('error' => $e->get_error_message(), 'code' => $e->get_error_code()), $status);
		if (! empty($d['retry'])) {
			$resp->header('Retry-After', (string) (int) $d['retry']);
		}
		return $this->no_cache($resp);
	}

	/**
	 * GET from the ACE API with caching, stale-on-error and Retry-After handling.
	 *
	 * @return array|WP_Error Decoded JSON body.
	 */
	private function upstream(string $path, array $query, int $ttl)
	{
		$o   = $this->opts();
		$url = untrailingslashit($o['api_base']) . $path;
		if ($query) {
			$url .= '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
		}
		$key = 'ace_wind_' . md5($url);

		$hit = get_transient($key);
		if (false !== $hit) {
			return $hit;
		}
		$stale = get_transient($key . '_s');

		$until = (int) get_transient('ace_wind_backoff');
		if ($until > time()) {
			return false !== $stale ? $stale : $this->error('ace_rate_limited', 'The data service is busy. Please retry shortly.', 429, $until - time());
		}

		$res = wp_safe_remote_get(
			$url,
			array(
				'timeout'     => 12,
				'redirection' => 2,
				'headers'     => array('Accept' => 'application/json'),
				'user-agent'  => 'ACE-Wind-Dashboard-WP/' . self::VERSION . '; ' . home_url('/'),
			)
		);

		if (is_wp_error($res)) {
			return false !== $stale ? $stale : $this->error('ace_unreachable', 'The data service could not be reached.', 502);
		}

		$code = (int) wp_remote_retrieve_response_code($res);

		if (429 === $code) {
			$ra = (int) wp_remote_retrieve_header($res, 'retry-after');
			$ra = max(1, min(300, $ra ? $ra : 5));
			set_transient('ace_wind_backoff', time() + $ra, $ra);
			return false !== $stale ? $stale : $this->error('ace_rate_limited', 'The data service is busy. Please retry shortly.', 429, $ra);
		}

		$body = json_decode(wp_remote_retrieve_body($res), true);
		if (200 !== $code || ! is_array($body)) {
			if (false !== $stale) {
				return $stale;
			}
			return $this->error('ace_upstream', self::upstream_message($body, $code), ($code >= 400 && $code < 500) ? 400 : 502);
		}

		// The licence/citation block is shown in the dashboard footer; don't cache it repeatedly.
		unset($body['attribution']);

		set_transient($key, $body, $ttl);
		set_transient($key . '_s', $body, HOUR_IN_SECONDS);
		return $body;
	}

	/**
	 * The most useful human-readable reason in an upstream error body: {error:{message}}, {error:"..."},
	 * {detail:"..."}, FastAPI-style {detail:[{msg}]} or {message:"..."}; otherwise a generic sentence.
	 *
	 * @param mixed $body Decoded upstream response; may be any JSON value.
	 * @param int   $code HTTP response code.
	 * @return string
	 */
	private static function upstream_message($body, $code)
	{
		$generic = ($code >= 400 && $code < 500)
			? 'The data service rejected the request (HTTP ' . (int) $code . ').'
			: 'Unexpected response from the data service.';
		if (! is_array($body)) {
			return $generic;
		}
		$candidates = array(
			isset($body['error']) && is_array($body['error']) ? ($body['error']['message'] ?? null) : ($body['error'] ?? null),
			$body['detail'] ?? null,
			$body['message'] ?? null,
		);
		foreach ($candidates as $c) {
			if (is_array($c)) {
				$first = reset($c);
				$c     = is_array($first) ? ($first['msg'] ?? null) : $first;
			}
			if (is_string($c) && '' !== trim($c)) {
				// Drop real HTML tags only ("<" followed by a letter, "/" or "!"): a bare "<" ("must be <= 1000") is text, and the
				// browser shows this message as plain text.
				$c = trim(preg_replace('/\s+/', ' ', preg_replace('/<\/?[a-zA-Z!][^>]*>/', '', $c)));
				if ('' !== $c) {
					return mb_substr($c, 0, 200);
				}
			}
		}
		return $generic;
	}

	/* ---- Catalogue --------------------------------------------------- */

	private static function res_seconds(string $r)
	{
		if (preg_match('/^(\d+)s$/', $r, $m)) {
			return (int) $m[1];
		}
		if (preg_match('/^(\d+)m$/', $r, $m)) {
			return (int) $m[1] * 60;
		}
		if ('daily' === $r) {
			return 86400;
		}
		return 0;
	}

	private static function family_labels()
	{
		// Ordered: this is the order of the "Data" pull-down.
		return array(
			'site_instantaneous'      => 'Site – live power & wind',
			'wec_instantaneous'       => 'Turbine – live signals',
			'wecstd'                  => 'Turbine – statistics (mean / min / max)',
			'fcu2ctr1'                => 'Grid connection 1 – electrical',
			'fcu2ctr2'                => 'Grid connection 2 – electrical',
			'controller_instantaneous' => 'Site controller – live electrical',
			'tep3c021'                => 'Temperatures – bearings, blades & cabinets',
			'tep3c022'                => 'Temperatures – inverters',
			'wecshad'                 => 'Shadow control',
			'wec_availability'        => 'Turbine availability (daily)',
			'controller_availability' => 'Controller availability (daily)',
		);
	}

	/** Build (and cache) the trimmed catalogue used for the pull-down menus and validation. */
	private function get_catalogue()
	{
		$o      = $this->opts();
		$ckey   = 'ace_wind_cat_' . md5($o['api_base'] . '|' . $o['site_id']);
		$cached = get_transient($ckey);
		if (false !== $cached) {
			return $cached;
		}

		$fam = $this->upstream('/v1/families', array(), 6 * HOUR_IN_SECONDS);
		if (is_wp_error($fam)) {
			return $fam;
		}
		$ast = $this->upstream('/v1/sites/' . rawurlencode($o['site_id']) . '/assets', array(), HOUR_IN_SECONDS);
		if (is_wp_error($ast)) {
			return $ast;
		}

		$assets = array();
		foreach ((array) ($ast['assets'] ?? array()) as $a) {
			if (empty($a['id']) || isset($a['is_active']) && ! $a['is_active']) {
				continue;
			}
			$assets[$a['id']] = array(
				'id'   => (string) $a['id'],
				'name' => (string) ($a['display_name'] ?? $a['id']),
				'type' => (string) ($a['asset_type'] ?? ''),
			);
		}

		$labels = self::family_labels();
		$out    = array();
		foreach ((array) ($fam['families'] ?? array()) as $f) {
			$name = $f['family'] ?? '';
			if (! $name || empty($f['public']) || empty($f['capabilities'])) {
				continue;
			}
			$scope = $f['scope'] ?? 'site';

			$fassets = array();
			if ('asset' === $scope) {
				foreach ($assets as $id => $a) {
					if (in_array($a['type'], (array) ($f['compatible_asset_types'] ?? array()), true)) {
						$fassets[] = $id;
					}
				}
				if (! $fassets) {
					continue; // Nothing to query.
				}
			}

			$res = array();
			foreach ($f['capabilities'] as $c) {
				$s = self::res_seconds($c['resolution'] ?? '');
				if (! $s) {
					continue;
				}
				$res[] = array(
					'resolution' => $c['resolution'],
					'seconds'    => $s,
					'refresh'    => (int) ($c['recommended_refresh_seconds'] ?? max(1, $s)),
					'max_page'   => (int) ($c['maximum_page_records'] ?? 1000),
					// The API advertises a "latest" limit that it does not always honour (e.g. 2000 for 1-second
					// data while refusing more than the 1000-row page size), so trust the lower of the two.
					'max_latest' => min((int) ($c['maximum_latest_records'] ?? 2000), (int) ($c['maximum_page_records'] ?? 1000)),
				);
			}
			usort($res, function ($x, $y) {
				return $x['seconds'] <=> $y['seconds'];
			});
			if (! $res) {
				continue;
			}

			$fields = array();
			foreach ((array) ($f['fields'] ?? array()) as $fd) {
				if (empty($fd['name']) || 'sample_count' === $fd['name']) {
					continue;
				}
				$fields[] = array(
					'name'  => (string) $fd['name'],
					'label' => (string) ($fd['display_name'] ?? $fd['name']),
					'unit'  => isset($fd['unit']) ? (string) $fd['unit'] : '',
				);
			}
			if (! $fields) {
				continue;
			}

			$out[$name] = array(
				'family'      => $name,
				'label'       => $labels[$name] ?? ($f['display_name'] ?? $name),
				'scope'       => $scope,
				'assets'      => $fassets,
				'resolutions' => $res,
				'fields'      => $fields,
			);
		}

		// Known families first, in our order; unknown/new ones afterwards.
		$ordered = array();
		foreach (array_keys($labels) as $k) {
			if (isset($out[$k])) {
				$ordered[$k] = $out[$k];
			}
		}
		foreach ($out as $k => $v) {
			$ordered[$k] = $v;
		}

		if (! $ordered) {
			return $this->error('ace_empty_catalogue', 'No public data sets were found.', 502);
		}

		$cat = array(
			'site'     => $o['site_id'],
			'assets'   => $assets,
			'families' => $ordered,
		);
		set_transient($ckey, $cat, HOUR_IN_SECONDS);
		return $cat;
	}

	public function rest_catalogue()
	{
		$cat = $this->get_catalogue();
		if (is_wp_error($cat)) {
			return $this->error_response($cat);
		}
		$resp = new WP_REST_Response(
			array(
				'site'     => $cat['site'],
				'assets'   => array_values($cat['assets']),
				'families' => array_values($cat['families']),
			)
		);
		$resp->header('Cache-Control', 'public, max-age=300');
		return $resp;
	}

	/* ---- Data -------------------------------------------------------- */

	/**
	 * @param int|float|string|null $v
	 */
	private static function to_iso($v): ?string
	{
		$t = is_numeric($v) ? (int) $v : strtotime((string) $v);
		return $t ? gmdate('Y-m-d\TH:i:s\Z', $t) : null;
	}

	/** Seconds from 1601-01-01 (Windows FILETIME epoch) to 1970-01-01. */
	const FILETIME_EPOCH = 11644473600;

	/**
	 * Candidate encodings of an integer timestamp: label => [ divisor to get seconds, epoch shift in seconds ].
	 * The API schema only says "integer", so we identify the unit by which reading lands in 2000-2100.
	 */
	private static function ts_encodings()
	{
		return array(
			'seconds'      => array(1, 0),
			'milliseconds' => array(1e3, 0),
			'microseconds' => array(1e6, 0),
			'nanoseconds'  => array(1e9, 0),
			'filetime'     => array(1e7, self::FILETIME_EPOCH), // 100 ns ticks since 1601 (OPC / Windows).
		);
	}

	/**
	 * Work out the unit of a raw timestamp.
	 *
	 * @param int|float|string $raw Raw timestamp value from the API.
	 * @return array|null [ label, unix_seconds ], or null if no unit puts it between 2000 and 2100.
	 */
	public static function detect_ts($raw)
	{
		$raw = (float) $raw;
		foreach (self::ts_encodings() as $label => $enc) {
			$unix = $raw / $enc[0] - $enc[1];
			if ($unix >= 946684800 && $unix <= 4102444800) {
				return array($label, $unix);
			}
		}
		return null;
	}

	/**
	 * Normalise an API integer timestamp to Unix seconds.
	 *
	 * @param int|float|string|null $t
	 * @return float
	 */
	private static function norm_ts($t)
	{
		$d = self::detect_ts($t);
		if ($d) {
			return $d[1];
		}
		// Not plausible as 2000-2100 in any known unit: keep the older seconds/milliseconds guess.
		$t = (float) $t;
		return $t > 1e11 ? $t / 1000 : $t;
	}

	/* ---- Diagnostics ------------------------------------------------- */

	/**
	 * Fetch the newest few readings straight from the API (no cache) and explain what the timestamps mean.
	 *
	 * @return array { ok, error?, url, raw[], unit, unix, utc, local, server_now, delta, verdict, message, candidates[], api_clock_skew? }
	 */
	public function diagnose()
	{
		$o   = $this->opts();
		$url = untrailingslashit($o['api_base']) . '/v1/sites/' . rawurlencode($o['site_id'])
			. '/data/site_instantaneous/latest?resolution=1s&fields=aggregate_active_power&limit=3';

		$res = wp_safe_remote_get(
			$url,
			array(
				'timeout'    => 12,
				'headers'    => array('Accept' => 'application/json'),
				'user-agent' => 'ACE-Wind-Dashboard-WP/' . self::VERSION . '; ' . home_url('/'),
			)
		);
		$out = array('ok' => false, 'url' => $url);
		if (is_wp_error($res)) {
			$out['error'] = 'Could not reach the API: ' . $res->get_error_message();
			return $out;
		}
		$code = (int) wp_remote_retrieve_response_code($res);
		$body = json_decode(wp_remote_retrieve_body($res), true);
		if (200 !== $code || ! is_array($body)) {
			$out['error'] = 'The API answered HTTP ' . $code . '.';
			return $out;
		}
		$raw = array_values((array) ($body['timestamps'] ?? array()));
		if (! $raw) {
			$out['error'] = 'The API returned no records for site_instantaneous.';
			return $out;
		}

		$server_now = time();
		$newest     = end($raw);
		$det        = self::detect_ts($newest);
		$unix       = $det ? $det[1] : self::norm_ts($newest);

		// array_merge, not "+=": the union operator would keep the initial 'ok' => false.
		$out = array_merge($out, array(
			'ok'         => true,
			'raw'        => $raw,
			'unit'       => $det ? $det[0] : null,
			'unix'       => $unix,
			'utc'        => self::fmt_utc($unix),
			'server_now' => $server_now,
			'delta'      => (int) round($unix - $server_now),
		));
		try {
			$tz           = new DateTimeZone($o['timezone']);
			$out['local'] = (new DateTime('@' . (int) $unix))->setTimezone($tz)->format('Y-m-d H:i:s T');
		} catch (Exception $e) {
			$out['local'] = '';
		}

		// How would each possible encoding read this number, and which one matches "now"?
		$cands = array();
		foreach (array_merge(self::ts_encodings(), array('labview (1904 epoch, s)' => array(1, 2082844800))) as $label => $enc) {
			$u       = (float) $newest / $enc[0] - $enc[1];
			$cands[] = array(
				'label'  => $label,
				'utc'    => self::fmt_utc($u),
				'delta'  => abs($u) < 253402300799 ? (int) round($u - $server_now) : null,
			);
		}
		$out['candidates'] = $cands;

		// Compare WordPress's clock with the API's own clock (HTTP Date header).
		$date = wp_remote_retrieve_header($res, 'date');
		if ($date && strtotime($date)) {
			$out['api_clock_skew'] = strtotime($date) - $server_now;
		}

		list($out['verdict'], $out['message']) = self::verdict($det, $out['delta']);
		return $out;
	}

	/**
	 * @param float|int $unix Unix timestamp.
	 */
	private static function fmt_utc($unix)
	{
		return abs($unix) < 253402300799 ? gmdate('Y-m-d H:i:s', (int) $unix) . ' UTC' : 'out of range';
	}

	/**
	 * Classify the gap between the newest reading and the server clock.
	 *
	 * @param array|null $det Timestamp detection result: [unit label, Unix timestamp].
	 * @param int         $delta Difference between the reading and server clock, in seconds.
	 */
	private static function verdict($det, $delta)
	{
		if (! $det) {
			return array('unrecognised', 'The timestamp is not a plausible date (2000-2100) in seconds, milliseconds, microseconds, nanoseconds or Windows FILETIME. See the table of interpretations and report which row matches the current time.');
		}
		if (abs($delta) <= 120) {
			return array('ok', 'The newest reading is within two minutes of this server\'s clock, so the timestamps are being read correctly (unit: ' . $det[0] . ').');
		}
		$nearest = round($delta / 900) * 900;   // time-zone offsets are multiples of 15 minutes
		if (abs($delta) >= 900 && abs($delta - $nearest) <= 90) {
			$h = $delta / 3600;
			return array('offset', sprintf(
				'The newest reading is %s hours %s now, a clean multiple of 15 minutes. That pattern suggests the API clock (the SCADA "OPC observation time") is in local time or another time zone rather than UTC.',
				rtrim(rtrim(number_format(abs($h), 2), '0'), '.'),
				$delta < 0 ? 'behind' : 'ahead of'
			));
		}
		return array('stale', sprintf(
			'The newest reading is %d seconds %s now. The timestamps are readable (unit: %s), so the data itself is old or the clocks differ; check that the turbine feed is live.',
			abs($delta),
			$delta < 0 ? 'behind' : 'ahead of',
			$det[0]
		));
	}

	public function rest_data(WP_REST_Request $r)
	{
		$cat = $this->get_catalogue();
		if (is_wp_error($cat)) {
			return $this->error_response($cat);
		}
		$o = $this->opts();

		// --- Validate everything against the catalogue (this is not an open proxy).
		$fam = $cat['families'][$r['family']] ?? null;
		if (! $fam) {
			return $this->error_response($this->error('ace_bad_family', 'Unknown data set.', 400));
		}
		$res = null;
		foreach ($fam['resolutions'] as $x) {
			if ($x['resolution'] === $r['resolution']) {
				$res = $x;
			}
		}
		if (! $res) {
			return $this->error_response($this->error('ace_bad_resolution', 'Unsupported resolution for this data set.', 400));
		}
		$valid  = wp_list_pluck($fam['fields'], 'name');
		$fields = array_values(array_unique(array_filter(array_map('trim', explode(',', (string) $r['fields'])))));
		if (! $fields || count($fields) > 8 || array_diff($fields, $valid)) {
			return $this->error_response($this->error('ace_bad_fields', 'Unknown measurement.', 400));
		}

		$base = '/v1/sites/' . rawurlencode($o['site_id']);
		if ('asset' === $fam['scope']) {
			$asset = (string) $r['asset'];
			if ('' === $asset) {
				$asset = $fam['assets'][0];
			}
			if (! in_array($asset, $fam['assets'], true)) {
				return $this->error_response($this->error('ace_bad_asset', 'Unknown turbine/asset.', 400));
			}
			$base .= '/assets/' . rawurlencode($asset);
		}
		$base .= '/data/' . rawurlencode($fam['family']);

		$rs     = $res['seconds'];
		$common = array(
			'resolution' => $res['resolution'],
			'fields'     => implode(',', $fields),
		);

		$limit = (int) $r['limit'];
		$span  = (int) $r['span'];
		$ts    = array();
		$ser   = array_fill_keys($fields, array());
		$trunc = false;

		$use_latest = $limit > 0 || ($span > 0 && (int) ceil($span / $rs) + 1 <= $res['max_latest']);
		if ($use_latest) {
			// ---- "Latest N records": the live path.
			$n = $limit > 0 ? $limit : (int) ceil($span / $rs) + 1;
			$n = max(1, min($n, $res['max_latest']));
			$b = $this->upstream($base . '/latest', $common + array('limit' => $n), $rs <= 1 ? 1 : 5);
			if (is_wp_error($b)) {
				$d = $b->get_error_data();
				if ($limit <= 0 && $span > 0 && 400 === (is_array($d) && isset($d['status']) ? (int) $d['status'] : 0)) {
					// The API refused the row count: fall back to the paged range endpoint, whose page size is documented.
					$use_latest = false;
				} else {
					return $this->error_response($b);
				}
			} else {
				$this->merge_page($b, $fields, $ts, $ser);
			}
		}

		if (! $use_latest) {
			// ---- Historical range, paginated sequentially (as the API asks).
			if ($span > 0) {
				// Windows are rounded so repeated requests share one cache entry. 1-second data is "live", so its
				// window moves every 2 s; slower data every 30 s (or its own resolution).
				$bucket = $rs <= 1 ? 2 : max(30, $rs);
				$now    = (int) apply_filters('ace_wind_now', time());   // filterable so the time window can be tested
				$end    = (int) (ceil($now / $bucket) * $bucket);
				$start  = $end - $span;
			} else {
				$start = self::to_iso($r['start']) ? strtotime(self::to_iso($r['start'])) : 0;
				$end   = self::to_iso($r['end']) ? strtotime(self::to_iso($r['end'])) : 0;
			}
			if ($start <= 0 || $end <= $start) {
				return $this->error_response($this->error('ace_bad_range', 'Invalid time range.', 400));
			}
			if (($end - $start) / $rs > self::MAX_POINTS) {
				return $this->error_response($this->error('ace_too_many', 'That period is too long for this resolution.', 400));
			}
			$common += array(
				'start'     => gmdate('Y-m-d\TH:i:s\Z', $start),
				'end'       => gmdate('Y-m-d\TH:i:s\Z', $end),
				'page_size' => max(1, min(5000, $res['max_page'])),
			);
			$cursor = null;
			for ($i = 0; $i < self::MAX_PAGES; $i++) {
				$q = $common;
				if ($cursor) {
					$q['cursor'] = $cursor;
				}
				$b = $this->upstream($base . '/range', $q, $rs <= 1 && $span > 0 ? 2 : 30);
				if (is_wp_error($b)) {
					return $this->error_response($b);
				}
				$this->merge_page($b, $fields, $ts, $ser);
				if (empty($b['page']['has_more']) || empty($b['page']['next_cursor'])) {
					break;
				}
				$cursor = $b['page']['next_cursor'];
				if (self::MAX_PAGES - 1 === $i) {
					$trunc = true;
				}
			}
		}

		$meta = array();
		foreach ($fam['fields'] as $f) {
			if (in_array($f['name'], $fields, true)) {
				$meta[$f['name']] = $f;
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
		return $this->no_cache($resp);
	}

	private function merge_page(array $b, array $fields, array &$ts, array &$ser)
	{
		$bt = (array) ($b['timestamps'] ?? array());
		$n  = count($bt);
		foreach ($bt as $t) {
			$ts[] = self::norm_ts($t);
		}
		foreach ($fields as $f) {
			$col = isset($b['series'][$f]) ? array_values((array) $b['series'][$f]) : array();
			for ($i = 0; $i < $n; $i++) {
				$v            = $col[$i] ?? null;
				$ser[$f][] = is_numeric($v) ? $v + 0 : null;
			}
		}
	}

	/* ---------------------------------------------------------------------
	 * Admin: settings page
	 * ------------------------------------------------------------------- */

	public function action_links(array $links): array
	{
		array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=ace-wind-dashboard')) . '">' . esc_html__('Settings', 'ace-wind-dashboard') . '</a>');
		return $links;
	}

	public function admin_menu()
	{
		add_options_page('ACE Wind Dashboard', 'ACE Wind Dashboard', 'manage_options', 'ace-wind-dashboard', array($this, 'settings_page'));
	}

	public function admin_init()
	{
		register_setting('ace_wind', self::OPT, array('sanitize_callback' => array($this, 'sanitize')));
	}

	public function sanitize(array $in): array
	{
		$d   = $this->opts();
		$out = array();

		$base            = esc_url_raw(trim((string) ($in['api_base'] ?? $d['api_base'])), array('https', 'http'));
		$out['api_base'] = $base ? untrailingslashit($base) : 'https://ace-api.duckdns.org';
		$site            = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($in['site_id'] ?? ''));
		$out['site_id']  = $site ? $site : 'ace';
		$out['rated_kw'] = max(1, (int) ($in['rated_kw'] ?? 4200));
		$out['live_refresh'] = max(1, min(60, (int) ($in['live_refresh'] ?? 2)));
		$tz              = (string) ($in['timezone'] ?? 'Europe/London');
		$out['timezone'] = in_array($tz, timezone_identifiers_list(), true) ? $tz : 'Europe/London';

		$this->clear_cache();
		return $out;
	}

	private function clear_cache()
	{
		global $wpdb;
		$wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_ace\_wind\_%' OR option_name LIKE '\_transient\_timeout\_ace\_wind\_%'"); // phpcs:ignore
		wp_cache_flush();
	}

	public function handle_clear_cache()
	{
		if (! current_user_can('manage_options')) {
			wp_die(esc_html__('Not allowed.', 'ace-wind-dashboard'));
		}
		check_admin_referer('ace_wind_clear_cache');
		$this->clear_cache();
		wp_safe_redirect(add_query_arg('cache-cleared', '1', admin_url('options-general.php?page=ace-wind-dashboard')));
		exit;
	}

	public function settings_page()
	{
		if (! current_user_can('manage_options')) {
			return;
		}
		$o = $this->opts();
?>
		<div class="wrap">
			<h1>ACE Wind Turbine Dashboard</h1>
			<?php if (isset($_GET['cache-cleared'])) : // phpcs:ignore 
			?>
				<div class="notice notice-success is-dismissible">
					<p>Cache cleared.</p>
				</div>
			<?php endif; ?>

			<p>Add the dashboard to any page or post with <code>[ace_wind_dashboard]</code>.</p>

			<form method="post" action="options.php">
				<?php settings_fields('ace_wind'); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="ace_api_base">API base URL</label></th>
						<td><input type="url" id="ace_api_base" class="regular-text" name="<?php echo esc_attr(self::OPT); ?>[api_base]" value="<?php echo esc_attr($o['api_base']); ?>"></td>
					</tr>
					<tr>
						<th scope="row"><label for="ace_site_id">Site ID</label></th>
						<td><input type="text" id="ace_site_id" class="small-text" name="<?php echo esc_attr(self::OPT); ?>[site_id]" value="<?php echo esc_attr($o['site_id']); ?>">
							<p class="description">As listed by <code>/v1/sites</code> (normally <code>ace</code>).</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ace_rated">Turbine rated power (kW)</label></th>
						<td><input type="number" min="1" id="ace_rated" class="small-text" name="<?php echo esc_attr(self::OPT); ?>[rated_kw]" value="<?php echo esc_attr($o['rated_kw']); ?>">
							<p class="description">Used for the "% of rated output" gauge. The ACE turbine is 4.2&nbsp;MW.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ace_live">Live refresh (seconds)</label></th>
						<td><input type="number" min="1" max="60" id="ace_live" class="small-text" name="<?php echo esc_attr(self::OPT); ?>[live_refresh]" value="<?php echo esc_attr($o['live_refresh']); ?>">
							<p class="description">How often each visitor's browser asks for new 1-second data. Responses are cached on your server for 1&nbsp;second, so the API is called at most about once per second however many visitors you have.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ace_tz">Chart time zone</label></th>
						<td><select id="ace_tz" name="<?php echo esc_attr(self::OPT); ?>[timezone]">
								<?php foreach (timezone_identifiers_list() as $tz) : ?>
									<option value="<?php echo esc_attr($tz); ?>" <?php selected($o['timezone'], $tz); ?>><?php echo esc_html($tz); ?></option>
								<?php endforeach; ?>
							</select></td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<hr>
			<h2>Diagnostics</h2>
			<p>Reads the newest record straight from the API and shows how its timestamp is interpreted. Use this if times on the dashboard look wrong.</p>
			<?php
			$diag_url = wp_nonce_url(admin_url('options-general.php?page=ace-wind-dashboard&ace_diag=1'), 'ace_wind_diag');
			if (isset($_GET['ace_diag']) && check_admin_referer('ace_wind_diag')) { // phpcs:ignore
				$this->render_diagnostics($this->diagnose());
			}
			?>
			<p><a class="button" href="<?php echo esc_url($diag_url); ?>">Check timestamps now</a></p>

			<hr>
			<h2>Shortcode options</h2>
			<p><code>[ace_wind_dashboard title="Our turbine" family="site_instantaneous" field="aggregate_active_power" compare="aggregate_wind_speed" range="999" height="420" tiles="yes" controls="yes"]</code></p>
			<ul style="list-style:disc;margin-left:2em">
				<li><code>family</code>, <code>field</code>, <code>compare</code> – initial data set and measurements (names as in the API's <code>/v1/families</code>). Use <code>compare=""</code> for a single line.</li>
				<li><code>range</code> – initial period in seconds (e.g. <code>3600</code> = 1 hour, <code>86400</code> = 24 hours). - Max range: 999 due to API limitations.</li>
				<li><code>tiles="no"</code> hides the live summary tiles; <code>controls="no"</code> hides the pull-down menus.</li>
			</ul>

			<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
				<input type="hidden" name="action" value="ace_wind_clear_cache">
				<?php wp_nonce_field('ace_wind_clear_cache'); ?>
				<?php submit_button('Clear cached API data', 'secondary', 'submit', false); ?>
			</form>

			<p style="margin-top:2em;color:#555">Data: ACE Wind Turbine Data, licensed
				<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>,
				<a href="https://doi.org/10.5281/zenodo.22662372" target="_blank" rel="noopener">doi:10.5281/zenodo.22662372</a>.
				Charts by <a href="https://github.com/leeoniya/uPlot" target="_blank" rel="noopener">uPlot</a> (MIT).
			</p>
		</div>
<?php
	}

	/** Print the result of diagnose() as an admin notice plus a table of interpretations. */
	private function render_diagnostics(array $d)
	{
		if (empty($d['ok'])) {
			echo '<div class="notice notice-error inline"><p>' . esc_html($d['error']) . '</p></div>';
			return;
		}
		$class = 'ok' === $d['verdict'] ? 'notice-success' : 'notice-warning';
		echo '<div class="notice ' . esc_attr($class) . ' inline"><p><strong>' . esc_html(strtoupper($d['verdict'])) . '</strong> – ' . esc_html($d['message']) . '</p></div>';

		echo '<table class="widefat striped" style="max-width:760px"><tbody>';
		$rows = array(
			'Raw timestamps from the API (oldest → newest)' => implode(', ', array_map('strval', $d['raw'])),
			'Detected unit'                                  => $d['unit'] ? $d['unit'] : 'none plausible',
			'Newest reading (UTC)'                           => $d['utc'],
			'Newest reading (' . $this->opts()['timezone'] . ')' => $d['local'],
			'This server\'s clock (UTC)'                     => gmdate('Y-m-d H:i:s', $d['server_now']) . ' UTC',
			'Newest reading minus server clock'              => $d['delta'] . ' s',
		);
		if (isset($d['api_clock_skew'])) {
			$rows['API server clock minus this server'] = $d['api_clock_skew'] . ' s';
		}
		foreach ($rows as $k => $v) {
			echo '<tr><th style="width:42%">' . esc_html($k) . '</th><td>' . esc_html((string) $v) . '</td></tr>';
		}
		echo '</tbody></table>';

		echo '<p><strong>How the newest raw value reads under each encoding</strong> (the right one is within seconds of now):</p>';
		echo '<table class="widefat striped" style="max-width:760px"><thead><tr><th>Encoding</th><th>Date</th><th>Difference from now</th></tr></thead><tbody>';
		foreach ($d['candidates'] as $c) {
			echo '<tr><td>' . esc_html($c['label']) . '</td><td>' . esc_html($c['utc']) . '</td><td>'
				. esc_html(null === $c['delta'] ? '–' : $c['delta'] . ' s') . '</td></tr>';
		}
		echo '</tbody></table>';
	}
}

ACE_Wind_Dashboard::instance();
