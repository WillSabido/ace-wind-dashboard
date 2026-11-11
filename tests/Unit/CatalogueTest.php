<?php

/** The catalogue drives the pull-down menus and is the whitelist for data requests. */
class CatalogueTest extends ACE_Wind_TestCase
{

	private function catalogue()
	{
		$resp = $this->plugin->rest_catalogue();
		$this->assertSame(200, $resp->status);
		return $resp->data;
	}

	private function family($cat, $name)
	{
		foreach ($cat['families'] as $f) {
			if ($f['family'] === $name) {
				return $f;
			}
		}
		return null;
	}

	public function test_non_public_empty_and_orphan_families_are_excluded()
	{
		$names = array_column($this->catalogue()['families'], 'family');
		$this->assertSame(array('site_instantaneous', 'wecstd'), $names);
	}

	public function test_sample_count_field_is_hidden()
	{
		$fields = array_column($this->family($this->catalogue(), 'site_instantaneous')['fields'], 'name');
		$this->assertSame(array('aggregate_active_power', 'aggregate_wind_speed'), $fields);
	}

	public function test_field_metadata_is_mapped()
	{
		$f = $this->family($this->catalogue(), 'site_instantaneous')['fields'][0];
		$this->assertSame(array('name' => 'aggregate_active_power', 'label' => 'Total active power', 'unit' => 'kW'), $f);
	}

	public function test_inactive_assets_are_dropped_and_asset_family_lists_matching_assets_only()
	{
		$cat = $this->catalogue();
		$this->assertEqualsCanonicalizing(array('wec1', 'ctrl1'), array_column($cat['assets'], 'id'));
		$this->assertSame(array('wec1'), $this->family($cat, 'wecstd')['assets']);
		$this->assertSame(array(), $this->family($cat, 'site_instantaneous')['assets']);
	}

	public function test_known_families_get_friendly_labels_and_order_unknown_ones_follow()
	{
		$this->families[] = array(
			'family' => 'brand_new',
			'public' => true,
			'scope' => 'site',
			'display_name' => 'Brand new data',
			'capabilities' => array(self::cap('60s')),
			'fields' => array(array('name' => 'a', 'display_name' => 'A')),
		);
		// Put a known family *after* the unknown one in the API response to prove ordering is ours.
		$this->families = array_reverse($this->families);
		$cat   = $this->catalogue();
		$names = array_column($cat['families'], 'family');
		$this->assertSame(array('site_instantaneous', 'wecstd', 'brand_new'), $names);
		$this->assertSame('Site – live power & wind', $cat['families'][0]['label']);
		$this->assertSame('Brand new data', $cat['families'][2]['label'], 'Unknown family falls back to API display_name');
	}

	public function test_resolutions_are_sorted_with_seconds_and_defaults()
	{
		$this->families = array(array(
			'family' => 'wecstd',
			'public' => true,
			'scope' => 'site',
			'capabilities' => array(
				array('resolution' => 'daily'),
				array('resolution' => '10m'),
				array('resolution' => '60s'),
				array('resolution' => 'bogus'), // ignored
			),
			'fields' => array(array('name' => 'a')),
		));
		$res = $this->catalogue()['families'][0]['resolutions'];
		$this->assertSame(array('60s', '10m', 'daily'), array_column($res, 'resolution'));
		$this->assertSame(array(60, 600, 86400), array_column($res, 'seconds'));
		$this->assertSame(1000, $res[0]['max_page'], 'default page size');
		$this->assertSame(2000, $res[0]['max_latest'], 'default latest limit');
		$this->assertSame(60, $res[0]['refresh'], 'refresh defaults to the resolution');
	}

	public function test_field_without_label_falls_back_to_its_name()
	{
		$this->families = array(array(
			'family' => 'x',
			'public' => true,
			'scope' => 'site',
			'capabilities' => array(self::cap('1s')),
			'fields' => array(array('name' => 'raw_name')),
		));
		$f = $this->catalogue()['families'][0]['fields'][0];
		$this->assertSame('raw_name', $f['label']);
		$this->assertSame('', $f['unit']);
	}

	public function test_empty_catalogue_is_a_502()
	{
		$this->families = array();
		$this->assertErrorResponse($this->plugin->rest_catalogue(), 502, 'ace_empty_catalogue');
	}

	public function test_upstream_failure_is_reported_as_502()
	{
		ACE_Test_Env::$http = function () {
			return array('code' => 500, 'body' => 'oops', 'headers' => array());
		};
		$this->assertErrorResponse($this->plugin->rest_catalogue(), 502);
	}

	public function test_catalogue_is_cached_so_repeat_calls_do_not_hit_the_api()
	{
		$this->plugin->rest_catalogue();
		$after_first = count(ACE_Test_Env::$http_calls);
		$this->assertSame(2, $after_first, 'one call for families, one for assets');
		$this->plugin->rest_catalogue();
		$this->assertCount($after_first, ACE_Test_Env::$http_calls);
	}

	public function test_catalogue_response_is_publicly_cacheable()
	{
		$this->assertSame('public, max-age=300', $this->plugin->rest_catalogue()->headers['Cache-Control']);
	}

	public function test_uses_configured_api_base_and_site()
	{
		ACE_Test_Env::$options['ace_wind_options'] = array('api_base' => 'https://api.example.org/', 'site_id' => 'other');
		$this->plugin->rest_catalogue();
		$this->assertSame('https://api.example.org/v1/families', ACE_Test_Env::$http_calls[0]);
		$this->assertSame('https://api.example.org/v1/sites/other/assets', ACE_Test_Env::$http_calls[1]);
	}
}
