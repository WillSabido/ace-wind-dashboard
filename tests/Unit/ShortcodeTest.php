<?php
class ShortcodeTest extends ACE_Wind_TestCase
{

	private function render($atts = array())
	{
		return $this->plugin->shortcode($atts);
	}

	/** Extract and decode the data-config JSON from the rendered container. */
	private function config($html)
	{
		$this->assertSame(1, preg_match('/data-config="([^"]*)"/', $html, $m), 'data-config attribute present');
		$cfg = json_decode(html_entity_decode($m[1], ENT_QUOTES), true);
		$this->assertIsArray($cfg, 'config is valid JSON');
		return $cfg;
	}

	public function test_renders_container_with_loading_and_noscript_fallbacks()
	{
		$html = $this->render();
		$this->assertStringStartsWith('<div class="acewd"', $html);
		$this->assertStringContainsString('<noscript>', $html);
		$this->assertStringContainsString('acewd-loading', $html);
	}

	public function test_default_config()
	{
		$c = $this->config($this->render());
		$this->assertSame('site_instantaneous', $c['family']);
		$this->assertSame('aggregate_active_power', $c['field']);
		$this->assertSame('aggregate_wind_speed', $c['compare']);
		$this->assertSame(1800, $c['range']);
		$this->assertSame(420, $c['height']);
		$this->assertTrue($c['tiles']);
		$this->assertTrue($c['controls']);
		$this->assertSame(4200, $c['ratedKw']);
		$this->assertSame(2, $c['liveRefresh']);
		$this->assertSame('Europe/London', $c['tz']);
		$this->assertSame('https://example.test/wp-json/ace-wind/v1/', $c['rest']);
	}

	public function test_site_settings_flow_into_the_config()
	{
		ACE_Test_Env::$options['ace_wind_options'] = array('rated_kw' => 2500, 'live_refresh' => 5, 'timezone' => 'Europe/Paris');
		$c = $this->config($this->render());
		$this->assertSame(2500, $c['ratedKw']);
		$this->assertSame(5, $c['liveRefresh']);
		$this->assertSame('Europe/Paris', $c['tz']);
	}

	public function test_attributes_override_defaults()
	{
		$c = $this->config($this->render(array(
			'family' => 'wecstd',
			'field' => 'wind_speed_mean',
			'compare' => '',
			'range' => '86400',
			'height' => '500',
			'tiles' => 'no',
			'controls' => 'NO',
			'title' => 'My turbine',
		)));
		$this->assertSame('wecstd', $c['family']);
		$this->assertSame('wind_speed_mean', $c['field']);
		$this->assertSame('', $c['compare']);
		$this->assertSame(86400, $c['range']);
		$this->assertSame(500, $c['height']);
		$this->assertFalse($c['tiles']);
		$this->assertFalse($c['controls'], 'yes/no is case-insensitive');
		$this->assertSame('My turbine', $c['title']);
	}

	public static function height_cases()
	{
		return array('tiny' => array(10, 240), 'min' => array(240, 240), 'mid' => array(600, 600), 'max' => array(900, 900), 'huge' => array(5000, 900), 'junk' => array('abc', 240));
	}

	/** @dataProvider height_cases */
	public function test_height_is_clamped($in, $expected)
	{
		$this->assertSame($expected, $this->config($this->render(array('height' => $in)))['height']);
	}

	public function test_range_has_a_minimum_of_sixty_seconds()
	{
		$this->assertSame(60, $this->config($this->render(array('range' => 5)))['range']);
		$this->assertSame(60, $this->config($this->render(array('range' => -100)))['range']);
	}

	public function test_keys_and_title_are_sanitised_and_output_is_attribute_safe()
	{
		$html = $this->render(array('family' => 'Site_Instantaneous"><script>', 'title' => '<b>Hi</b> "quoted"'));
		$this->assertStringNotContainsString('<script>', $html);
		$c = $this->config($html);
		$this->assertSame('site_instantaneousscript', $c['family']);
		$this->assertSame('Hi "quoted"', $c['title']);
	}

	public function test_assets_are_enqueued_only_when_the_shortcode_renders()
	{
		$this->assertSame(array(), array_filter(ACE_Test_Env::$enqueued, function ($e) {
			return in_array($e[0], array('style', 'script'), true);
		}));
		$this->render();
		$this->assertContains(array('style', 'ace-wind-dashboard'), ACE_Test_Env::$enqueued);
		$this->assertContains(array('script', 'ace-wind-dashboard'), ACE_Test_Env::$enqueued);
	}

	public function test_asset_registration_registers_chart_library_and_dashboard()
	{
		$this->plugin->register_assets();
		foreach (array(array('register_style', 'uplot'), array('register_script', 'uplot'), array('register_style', 'ace-wind-dashboard'), array('register_script', 'ace-wind-dashboard')) as $e) {
			$this->assertContains($e, ACE_Test_Env::$enqueued);
		}
	}
}
