<?php

/** The "live" path: GET .../latest. */
class DataLatestTest extends ACE_Wind_TestCase
{

	public function test_span_within_latest_limit_uses_latest_with_one_extra_row()
	{
		$resp = $this->data($this->live_params(array('span' => 1800)));
		$this->assertSame(200, $resp->status);
		list($path, $q) = $this->last_call();
		$this->assertStringEndsWith('/latest', $path);
		$this->assertSame('1801', $q['limit']);
		$this->assertSame('1s', $q['resolution']);
		$this->assertSame('aggregate_active_power', $q['fields']);
	}

	public function test_explicit_limit_is_used_and_capped_at_the_apis_maximum()
	{
		$this->data($this->live_params(array('span' => 0, 'limit' => 5)));
		list(, $q) = $this->last_call();
		$this->assertSame('5', $q['limit']);

		$this->data($this->live_params(array('span' => 0, 'limit' => 999999)));
		list(, $q) = $this->last_call();
		$this->assertSame('2000', $q['limit']);
	}

	public function test_limit_takes_precedence_over_span()
	{
		$this->data($this->live_params(array('span' => 1800, 'limit' => 3)));
		list(, $q) = $this->last_call();
		$this->assertSame('3', $q['limit']);
	}

	public function test_millisecond_timestamps_are_normalised_to_seconds()
	{
		$this->ts_unit = 1000;
		$resp = $this->data($this->live_params());
		$this->assertSame(array(1790000000.0, 1790000001.0, 1790000002.0), array_map('floatval', $resp->data['timestamps']));
	}

	public function test_second_timestamps_are_left_alone()
	{
		$this->ts_unit = 1;
		$resp = $this->data($this->live_params());
		$this->assertEquals(1790000000, $resp->data['timestamps'][0]);
	}

	public function test_response_shape()
	{
		$resp = $this->data($this->live_params(array('fields' => 'aggregate_active_power,aggregate_wind_speed')));
		$d = $resp->data;
		$this->assertSame('site_instantaneous', $d['family']);
		$this->assertSame('1s', $d['resolution']);
		$this->assertSame(1, $d['seconds']);
		$this->assertFalse($d['truncated']);
		$this->assertSame(array('aggregate_active_power', 'aggregate_wind_speed'), array_keys($d['series']));
		$this->assertSame('kW', $d['fields']['aggregate_active_power']['unit']);
		$this->assertCount(count($d['timestamps']), $d['series']['aggregate_wind_speed']);
	}

	public function test_non_numeric_values_become_null_and_numeric_strings_are_cast()
	{
		ACE_Test_Env::$http = function ($url) {
			if (strpos($url, '/latest') === false) {
				return $this->route($url);
			}
			return $this->ok(array(
				'timestamps' => array(1790000000, 1790000001, 1790000002, 1790000003),
				'series'     => array('aggregate_active_power' => array('12.5', null, 'NaN-ish', 7)),
			));
		};
		$s = $this->data($this->live_params())->data['series']['aggregate_active_power'];
		$this->assertSame(array(12.5, null, null, 7), $s);
	}

	public function test_missing_series_column_is_padded_with_nulls_to_stay_aligned()
	{
		ACE_Test_Env::$http = function ($url) {
			if (strpos($url, '/latest') === false) {
				return $this->route($url);
			}
			return $this->ok(array(
				'timestamps' => array(1790000000, 1790000001),
				'series'     => array('aggregate_active_power' => array(1, 2)), // wind speed missing
			));
		};
		$d = $this->data($this->live_params(array('fields' => 'aggregate_active_power,aggregate_wind_speed')))->data;
		$this->assertSame(array(null, null), $d['series']['aggregate_wind_speed']);
	}

	public function test_cache_control_follows_resolution()
	{
		$this->assertSame('public, max-age=1', $this->data($this->live_params())->headers['Cache-Control']);
		$r = $this->data($this->live_params(array('resolution' => '60s', 'span' => 3600)));
		$this->assertSame('public, max-age=5', $r->headers['Cache-Control']);
	}

	public function test_identical_requests_are_served_from_cache()
	{
		$this->data($this->live_params());
		$n = count($this->calls_matching('/latest'));
		$this->data($this->live_params());
		$this->assertCount($n, $this->calls_matching('/latest'));
	}

	public function test_attribution_block_is_not_stored_in_the_cache()
	{
		$this->data($this->live_params());
		foreach (ACE_Test_Env::$transients as $key => $val) {
			if (is_array($val) && isset($val['timestamps'])) {
				$this->assertArrayNotHasKey('attribution', $val, $key);
			}
		}
		$this->addToAssertionCount(1);
	}
}
