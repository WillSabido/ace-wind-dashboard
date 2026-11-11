<?php

use PHPUnit\Framework\TestCase;

/**
 * Shared fixtures: a fake ACE API (families, assets, latest, range) behind the stubbed
 * wp_safe_remote_get(), plus helpers to call the plugin's REST handlers.
 */
/** @noinspection PhpUndefinedClassInspection PHPUnit provides this base class at test runtime. */
abstract class ACE_Wind_TestCase extends TestCase
{

	/** @var ACE_Wind_Dashboard */
	protected $plugin;

	/** Mutable fixtures; tests tweak these before calling the plugin. */
	protected $families;
	protected $assets;
	/** Pages returned by /range (each: array( 'timestamps' => [], 'series' => [] )). Null = auto-generate. */
	protected $range_pages = null;
	/** If true, /range always reports has_more (to test the page cap). */
	protected $range_endless = false;
	/** Timestamp unit the fake API uses: 1 = seconds, 1000 = milliseconds. */
	protected $ts_unit = 1000;
	protected $base_ts = 1790000000;

	protected function setUp(): void
	{
		ACE_Test_Env::reset();
		$this->plugin   = ACE_Wind_Dashboard::instance();
		$this->families = self::default_families();
		$this->assets   = self::default_assets();
		$this->range_pages = null;
		$this->range_endless = false;
		$this->ts_unit = 1000;
		ACE_Test_Env::$http = array($this, 'route');
	}

	/* ---------- fixtures ---------- */

	public static function cap($res, $page = 1000, $latest = 2000, $refresh = 1)
	{
		return array(
			'resolution'                  => $res,
			'maximum_page_records'        => $page,
			'maximum_latest_records'      => $latest,
			'recommended_refresh_seconds' => $refresh,
		);
	}

	public static function default_families()
	{
		return array(
			array(
				'family' => 'site_instantaneous',
				'public' => true,
				'scope' => 'site',
				'compatible_asset_types' => array(),
				'capabilities' => array(self::cap('1s', 1000, 2000, 1), self::cap('60s', 2000, 2000, 60)),
				'fields' => array(
					array('name' => 'aggregate_active_power', 'display_name' => 'Total active power', 'unit' => 'kW'),
					array('name' => 'aggregate_wind_speed', 'display_name' => 'Wind speed', 'unit' => 'm/s'),
					array('name' => 'sample_count', 'display_name' => 'Sample count'),
				),
			),
			array(
				'family' => 'wecstd',
				'public' => true,
				'scope' => 'asset',
				'compatible_asset_types' => array('wec'),
				'capabilities' => array(self::cap('10m', 5000, 2000, 300)),
				'fields' => array(
					array('name' => 'wind_speed_mean', 'display_name' => 'Mean wind speed', 'unit' => 'm/s'),
					array('name' => 'active_power_mean', 'display_name' => 'Mean active power', 'unit' => 'kW'),
				),
			),
			// Should all be filtered out of the catalogue:
			array('family' => 'site_configuration', 'public' => true, 'scope' => 'site', 'capabilities' => array(), 'fields' => array(array('name' => 'x'))),
			array('family' => 'private_family', 'public' => false, 'scope' => 'site', 'capabilities' => array(self::cap('1s')), 'fields' => array(array('name' => 'x'))),
			array('family' => 'orphan_asset_family', 'public' => true, 'scope' => 'asset', 'compatible_asset_types' => array('gearbox'), 'capabilities' => array(self::cap('1s')), 'fields' => array(array('name' => 'x'))),
		);
	}

	public static function default_assets()
	{
		return array(
			array('id' => 'wec1', 'display_name' => 'ACE Turbine', 'asset_type' => 'wec', 'is_active' => true),
			array('id' => 'wec_old', 'display_name' => 'Decommissioned', 'asset_type' => 'wec', 'is_active' => false),
			array('id' => 'ctrl1', 'display_name' => 'Controller', 'asset_type' => 'site_controller', 'is_active' => true),
		);
	}

	/** Build an API-shaped page of $n rows for the requested fields. */
	protected function make_page(array $fields, $n, $offset = 0, $has_more = false, $cursor = null)
	{
		$ts = array();
		$series = array_fill_keys($fields, array());
		for ($i = 0; $i < $n; $i++) {
			$ts[] = ($this->base_ts + $offset + $i) * $this->ts_unit;
			foreach ($fields as $f) {
				$series[$f][] = round(1.5 + $offset + $i, 1);
			}
		}
		return array(
			'timestamps' => $ts,
			'series'     => $series,
			'page'       => array('has_more' => $has_more, 'next_cursor' => $cursor),
			'attribution' => array('dataset' => 'should be stripped before caching'),
		);
	}

	protected function ok($body)
	{
		return array('code' => 200, 'body' => json_encode($body), 'headers' => array());
	}

	/** The fake API router (installed as the HTTP handler). */
	public function route($url)
	{
		$path = parse_url($url, PHP_URL_PATH);
		parse_str((string) parse_url($url, PHP_URL_QUERY), $q);

		if (substr($path, -12) === '/v1/families') {
			return $this->ok(array('families' => $this->families));
		}
		if (preg_match('#/v1/sites/[^/]+/assets$#', $path)) {
			return $this->ok(array('assets' => $this->assets));
		}
		$fields = isset($q['fields']) ? explode(',', $q['fields']) : array();

		if (substr($path, -7) === '/latest') {
			$n = min(3, (int) ($q['limit'] ?? 3));
			return $this->ok($this->make_page($fields, $n));
		}
		if (substr($path, -6) === '/range') {
			$idx = isset($q['cursor']) ? (int) substr($q['cursor'], 1) : 0;
			if ($this->range_endless) {
				return $this->ok($this->make_page($fields, 1, $idx, true, 'p' . ($idx + 1)));
			}
			if (is_array($this->range_pages)) {
				$page = $this->range_pages[$idx];
				$more = $idx < count($this->range_pages) - 1;
				return $this->ok($page + array('page' => array('has_more' => $more, 'next_cursor' => $more ? 'p' . ($idx + 1) : null)));
			}
			return $this->ok($this->make_page($fields, 2));
		}
		return array('code' => 404, 'body' => '{"error":{"message":"not found"}}', 'headers' => array());
	}

	/* ---------- helpers ---------- */

	protected function data(array $params)
	{
		return $this->plugin->rest_data(new WP_REST_Request($params));
	}

	protected function live_params(array $over = array())
	{
		return $over + array('family' => 'site_instantaneous', 'resolution' => '1s', 'fields' => 'aggregate_active_power', 'span' => 600);
	}

	/** Last upstream URL as [ path, query-array ]. */
	protected function last_call()
	{
		$url = end(ACE_Test_Env::$http_calls);
		parse_str((string) parse_url($url, PHP_URL_QUERY), $q);
		return array(parse_url($url, PHP_URL_PATH), $q);
	}

	protected function calls_matching($needle)
	{
		return array_values(array_filter(ACE_Test_Env::$http_calls, function ($u) use ($needle) {
			return strpos($u, $needle) !== false;
		}));
	}

	protected function assertErrorResponse($resp, $status, $code = null)
	{
		$this->assertInstanceOf(WP_REST_Response::class, $resp);
		$this->assertSame($status, $resp->status, 'HTTP status');
		$this->assertArrayHasKey('error', $resp->data);
		if ($code) {
			$this->assertSame($code, $resp->data['code']);
		}
	}
}
