<?php
/** The settings-page diagnostics: reads a real record and explains what the timestamp means. */
class DiagnoseTest extends ACE_Wind_TestCase {

	/** Make the API's newest record $age seconds old, written as $unit_mult x seconds. */
	private function feed( $age, $unit_mult = 1, array $headers = array() ) {
		ACE_Test_Env::$http = function ( $url ) use ( $age, $unit_mult, $headers ) {
			$t = ( time() - $age ) * $unit_mult;
			return array(
				'code'    => 200,
				'body'    => json_encode( array( 'timestamps' => array( $t - $unit_mult, $t ), 'series' => array( 'aggregate_active_power' => array( 1, 2 ) ) ) ),
				'headers' => $headers,
			);
		};
		return $this->plugin->diagnose();
	}

	public function test_healthy_feed_is_ok() {
		$d = $this->feed( 1 );
		$this->assertTrue( $d['ok'] );
		$this->assertSame( 'ok', $d['verdict'] );
		$this->assertSame( 'seconds', $d['unit'] );
		$this->assertEqualsWithDelta( 0, $d['delta'], 5 );
		$this->assertMatchesRegularExpression( '/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$/', $d['utc'] );
		$this->assertStringContainsString( 'read correctly', $d['message'] );
	}

	public static function other_units() {
		return array( 'ms' => array( 1000, 'milliseconds' ), 'us' => array( 1000000, 'microseconds' ), 'ns' => array( 1000000000, 'nanoseconds' ) );
	}

	/** @dataProvider other_units */
	public function test_other_units_are_detected_and_still_judged_ok( $mult, $label ) {
		$d = $this->feed( 1, $mult );
		$this->assertSame( 'ok', $d['verdict'] );
		$this->assertSame( $label, $d['unit'] );
		$this->assertEqualsWithDelta( 0, $d['delta'], 5 );
	}

	public static function offsets() {
		return array(
			'one hour behind (BST read as UTC)' => array( 3600, 'behind' ),
			'two hours behind'                  => array( 7200, 'behind' ),
			'one hour ahead'                    => array( -3600, 'ahead of' ),
			'half-hour zone'                    => array( 5400, 'behind' ),
		);
	}

	/** @dataProvider offsets */
	public function test_clean_multiples_of_15_minutes_are_reported_as_a_time_zone_offset( $age, $direction ) {
		$d = $this->feed( $age );
		$this->assertSame( 'offset', $d['verdict'] );
		$this->assertStringContainsString( $direction, $d['message'] );
		$this->assertStringContainsString( 'time zone', $d['message'] );
	}

	public function test_an_irregular_gap_means_stale_data_not_a_time_zone() {
		$d = $this->feed( 3100 );              // 51m40s: not a multiple of 15 minutes
		$this->assertSame( 'stale', $d['verdict'] );
		$this->assertStringContainsString( 'seconds behind', $d['message'] );
		$this->assertSame( 'seconds', $d['unit'] );
	}

	public function test_a_small_lag_under_15_minutes_is_stale_not_offset() {
		$this->assertSame( 'stale', $this->feed( 300 )['verdict'] );
	}

	public function test_an_unrecognisable_timestamp_is_reported_as_such() {
		ACE_Test_Env::$http = function () {
			return $this->ok( array( 'timestamps' => array( 5, 7 ), 'series' => array() ) );
		};
		$d = $this->plugin->diagnose();
		$this->assertTrue( $d['ok'] );
		$this->assertSame( 'unrecognised', $d['verdict'] );
		$this->assertNull( $d['unit'] );
	}

	public function test_it_lists_how_the_raw_value_reads_under_every_encoding() {
		$d = $this->feed( 1 );
		$labels = array_column( $d['candidates'], 'label' );
		$this->assertSame( array( 'seconds', 'milliseconds', 'microseconds', 'nanoseconds', 'filetime', 'labview (1904 epoch, s)' ), $labels );
		$by = array_column( $d['candidates'], 'delta', 'label' );
		$this->assertEqualsWithDelta( 0, $by['seconds'], 5, 'the right encoding is within seconds of now' );
		$this->assertGreaterThan( 86400 * 365, abs( $by['milliseconds'] ), 'wrong encodings are years out' );
	}

	public function test_a_labview_1904_epoch_is_visible_in_the_table_even_though_it_is_not_auto_corrected() {
		ACE_Test_Env::$http = function () {
			$t = time() + 2082844800;           // the same instant counted from 1904
			return $this->ok( array( 'timestamps' => array( $t ), 'series' => array() ) );
		};
		$d  = $this->plugin->diagnose();
		$by = array_column( $d['candidates'], 'delta', 'label' );
		$this->assertEqualsWithDelta( 0, $by['labview (1904 epoch, s)'], 5 );
		$this->assertNotSame( 'ok', $d['verdict'] );
	}

	public function test_shows_local_time_in_the_configured_zone() {
		ACE_Test_Env::$options['ace_wind_options'] = array( 'timezone' => 'Asia/Tokyo' );
		$this->assertStringEndsWith( 'JST', $this->feed( 1 )['local'] );
	}

	public function test_reports_clock_skew_between_this_server_and_the_api() {
		$api_date = gmdate( 'D, d M Y H:i:s', time() - 600 ) . ' GMT';
		$d = $this->feed( 1, 1, array( 'date' => $api_date ) );
		$this->assertEqualsWithDelta( -600, $d['api_clock_skew'], 5 );
		$this->assertArrayNotHasKey( 'api_clock_skew', $this->feed( 1 ) );
	}

	public function test_it_bypasses_the_cache_and_asks_for_a_few_recent_records() {
		$this->feed( 1 );
		$this->feed( 1 );
		$this->assertCount( 2, ACE_Test_Env::$http_calls );
		$this->assertStringContainsString( '/v1/sites/ace/data/site_instantaneous/latest?resolution=1s&fields=aggregate_active_power&limit=3', ACE_Test_Env::$http_calls[0] );
	}

	public function test_failures_are_reported_not_thrown() {
		ACE_Test_Env::$http = function () { return new WP_Error( 'x', 'cURL error 28: timeout' ); };
		$d = $this->plugin->diagnose();
		$this->assertFalse( $d['ok'] );
		$this->assertStringContainsString( 'timeout', $d['error'] );

		ACE_Test_Env::$http = function () { return array( 'code' => 503, 'body' => '', 'headers' => array() ); };
		$this->assertStringContainsString( '503', $this->plugin->diagnose()['error'] );

		ACE_Test_Env::$http = function () { return $this->ok( array( 'timestamps' => array(), 'series' => array() ) ); };
		$this->assertStringContainsString( 'no records', $this->plugin->diagnose()['error'] );
	}

	public function test_the_settings_page_renders_every_outcome_without_error_and_escapes_output() {
		$m = new ReflectionMethod( ACE_Wind_Dashboard::class, 'render_diagnostics' );
		$m->setAccessible( true );

		$this->feed( 1 );
		ob_start(); $m->invoke( $this->plugin, $this->feed( 1 ) ); $ok = ob_get_clean();
		$this->assertStringContainsString( 'notice-success', $ok );
		$this->assertStringContainsString( 'labview', $ok );

		ob_start(); $m->invoke( $this->plugin, $this->feed( 3600 ) ); $warn = ob_get_clean();
		$this->assertStringContainsString( 'notice-warning', $warn );
		$this->assertStringContainsString( 'OFFSET', $warn );

		ob_start(); $m->invoke( $this->plugin, array( 'ok' => false, 'error' => '<script>x</script>' ) ); $err = ob_get_clean();
		$this->assertStringContainsString( 'notice-error', $err );
		$this->assertStringNotContainsString( '<script>', $err );
	}
}
