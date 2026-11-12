<?php
/** The "ACE Live Reading" block: registration, attribute sanitising and the server-rendered container. */
class LiveReadingBlockTest extends ACE_Wind_TestCase {

	/** @var ACE_Wind_Live_Reading */
	private $block;

	protected function setUp(): void {
		parent::setUp();
		$this->block = new ACE_Wind_Live_Reading( $this->plugin );
	}

	private function config_from( $html ) {
		$this->assertSame( 1, preg_match( '/data-config="([^"]*)"/', $html, $m ), 'data-config present' );
		$cfg = json_decode( html_entity_decode( $m[1], ENT_QUOTES ), true );
		$this->assertIsArray( $cfg );
		return $cfg;
	}

	private function block_json() {
		return json_decode( file_get_contents( dirname( __DIR__, 2 ) . '/blocks/live-reading/block.json' ), true );
	}

	/* ---------- registration ---------- */

	public function test_plugin_creates_the_block_and_hooks_registration_to_init() {
		$hooks = array_filter( ACE_Test_Env::$boot_hooks, function ( $h ) { return 'action' === $h[0] && 'init' === $h[1] && is_array( $h[2] ) && $h[2][0] instanceof ACE_Wind_Live_Reading; } );
		$this->assertCount( 1, $hooks );
	}

	public function test_register_uses_the_block_json_folder_and_a_render_callback() {
		$this->block->register();
		$this->assertCount( 1, ACE_Test_Env::$block_types );
		$reg = ACE_Test_Env::$block_types[0];
		$this->assertStringEndsWith( '/blocks/live-reading', $reg['path'] );
		$this->assertFileExists( $reg['path'] . '/block.json' );
		$this->assertSame( array( $this->block, 'render' ), $reg['args']['render_callback'] );
	}

	public function test_editor_script_receives_the_site_settings_before_it_runs() {
		ACE_Test_Env::$options['ace_wind_options'] = array( 'rated_kw' => 2500, 'live_refresh' => 5, 'timezone' => 'Europe/Paris' );
		$this->block->register();
		list( $handle, $js, $position ) = ACE_Test_Env::$inline_scripts[0];
		$this->assertSame( 'ace-wind-live-reading-editor-script', $handle );
		$this->assertSame( 'before', $position );
		$this->assertStringStartsWith( 'window.ACE_WIND_BLOCK = ', $js );
		$env = json_decode( substr( $js, strlen( 'window.ACE_WIND_BLOCK = ' ), -1 ), true );
		$this->assertSame( array( 'rest' => 'https://example.test/wp-json/ace-wind/v1/', 'ratedKw' => 2500, 'liveRefresh' => 5, 'tz' => 'Europe/Paris' ), $env );
	}

	public function test_block_json_is_valid_and_consistent_with_the_php_whitelists() {
		$j = $this->block_json();
		$this->assertSame( 'ace-wind/live-reading', $j['name'] );
		$this->assertSame( ACE_Wind_Live_Reading::BLOCK, $j['name'] );
		$this->assertSame( 3, $j['apiVersion'] );
		foreach ( array( 'editorScript', 'viewScript', 'style', 'editorStyle' ) as $k ) {
			$this->assertStringStartsWith( 'file:./', $j[ $k ] );
			$this->assertFileExists( dirname( __DIR__, 2 ) . '/blocks/live-reading/' . substr( $j[ $k ], 7 ), "$k file is built and committed" );
		}
		$this->assertFileExists( dirname( __DIR__, 2 ) . '/blocks/live-reading/editor.asset.php' );
	}

	public function test_block_json_attribute_defaults_equal_the_php_defaults() {
		$attrs = array_map( function ( $a ) { return $a['default']; }, $this->block_json()['attributes'] );
		$this->assertEquals( ACE_Wind_Live_Reading::defaults(), $attrs );
	}

	public function test_block_json_attribute_types_match_the_type_of_each_php_default() {
		$expected = array( 'string' => 'is_string', 'number' => 'is_numeric', 'boolean' => 'is_bool' );
		foreach ( $this->block_json()['attributes'] as $name => $attr ) {
			$this->assertArrayHasKey( $attr['type'], $expected, "$name has a supported type" );
			$this->assertTrue( $expected[ $attr['type'] ]( ACE_Wind_Live_Reading::defaults()[ $name ] ), "$name default is a {$attr['type']}" );
		}
	}

	public function test_every_attribute_in_block_json_is_sanitised_by_normalize() {
		$keys = array_keys( $this->block_json()['attributes'] );
		$this->assertEqualsCanonicalizing( $keys, array_keys( ACE_Wind_Live_Reading::normalize( array() ) ) );
	}

	/* ---------- sanitising ---------- */

	public function test_defaults_pass_through_unchanged() {
		$this->assertEquals( ACE_Wind_Live_Reading::defaults(), ACE_Wind_Live_Reading::normalize( array() ) );
	}

	public static function bad_choices() {
		return array(
			'metric'          => array( 'metric', 'drop table', 'power' ),
			'layout'          => array( 'layout', 'sideways', 'left' ),
			'icon'            => array( 'icon', '<script>', 'auto' ),
			'directionFormat' => array( 'directionFormat', 'radians', 'both' ),
		);
	}

	/** @dataProvider bad_choices */
	public function test_unknown_choices_fall_back_to_the_default( $key, $bad, $expected ) {
		$this->assertSame( $expected, ACE_Wind_Live_Reading::normalize( array( $key => $bad ) )[ $key ] );
	}

	public static function good_choices() {
		$cases = array();
		foreach ( ACE_Wind_Live_Reading::METRICS as $m ) { if ( 'custom' !== $m ) { $cases[ "metric $m" ] = array( 'metric', $m ); } }
		foreach ( ACE_Wind_Live_Reading::LAYOUTS as $v ) { $cases[ "layout $v" ] = array( 'layout', $v ); }
		foreach ( ACE_Wind_Live_Reading::ICONS as $v ) { $cases[ "icon $v" ] = array( 'icon', $v ); }
		foreach ( ACE_Wind_Live_Reading::FORMATS as $v ) { $cases[ "format $v" ] = array( 'directionFormat', $v ); }
		return $cases;
	}

	/** @dataProvider good_choices */
	public function test_every_allowed_choice_is_accepted( $key, $value ) {
		$this->assertSame( $value, ACE_Wind_Live_Reading::normalize( array( $key => $value ) )[ $key ] );
	}

	public function test_custom_measurement_needs_both_a_data_set_and_a_field() {
		$n = ACE_Wind_Live_Reading::normalize( array( 'metric' => 'custom', 'family' => 'wecstd', 'field' => 'wind_speed_mean' ) );
		$this->assertSame( array( 'custom', 'wecstd', 'wind_speed_mean' ), array( $n['metric'], $n['family'], $n['field'] ) );

		foreach ( array( array( 'family' => 'wecstd' ), array( 'field' => 'x' ), array() ) as $partial ) {
			$n = ACE_Wind_Live_Reading::normalize( array( 'metric' => 'custom' ) + $partial );
			$this->assertSame( 'power', $n['metric'], 'unfinished custom measurement falls back' );
			$this->assertSame( '', $n['family'] );
		}
	}

	public function test_preset_metrics_ignore_a_stray_family_and_field() {
		$n = ACE_Wind_Live_Reading::normalize( array( 'metric' => 'wind_speed', 'family' => 'wecstd', 'field' => 'x' ) );
		$this->assertSame( array( '', '' ), array( $n['family'], $n['field'] ) );
	}

	public function test_family_and_field_are_reduced_to_safe_key_characters() {
		$n = ACE_Wind_Live_Reading::normalize( array( 'metric' => 'custom', 'family' => 'We cStd"><script>', 'field' => '../x' ) );
		$this->assertSame( 'wecstdscript', $n['family'] );
		$this->assertSame( 'x', $n['field'] );
	}

	public static function numbers() {
		return array(
			'decimals low' => array( 'decimals', -9, -1 ), 'decimals mid' => array( 'decimals', 2, 2 ), 'decimals high' => array( 'decimals', 99, 3 ),
			'decimals text' => array( 'decimals', 'abc', 0 ),
			'size low' => array( 'iconSize', 1, 16 ), 'size mid' => array( 'iconSize', 80, 80 ), 'size high' => array( 'iconSize', 9999, 200 ),
		);
	}

	/** @dataProvider numbers */
	public function test_numbers_are_clamped( $key, $in, $out ) {
		$this->assertSame( $out, ACE_Wind_Live_Reading::normalize( array( $key => $in ) )[ $key ] );
	}

	public function test_booleans_accept_real_booleans_and_their_string_forms() {
		foreach ( array( 'showLabel', 'showDetail', 'showUpdated', 'animate' ) as $k ) {
			$this->assertTrue( ACE_Wind_Live_Reading::normalize( array( $k => true ) )[ $k ] );
			$this->assertTrue( ACE_Wind_Live_Reading::normalize( array( $k => 'true' ) )[ $k ] );
			$this->assertFalse( ACE_Wind_Live_Reading::normalize( array( $k => false ) )[ $k ] );
			$this->assertFalse( ACE_Wind_Live_Reading::normalize( array( $k => 'false' ) )[ $k ], 'the string "false" is false' );
			$this->assertFalse( ACE_Wind_Live_Reading::normalize( array( $k => 'nonsense' ) )[ $k ] );
		}
	}

	public function test_text_is_stripped_and_length_limited() {
		$n = ACE_Wind_Live_Reading::normalize( array( 'label' => '<b>Our</b> <script>x</script>power ' . str_repeat( 'x', 200 ), 'unit' => '<i>kilowatts per hour</i>' ) );
		$this->assertStringNotContainsString( '<', $n['label'] );
		$this->assertSame( 80, mb_strlen( $n['label'] ) );
		$this->assertStringNotContainsString( '<', $n['unit'] );
		$this->assertLessThanOrEqual( 12, mb_strlen( $n['unit'] ) );
	}

	public static function icon_urls() {
		return array(
			'https'        => array( 'https://example.org/wp-content/uploads/turbine.svg', 'https://example.org/wp-content/uploads/turbine.svg' ),
			'http'         => array( 'http://example.org/a.png', 'http://example.org/a.png' ),
			'site-relative'=> array( '/wp-content/uploads/a.svg', '/wp-content/uploads/a.svg' ),
			'javascript'   => array( 'javascript:alert(1)', '' ),
			'data uri'     => array( 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', '' ),
			'protocol-rel' => array( '//evil.example/x.svg', '' ),
			'garbage'      => array( 'not a url', '' ),
		);
	}

	/** @dataProvider icon_urls */
	public function test_icon_url_only_allows_http_https_and_site_relative( $in, $out ) {
		$this->assertSame( $out, ACE_Wind_Live_Reading::normalize( array( 'iconUrl' => $in ) )['iconUrl'] );
	}

	public function test_icon_colour_must_be_a_hex_colour() {
		$this->assertSame( '#1f8a4c', ACE_Wind_Live_Reading::normalize( array( 'iconColor' => '#1f8a4c' ) )['iconColor'] );
		$this->assertSame( '#fff', ACE_Wind_Live_Reading::normalize( array( 'iconColor' => '#fff' ) )['iconColor'] );
		foreach ( array( 'red', 'url(javascript:x)', 'expression(1)', '#12', '#ggg' ) as $bad ) {
			$this->assertSame( '', ACE_Wind_Live_Reading::normalize( array( 'iconColor' => $bad ) )['iconColor'], $bad );
		}
	}

	public function test_non_scalar_attribute_values_cannot_cause_errors() {
		$n = ACE_Wind_Live_Reading::normalize( array( 'family' => array( 'x' ), 'field' => new stdClass(), 'unit' => array(), 'label' => array( 'a' ), 'iconUrl' => array(), 'iconColor' => array(), 'metric' => array( 'power' ) ) );
		$this->assertSame( 'power', $n['metric'] );
		$this->assertSame( '', $n['label'] );
	}

	public function test_unknown_attributes_are_dropped() {
		$this->assertArrayNotHasKey( 'evil', ACE_Wind_Live_Reading::normalize( array( 'evil' => 'x', 'metric' => 'power' ) ) );
	}

	/* ---------- rendering ---------- */

	public function test_render_outputs_a_wrapper_and_a_container_with_the_config() {
		$html = $this->block->render( array( 'metric' => 'wind_speed', 'unit' => 'mph', 'layout' => 'top', 'icon' => 'wind' ) );
		$this->assertStringStartsWith( '<div class="wp-block-ace-wind-live-reading">', $html );
		$this->assertStringContainsString( '<div class="acewd-reading" data-config=', $html );
		$cfg = $this->config_from( $html );
		$this->assertSame( 'wind_speed', $cfg['metric'] );
		$this->assertSame( 'mph', $cfg['unit'] );
		$this->assertSame( 'top', $cfg['layout'] );
		$this->assertSame( 'wind', $cfg['icon'] );
	}

	public function test_config_includes_the_site_wide_settings() {
		ACE_Test_Env::$options['ace_wind_options'] = array( 'rated_kw' => 3000, 'live_refresh' => 4, 'timezone' => 'Asia/Tokyo' );
		$cfg = $this->config_from( $this->block->render( array() ) );
		$this->assertSame( 'https://example.test/wp-json/ace-wind/v1/', $cfg['rest'] );
		$this->assertSame( 3000, $cfg['ratedKw'] );
		$this->assertSame( 4, $cfg['liveRefresh'] );
		$this->assertSame( 'Asia/Tokyo', $cfg['tz'] );
	}

	public function test_config_is_sanitised_before_it_reaches_the_page() {
		$html = $this->block->render( array( 'metric' => '"><script>alert(1)</script>', 'label' => '<img src=x onerror=alert(1)>Hi', 'iconUrl' => 'javascript:alert(1)' ) );
		$this->assertStringNotContainsString( '<script>', $html );
		$this->assertStringNotContainsString( '<img', $html );
		$cfg = $this->config_from( $html );
		$this->assertSame( 'power', $cfg['metric'] );
		$this->assertSame( '', $cfg['iconUrl'] );
	}

	public function test_render_has_a_server_side_placeholder_with_the_default_label_and_a_noscript_note() {
		$html = $this->block->render( array( 'metric' => 'rotor_speed' ) );
		$this->assertStringContainsString( '<div class="acewd-r__label">Rotor speed</div>', $html );
		$this->assertStringContainsString( '<div class="acewd-r__value">–</div>', $html );
		$this->assertStringContainsString( '<noscript>', $html );
	}

	public function test_placeholder_uses_the_custom_label_and_respects_show_label() {
		$this->assertStringContainsString( '>Our turbine<', $this->block->render( array( 'label' => 'Our turbine' ) ) );
		$this->assertStringNotContainsString( 'acewd-r__label', $this->block->render( array( 'showLabel' => false ) ) );
	}

	public function test_placeholder_label_is_escaped() {
		$html = $this->block->render( array( 'label' => 'Fish & chips "ok"' ) );
		$this->assertStringContainsString( 'Fish &amp; chips &quot;ok&quot;', $html );
	}

	public function test_no_live_value_is_baked_into_the_html_so_page_caches_cannot_freeze_it() {
		$html = $this->block->render( array() );
		$this->assertSame( array(), ACE_Test_Env::$http_calls, 'rendering makes no API call' );
		$this->assertStringNotContainsString( 'kW', $html );
	}

	public function test_render_tolerates_missing_or_odd_arguments() {
		$this->assertStringContainsString( 'acewd-reading', $this->block->render() );
		$this->assertStringContainsString( 'acewd-reading', $this->block->render( null ) );
	}
}
