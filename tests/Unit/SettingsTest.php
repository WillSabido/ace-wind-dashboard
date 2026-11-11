<?php
class SettingsTest extends ACE_Wind_TestCase
{

	public function test_defaults()
	{
		$o = $this->plugin->opts();
		$this->assertSame('https://ace-api.duckdns.org', $o['api_base']);
		$this->assertSame('ace', $o['site_id']);
		$this->assertSame(4200, $o['rated_kw']);
		$this->assertSame(2, $o['live_refresh']);
		$this->assertSame('Europe/London', $o['timezone']);
	}

	public function test_saved_options_override_defaults_but_keep_missing_ones()
	{
		ACE_Test_Env::$options['ace_wind_options'] = array('site_id' => 'other');
		$o = $this->plugin->opts();
		$this->assertSame('other', $o['site_id']);
		$this->assertSame(4200, $o['rated_kw']);
	}

	public function test_sanitize_accepts_valid_input_and_trims_trailing_slash()
	{
		$out = $this->plugin->sanitize(array(
			'api_base' => ' https://api.example.org/ ',
			'site_id' => 'site-1_b',
			'rated_kw' => '3000',
			'live_refresh' => '10',
			'timezone' => 'America/New_York',
		));
		$this->assertSame(array(
			'api_base' => 'https://api.example.org',
			'site_id' => 'site-1_b',
			'rated_kw' => 3000,
			'live_refresh' => 10,
			'timezone' => 'America/New_York',
		), $out);
	}

	public static function bad_urls()
	{
		return array('javascript' => array('javascript:alert(1)'), 'ftp' => array('ftp://example.org'), 'garbage' => array('not a url'), 'empty' => array(''));
	}

	/** @dataProvider bad_urls */
	public function test_sanitize_rejects_bad_api_urls_and_falls_back_to_default($url)
	{
		$this->assertSame('https://ace-api.duckdns.org', $this->plugin->sanitize(array('api_base' => $url))['api_base']);
	}

	public function test_sanitize_strips_unsafe_characters_from_site_id()
	{
		$this->assertSame('acedrop', $this->plugin->sanitize(array('site_id' => 'ace/../; drop'))['site_id']);
		$this->assertSame('ace', $this->plugin->sanitize(array('site_id' => '///'))['site_id'], 'empty result falls back');
	}

	public static function refresh_cases()
	{
		return array('zero' => array(0, 1), 'negative' => array(-5, 1), 'normal' => array(5, 5), 'huge' => array(9999, 60), 'text' => array('abc', 1));
	}

	/** @dataProvider refresh_cases */
	public function test_live_refresh_is_clamped($in, $expected)
	{
		$this->assertSame($expected, $this->plugin->sanitize(array('live_refresh' => $in))['live_refresh']);
	}

	public function test_rated_power_is_at_least_one()
	{
		$this->assertSame(1, $this->plugin->sanitize(array('rated_kw' => 0))['rated_kw']);
		$this->assertSame(1, $this->plugin->sanitize(array('rated_kw' => -10))['rated_kw']);
	}

	public function test_invalid_timezone_falls_back_to_london()
	{
		$this->assertSame('Europe/London', $this->plugin->sanitize(array('timezone' => 'Mars/Olympus'))['timezone']);
	}

	public function test_saving_settings_flushes_cached_api_data()
	{
		$this->plugin->sanitize(array());
		$sql = implode(' ', $GLOBALS['wpdb']->queries);
		$this->assertStringContainsString('DELETE FROM wp_options', $sql);
		$this->assertStringContainsString('ace', $sql);
		$this->assertSame(1, ACE_Test_Env::$cache_flushes);
	}

	public function test_uninstall_removes_options_and_cached_data()
	{
		define('WP_UNINSTALL_PLUGIN', true);
		require dirname(__DIR__, 2) . '/uninstall.php';
		$this->assertContains('ace_wind_options', ACE_Test_Env::$deleted_options);
		$this->assertNotEmpty($GLOBALS['wpdb']->queries);
		$this->assertStringContainsString('ace', $GLOBALS['wpdb']->queries[0]);
	}
}
