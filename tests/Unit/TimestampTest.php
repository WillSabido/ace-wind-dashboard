<?php
/** The API only says "integer" for timestamps, so the plugin works out the unit itself. */
class TimestampTest extends ACE_Wind_TestCase {

	private function norm( $raw ) {
		$m = new ReflectionMethod( ACE_Wind_Dashboard::class, 'norm_ts' );
		$m->setAccessible( true );
		return $m->invoke( null, $raw );
	}

	/** The same instant (2026-09-21 ~ 13:20 UTC) written in every supported encoding. */
	public static function encodings() {
		$s = 1790000000;
		return array(
			'seconds'      => array( $s, 'seconds' ),
			'milliseconds' => array( $s * 1000, 'milliseconds' ),
			'microseconds' => array( $s * 1000000, 'microseconds' ),
			'nanoseconds'  => array( $s * 1000000000, 'nanoseconds' ),
			'filetime'     => array( ( $s + 11644473600 ) * 10000000, 'filetime' ),
		);
	}

	/** @dataProvider encodings */
	public function test_every_supported_unit_normalises_to_the_same_unix_seconds( $raw, $unit ) {
		$this->assertEqualsWithDelta( 1790000000, $this->norm( $raw ), 1.0 );
		$this->assertSame( $unit, ACE_Wind_Dashboard::detect_ts( $raw )[0] );
	}

	public function test_fractional_seconds_are_kept() {
		$this->assertEqualsWithDelta( 1790000000.5, $this->norm( 1790000000.5 ), 0.001 );
	}

	public static function window_edges() {
		return array(
			'start of 2000' => array( 946684800, true ),
			'just before'   => array( 946684799, false ),
			'end of 2100'   => array( 4102444800, true ),
			'just after'    => array( 4102444801, false ),
		);
	}

	/** @dataProvider window_edges */
	public function test_plausibility_window_is_2000_to_2100( $raw, $recognised ) {
		$this->assertSame( $recognised, null !== ACE_Wind_Dashboard::detect_ts( $raw ) );
	}

	public function test_implausible_values_fall_back_to_the_old_seconds_or_milliseconds_guess() {
		$this->assertSame( 100.0, $this->norm( 100 ) );                 // tiny: treated as seconds
		$this->assertEqualsWithDelta( 5.0e8, $this->norm( 5.0e11 ), 1 ); // 1985 in ms: treated as ms
		$this->assertNull( ACE_Wind_Dashboard::detect_ts( 123 ) );
	}

	public static function units() {
		return array( 'seconds' => array( 1 ), 'milliseconds' => array( 1000 ), 'microseconds' => array( 1000000 ), 'nanoseconds' => array( 1000000000 ) );
	}

	/** @dataProvider units */
	public function test_rest_data_returns_unix_seconds_whatever_the_api_unit( $mult ) {
		ACE_Test_Env::$http = function ( $url ) use ( $mult ) {
			if ( strpos( $url, '/latest' ) === false ) { return $this->route( $url ); }
			return $this->ok( array(
				'timestamps' => array( 1790000000 * $mult, 1790000001 * $mult ),
				'series'     => array( 'aggregate_active_power' => array( 1, 2 ) ),
			) );
		};
		$ts = $this->data( $this->live_params() )->data['timestamps'];
		$this->assertEqualsWithDelta( 1790000000, $ts[0], 1.0 );
		$this->assertEqualsWithDelta( 1790000001, $ts[1], 1.0 );
	}
}
