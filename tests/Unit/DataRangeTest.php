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
		$this->assertSame(0, $end % 2, 'Live 1-second data: the end is rounded to a 2 s bucket so cache keys repeat');
		$this->assertGreaterThanOrEqual($before, $end);
		$this->assertSame('1000', $q['page_size'], 'page size comes from the API capability');
	}

	/** TTL (seconds) the plugin used for the newest cached /range response. */
	private function range_ttl()
	{
		$ttl = null;
		foreach (ACE_Test_Env::$http_calls as $i => $url) {
			if (strpos($url, '/range') !== false) {
				$ttl = ACE_Test_Env::$ttls['ace_wind_' . md5($url)] ?? $ttl;
			}
		}
		return $ttl;
	}

	public static function windows()
	{
		// Clock at 1790000001 (odd, and not a multiple of 30 or 600).
		return array(
			'1-second data: end rounds UP to the next 2 s'     => array('1s', 1800, 1790000002),
			'1-minute data: end rounds up to the next 60 s'    => array('60s', 7 * 86400, 1790000040),
			'10-minute stats: end rounds up to the next 600 s' => array('10m', 30 * 86400, 1790000400),
		);
	}

	/** @dataProvider windows */
	public function test_the_window_end_is_rounded_up_to_a_resolution_appropriate_bucket($resolution, $span, $expected_end)
	{
		ACE_Test_Env::$now = 1790000001;
		$fields = '10m' === $resolution ? 'wind_speed_mean' : 'aggregate_active_power';
		$family = '10m' === $resolution ? 'wecstd' : 'site_instantaneous';
		$this->data(array('family' => $family, 'resolution' => $resolution, 'fields' => $fields, 'span' => $span));
		list(, $q) = $this->last_call();
		$this->assertSame($expected_end, strtotime($q['end']));
		$this->assertSame($span, strtotime($q['end']) - strtotime($q['start']));
	}

	public function test_requests_in_the_same_bucket_share_one_cached_upstream_answer_and_the_next_bucket_is_new()
	{
		$params = $this->live_params(array('span' => 1800));
		ACE_Test_Env::$now = 1790000001;
		$this->data($params);
		$n = count($this->calls_matching('/range'));
		ACE_Test_Env::$now = 1790000002;                   // same 2 s bucket (ends at ...002)
		$this->data($params);
		$this->assertCount($n, $this->calls_matching('/range'));
		ACE_Test_Env::$now = 1790000003;                   // next bucket
		$this->data($params);
		$this->assertCount($n + 1, $this->calls_matching('/range'));
	}

	public function test_live_one_second_data_is_not_cached_for_longer_than_two_seconds()
	{
		$this->data($this->live_params(array('span' => 1800)));      // the default view: 1801 rows -> paged range
		$this->assertSame(2, $this->range_ttl(), 'a "live" chart must still move every couple of seconds');
	}

	public function test_slower_data_keeps_the_longer_window_and_cache()
	{
		$this->data($this->live_params(array('resolution' => '60s', 'span' => 7 * 86400)));
		list(, $q) = $this->last_call();
		$this->assertSame(0, strtotime($q['end']) % 30);
		$this->assertSame(30, $this->range_ttl());
	}

	public function test_fixed_custom_windows_use_the_longer_cache_even_for_one_second_data()
	{
		$this->data($this->live_params(array('span' => 0, 'start' => '2026-03-01T10:00:00Z', 'end' => '2026-03-01T10:20:00Z')));
		$this->assertSame(30, $this->range_ttl());
	}

	public function test_the_default_view_is_fetched_in_two_pages_of_1000_rows()
	{
		$this->data($this->live_params(array('span' => 1800)));
		$calls = $this->calls_matching('/range');
		$this->assertCount(1, $calls, 'the fake API reports one page; the page size asked for is what matters');
		list(, $q) = $this->last_call();
		$this->assertSame('1000', $q['page_size']);
		$this->assertSame(1800, strtotime($q['end']) - strtotime($q['start']));
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
