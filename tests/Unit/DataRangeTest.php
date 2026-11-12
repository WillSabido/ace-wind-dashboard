<?php

/** The historical path: GET .../range with sequential cursor pagination. */
class DataRangeTest extends ACE_Wind_TestCase
{

	public function test_span_beyond_latest_limit_uses_range_with_aligned_window()
	{
		$before = time();
		$resp   = $this->data($this->live_params(array('span' => 3600))); // 3601 pts > 2000
		$this->assertSame(200, $resp->status);
		list($path, $q) = $this->last_call();
		$this->assertStringEndsWith('/range', $path);
		$start = strtotime($q['start']);
		$end   = strtotime($q['end']);
		$this->assertSame(3600, $end - $start);
		$this->assertSame(0, $end % 30, 'End is rounded to a 30 s bucket so cache keys repeat');
		$this->assertGreaterThanOrEqual($before, $end);
		$this->assertSame('1000', $q['page_size'], 'page size comes from the API capability');
	}

	public function test_bucket_is_at_least_the_resolution()
	{
		$this->data(array('family' => 'wecstd', 'resolution' => '10m', 'fields' => 'wind_speed_mean', 'span' => 2592000));
		list(, $q) = $this->last_call();
		$this->assertSame(0, strtotime($q['end']) % 600);
		$this->assertSame('5000', $q['page_size']);
	}

	public function test_all_pages_are_followed_and_merged_in_order()
	{
		$this->ts_unit = 1;
		$this->range_pages = array(
			array('timestamps' => array(100, 101), 'series' => array('aggregate_active_power' => array(1, 2))),
			array('timestamps' => array(102),      'series' => array('aggregate_active_power' => array(3))),
			array('timestamps' => array(103, 104), 'series' => array('aggregate_active_power' => array(null, 5))),
		);
		$d = $this->data($this->live_params(array('span' => 7200)))->data;
		$this->assertSame(array(100.0, 101.0, 102.0, 103.0, 104.0), array_map('floatval', $d['timestamps']));
		$this->assertSame(array(1, 2, 3, null, 5), $d['series']['aggregate_active_power']);
		$this->assertFalse($d['truncated']);
	}

	public function test_cursor_is_passed_to_each_following_page()
	{
		$this->range_pages = array(
			array('timestamps' => array(1), 'series' => array('aggregate_active_power' => array(1))),
			array('timestamps' => array(2), 'series' => array('aggregate_active_power' => array(2))),
		);
		$this->data($this->live_params(array('span' => 7200)));
		$calls = $this->calls_matching('/range');
		$this->assertCount(2, $calls);
		$this->assertStringNotContainsString('cursor=', $calls[0]);
		$this->assertStringContainsString('cursor=p1', $calls[1]);
	}

	public function test_pagination_is_capped_and_flagged_as_truncated()
	{
		$this->range_endless = true;
		$resp = $this->data($this->live_params(array('span' => 7200)));
		$this->assertSame(ACE_Wind_Dashboard::MAX_PAGES, count($this->calls_matching('/range')));
		$this->assertTrue($resp->data['truncated']);
		$this->assertCount(ACE_Wind_Dashboard::MAX_PAGES, $resp->data['timestamps']);
	}

	public function test_an_error_on_a_later_page_fails_the_whole_request()
	{
		$this->range_pages = array(
			array('timestamps' => array(1), 'series' => array('aggregate_active_power' => array(1))),
			array('timestamps' => array(2), 'series' => array('aggregate_active_power' => array(2))),
		);
		$inner = ACE_Test_Env::$http;
		ACE_Test_Env::$http = function ($url) use ($inner) {
			return strpos($url, 'cursor=p1') !== false ? array('code' => 500, 'body' => '', 'headers' => array()) : call_user_func($inner, $url);
		};
		$this->assertErrorResponse($this->data($this->live_params(array('span' => 7200))), 502);
	}

	public function test_custom_iso_range_is_sent_upstream_in_utc()
	{
		$resp = $this->data($this->live_params(array('span' => 0, 'start' => '2026-03-01T10:00:00Z', 'end' => '2026-03-01T11:00:00Z')));
		$this->assertSame(200, $resp->status);
		list($path, $q) = $this->last_call();
		$this->assertStringEndsWith('/range', $path);
		$this->assertSame('2026-03-01T10:00:00Z', $q['start']);
		$this->assertSame('2026-03-01T11:00:00Z', $q['end']);
	}

	public function test_custom_range_accepts_epoch_seconds()
	{
		$this->data($this->live_params(array('span' => 0, 'start' => '1772359200', 'end' => '1772362800')));
		list(, $q) = $this->last_call();
		$this->assertSame('2026-03-01T10:00:00Z', $q['start']);
		$this->assertSame('2026-03-01T11:00:00Z', $q['end']);
	}

	public function test_exactly_the_point_cap_is_allowed_one_over_is_not()
	{
		$cap = ACE_Wind_Dashboard::MAX_POINTS;
		$ok  = $this->data($this->live_params(array('resolution' => '60s', 'span' => 0, 'start' => 1700000000, 'end' => 1700000000 + $cap * 60)));
		$this->assertSame(200, $ok->status);
		$bad = $this->data($this->live_params(array('resolution' => '60s', 'span' => 0, 'start' => 1700000000, 'end' => 1700000000 + ($cap + 1) * 60)));
		$this->assertErrorResponse($bad, 400, 'ace_too_many');
	}

	public function test_range_responses_are_uncacheable_downstream_but_cached_upstream_for_the_api()
	{
		// Fixed window (not "last N seconds") so the test can't straddle a time bucket.
		$params = $this->live_params(array('span' => 0, 'start' => '2026-03-01T10:00:00Z', 'end' => '2026-03-01T11:00:00Z'));
		$resp   = $this->data($params);
		$this->assertStringContainsString('no-store', $resp->headers['Cache-Control']);
		$n = count($this->calls_matching('/range'));
		$this->data($params);
		$this->assertCount($n, $this->calls_matching('/range'), 'our transient cache still protects the API');
	}

	public function test_a_cache_busting_query_argument_does_not_reach_the_api_or_defeat_the_transient_cache()
	{
		$params = $this->live_params(array('span' => 0, 'start' => '2026-03-01T10:00:00Z', 'end' => '2026-03-01T11:00:00Z'));
		$this->data($params + array('_b' => 111));
		$n = count($this->calls_matching('/range'));
		$this->data($params + array('_b' => 222));
		$this->assertCount($n, $this->calls_matching('/range'));
		$this->assertStringNotContainsString('_b=', end(ACE_Test_Env::$http_calls));
	}
}
