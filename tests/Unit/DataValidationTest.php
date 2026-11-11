<?php

/** /data must behave as a whitelist, not an open proxy. */
class DataValidationTest extends ACE_Wind_TestCase
{

	public static function bad_requests()
	{
		$ok = array('family' => 'site_instantaneous', 'resolution' => '1s', 'fields' => 'aggregate_active_power', 'span' => 600);
		return array(
			'unknown family'        => array(array('family' => 'nope') + $ok, 'ace_bad_family'),
			'private family'        => array(array('family' => 'private_family') + $ok, 'ace_bad_family'),
			'unsupported resolution' => array(array('resolution' => '10m') + $ok, 'ace_bad_resolution'),
			'unknown field'         => array(array('fields' => 'evil') + $ok, 'ace_bad_fields'),
			'one bad among good'    => array(array('fields' => 'aggregate_active_power,evil') + $ok, 'ace_bad_fields'),
			'hidden sample_count'   => array(array('fields' => 'sample_count') + $ok, 'ace_bad_fields'),
			'no fields'             => array(array('fields' => '') + $ok, 'ace_bad_fields'),
			'only commas'           => array(array('fields' => ' , ,') + $ok, 'ace_bad_fields'),
			'path-traversal field'  => array(array('fields' => '../../etc/passwd') + $ok, 'ace_bad_fields'),
			'no time window'        => array(array('span' => 0) + $ok, 'ace_bad_range'),
			'end before start'      => array(array('span' => 0, 'start' => '2026-02-01', 'end' => '2026-01-01') + $ok, 'ace_bad_range'),
			'unparseable dates'     => array(array('span' => 0, 'start' => 'banana', 'end' => 'kiwi') + $ok, 'ace_bad_range'),
			'too many points'       => array(array('span' => 0, 'start' => '2020-01-01', 'end' => '2026-01-01') + $ok, 'ace_too_many'),
		);
	}

	/** @dataProvider bad_requests */
	public function test_bad_requests_are_rejected_with_400_and_never_reach_the_data_endpoints(array $params, $code)
	{
		$this->assertErrorResponse($this->data($params), 400, $code);
		$this->assertSame(array(), $this->calls_matching('/data/'), 'No upstream data call may be made');
	}

	public function test_more_than_eight_fields_rejected()
	{
		$this->families[0]['fields'] = array();
		for ($i = 1; $i <= 9; $i++) {
			$this->families[0]['fields'][] = array('name' => "f$i");
		}
		$resp = $this->data($this->live_params(array('fields' => 'f1,f2,f3,f4,f5,f6,f7,f8,f9')));
		$this->assertErrorResponse($resp, 400, 'ace_bad_fields');
	}

	public function test_asset_family_rejects_unknown_asset()
	{
		$resp = $this->data(array('family' => 'wecstd', 'resolution' => '10m', 'fields' => 'wind_speed_mean', 'asset' => 'ctrl1', 'span' => 3600));
		$this->assertErrorResponse($resp, 400, 'ace_bad_asset');
	}

	public function test_asset_family_rejects_inactive_asset()
	{
		$resp = $this->data(array('family' => 'wecstd', 'resolution' => '10m', 'fields' => 'wind_speed_mean', 'asset' => 'wec_old', 'span' => 3600));
		$this->assertErrorResponse($resp, 400, 'ace_bad_asset');
	}

	public function test_asset_defaults_to_first_matching_asset()
	{
		$resp = $this->data(array('family' => 'wecstd', 'resolution' => '10m', 'fields' => 'wind_speed_mean', 'span' => 3600));
		$this->assertSame(200, $resp->status);
		list($path) = $this->last_call();
		$this->assertSame('/v1/sites/ace/assets/wec1/data/wecstd/latest', $path);
	}

	public function test_duplicate_and_padded_fields_are_normalised()
	{
		$this->data($this->live_params(array('fields' => ' aggregate_active_power ,aggregate_active_power, aggregate_wind_speed')));
		list(, $q) = $this->last_call();
		$this->assertSame('aggregate_active_power,aggregate_wind_speed', $q['fields']);
	}

	public function test_site_scoped_family_ignores_a_supplied_asset()
	{
		$this->data($this->live_params(array('asset' => 'wec1')));
		list($path) = $this->last_call();
		$this->assertSame('/v1/sites/ace/data/site_instantaneous/latest', $path);
	}
}
