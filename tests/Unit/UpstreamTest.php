<?php

/** Rate limiting, stale-on-error, error mapping and caching of the upstream client. */
class UpstreamTest extends ACE_Wind_TestCase
{

	/** Warm the catalogue so only the data call is affected by the failure we simulate. */
	private function warm()
	{
		$this->plugin->rest_catalogue();
	}

	private function respond($code, $body = '{}', array $headers = array())
	{
		$inner = ACE_Test_Env::$http;
		ACE_Test_Env::$http = function ($url) use ($code, $body, $headers, $inner) {
			if (strpos($url, '/data/') === false) {
				return call_user_func($inner, $url);
			}
			return array('code' => $code, 'body' => $body, 'headers' => $headers);
		};
	}

	/** Expire the fresh cache entry for the data URL but keep the "stale" copy. */
	private function expire_fresh_data_cache()
	{
		foreach (array_keys(ACE_Test_Env::$transients) as $k) {
			$s = substr($k, -2) === '_s';
			if (! $s && isset(ACE_Test_Env::$transients[$k]['timestamps'])) {
				unset(ACE_Test_Env::$transients[$k]);
			}
		}
	}

	public function test_429_returns_429_with_retry_after_and_no_store()
	{
		$this->warm();
		$this->respond(429, '{}', array('retry-after' => '7'));
		$resp = $this->data($this->live_params());
		$this->assertErrorResponse($resp, 429, 'ace_rate_limited');
		$this->assertSame('7', $resp->headers['Retry-After']);
		$this->assertStringContainsString('no-store', $resp->headers['Cache-Control']);
	}

	public function test_retry_after_is_clamped_between_1_and_300()
	{
		$this->warm();
		$this->respond(429, '{}', array('retry-after' => '99999'));
		$this->assertSame('300', $this->data($this->live_params())->headers['Retry-After']);

		ACE_Test_Env::$transients = array(); // forget back-off
		$this->warm();
		$this->respond(429); // no header
		$this->assertSame('5', $this->data($this->live_params())->headers['Retry-After'], 'default 5 s');
	}

	public function test_during_backoff_no_further_upstream_calls_are_made()
	{
		$this->warm();
		$this->respond(429, '{}', array('retry-after' => '30'));
		$this->data($this->live_params());
		$n = count(ACE_Test_Env::$http_calls);

		$resp = $this->data($this->live_params(array('fields' => 'aggregate_wind_speed'))); // different URL, not cached
		$this->assertErrorResponse($resp, 429);
		$this->assertCount($n, ACE_Test_Env::$http_calls, 'Back-off must suppress network calls');
	}

	public function test_stale_data_is_served_when_rate_limited()
	{
		$this->warm();
		$fresh = $this->data($this->live_params());
		$this->expire_fresh_data_cache();
		$this->respond(429, '{}', array('retry-after' => '10'));
		$resp = $this->data($this->live_params());
		$this->assertSame(200, $resp->status);
		$this->assertEquals($fresh->data['timestamps'], $resp->data['timestamps']);
	}

	public function test_stale_data_is_served_when_the_network_fails()
	{
		$this->warm();
		$fresh = $this->data($this->live_params());
		$this->expire_fresh_data_cache();
		ACE_Test_Env::$http = function ($url) {
			return new WP_Error('http_request_failed', 'cURL error 28');
		};
		$resp = $this->data($this->live_params());
		$this->assertSame(200, $resp->status);
		$this->assertEquals($fresh->data['series'], $resp->data['series']);
	}

	public function test_stale_data_is_served_on_upstream_5xx()
	{
		$this->warm();
		$this->data($this->live_params());
		$this->expire_fresh_data_cache();
		$this->respond(503);
		$this->assertSame(200, $this->data($this->live_params())->status);
	}

	public function test_network_failure_without_stale_copy_is_502()
	{
		$this->warm();
		ACE_Test_Env::$http = function ($url) {
			return strpos($url, '/data/') === false ? $this->route($url) : new WP_Error('http_request_failed', 'timeout');
		};
		$this->assertErrorResponse($this->data($this->live_params()), 502, 'ace_unreachable');
	}

	public function test_upstream_4xx_is_a_400_and_surfaces_the_apis_message()
	{
		$this->warm();
		$this->respond(422, json_encode(array('error' => array('message' => 'start must be before end'))));
		$resp = $this->data($this->live_params());
		$this->assertErrorResponse($resp, 400);
		$this->assertSame('start must be before end', $resp->data['error']);
	}

	public function test_upstream_5xx_is_a_502()
	{
		$this->warm();
		$this->respond(500, 'Internal Server Error');
		$this->assertErrorResponse($this->data($this->live_params()), 502);
	}

	public function test_non_json_200_is_a_502()
	{
		$this->warm();
		$this->respond(200, '<html>captive portal</html>');
		$this->assertErrorResponse($this->data($this->live_params()), 502);
	}

	public function test_failed_responses_are_not_cached()
	{
		$this->warm();
		$this->respond(500);
		$this->data($this->live_params());
		ACE_Test_Env::$http = array($this, 'route'); // API recovers
		$this->assertSame(200, $this->data($this->live_params())->status);
	}

	public function test_request_is_a_get_to_the_expected_host_with_encoded_query()
	{
		$this->data($this->live_params(array('fields' => 'aggregate_active_power,aggregate_wind_speed')));
		$url = end(ACE_Test_Env::$http_calls);
		$this->assertStringStartsWith('https://ace-api.duckdns.org/v1/sites/ace/data/site_instantaneous/latest?', $url);
		$this->assertStringContainsString('fields=aggregate_active_power%2Caggregate_wind_speed', $url);
	}
}
