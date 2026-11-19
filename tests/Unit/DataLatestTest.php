<?php

/** The "live" path: GET .../latest. */
class DataLatestTest extends ACE_Wind_TestCase
{

	public function test_span_within_latest_limit_uses_latest_with_one_extra_row()
	{
		$resp = $this->data($this->live_params(array('span' => 900)));
		$this->assertSame(200, $resp->status);
		list($path, $q) = $this->last_call();
		$this->assertStringEndsWith('/latest', $path);
		$this->assertSame('901', $q['limit']);
		$this->assertSame('1s', $q['resolution']);
		$this->assertSame('aggregate_active_power', $q['fields']);
	}

	public static function row_boundary()
	{
		return array(
			'999 s = 1000 rows: latest'            => array(999, '/latest'),
			'1000 s = 1001 rows: paged range'      => array(1000, '/range'),
			'1800 s (the default view): range'     => array(1800, '/range'),
		);
	}

	/** The real API refuses a "latest" request for more than 1000 1-second rows. */
	/** @dataProvider row_boundary */
	public function test_more_than_1000_one_second_rows_use_the_paged_range_endpoint_not_latest($span, $endpoint)
	{
		$this->data($this->live_params(array('span' => $span)));
		list($path, $q) = $this->last_call();
		$this->assertStringEndsWith($endpoint, $path);
		if ('/latest' === $endpoint) {
			$this->assertLessThanOrEqual(1000, (int) $q['limit']);
		}
	}

	public function test_a_latest_request_is_never_sent_with_more_rows_than_the_api_allows()
	{
		foreach (array(100, 999, 1000, 1800, 3600) as $span) {
			ACE_Test_Env::$http_calls = array();
			ACE_Test_Env::$transients = array();
			$this->data($this->live_params(array('span' => $span)));
			foreach ($this->calls_matching('/latest') as $url) {
				parse_str((string) parse_url($url, PHP_URL_QUERY), $q);
				$this->assertLessThanOrEqual(1000, (int) $q['limit'], "span $span");
			}
		}
	}

	public function test_explicit_limit_is_used_and_capped_at_the_apis_maximum()
	{
		$this->data($this->live_params(array('span' => 0, 'limit' => 5)));
		list(, $q) = $this->last_call();
		$this->assertSame('5', $q['limit']);

		$this->data($this->live_params(array('span' => 0, 'limit' => 999999)));
		list(, $q) = $this->last_call();
		$this->assertSame('1000', $q['limit']);
	}

	/* ---- if the API refuses a "latest" request anyway ---- */

	/** Make /latest fail with the given response while everything else works. */
	private function latest_fails($code, $body)
	{
		$inner = ACE_Test_Env::$http;
		ACE_Test_Env::$http = function ($url) use ($code, $body, $inner) {
			return strpos($url, '/latest') !== false ? array('code' => $code, 'body' => json_encode($body), 'headers' => array()) : call_user_func($inner, $url);
		};
	}

	public function test_if_the_api_refuses_a_latest_request_for_a_time_span_it_falls_back_to_the_paged_range_endpoint()
	{
		$this->latest_fails(400, array('error' => array('message' => 'limit must be <= 500')));
		$resp = $this->data($this->live_params(array('span' => 600)));
		$this->assertSame(200, $resp->status, 'the visitor still gets a chart');
		$this->assertNotEmpty($resp->data['timestamps']);
		$this->assertCount(1, $this->calls_matching('/latest'));
		$this->assertCount(1, $this->calls_matching('/range'));
		list($path, $q) = $this->last_call();
		$this->assertStringEndsWith('/range', $path);
		$this->assertSame(600, strtotime($q['end']) - strtotime($q['start']));
	}

	public function test_an_explicit_limit_request_is_not_retried_as_a_range_its_error_is_reported()
	{
		$this->latest_fails(400, array('error' => array('message' => 'limit must be <= 500')));
		$resp = $this->data($this->live_params(array('span' => 0, 'limit' => 5)));
		$this->assertErrorResponse($resp, 400, 'ace_upstream');
		$this->assertSame('limit must be <= 500', $resp->data['error']);
		$this->assertSame(array(), $this->calls_matching('/range'));
	}

	public function test_other_latest_failures_are_not_masked_by_the_fallback()
	{
		$this->latest_fails(500, array('error' => array('message' => 'boom')));
		$this->assertErrorResponse($this->data($this->live_params(array('span' => 600))), 502);
		$this->assertSame(array(), $this->calls_matching('/range'));
	}

	public function test_if_the_range_endpoint_also_fails_that_error_is_what_the_visitor_sees()
	{
		$this->latest_fails(400, array('error' => array('message' => 'first')));
		$inner = ACE_Test_Env::$http;
		ACE_Test_Env::$http = function ($url) use ($inner) {
			return strpos($url, '/range') !== false ? array('code' => 400, 'body' => json_encode(array('detail' => 'range too wide')), 'headers' => array()) : call_user_func($inner, $url);
		};
		$resp = $this->data($this->live_params(array('span' => 600)));
		$this->assertErrorResponse($resp, 400, 'ace_upstream');
		$this->assertSame('range too wide', $resp->data['error']);
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

	public function test_live_responses_are_marked_uncacheable_for_browsers_cdns_and_cache_plugins()
	{
		foreach (array($this->live_params(), $this->live_params(array('resolution' => '60s', 'span' => 3600))) as $params) {
			$resp = $this->data($params);
			$this->assertStringContainsString('no-store', $resp->headers['Cache-Control']);
			$this->assertStringContainsString('no-cache', $resp->headers['Cache-Control']);
			$this->assertStringContainsString('max-age=0', $resp->headers['Cache-Control']);
			$this->assertSame('no-cache', $resp->headers['Pragma']);
			$this->assertSame('no-cache', $resp->headers['X-LiteSpeed-Cache-Control']);
		}
		$this->assertTrue(defined('DONOTCACHEPAGE') && DONOTCACHEPAGE);
		$this->assertContains('litespeed_control_set_nocache', array_column(ACE_Test_Env::$actions, 0));
	}

	public function test_catalogue_may_still_be_cached_briefly_and_does_not_trigger_no_cache_hooks()
	{
		ACE_Test_Env::$actions = array();
		$resp = $this->plugin->rest_catalogue();
		$this->assertSame('public, max-age=300', $resp->headers['Cache-Control']);
		$this->assertSame(array(), ACE_Test_Env::$actions);
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
