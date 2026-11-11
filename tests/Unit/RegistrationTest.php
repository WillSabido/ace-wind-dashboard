<?php

/** What the plugin wires into WordPress when it loads. */
class RegistrationTest extends ACE_Wind_TestCase
{

	private function boot_hooks($type, $name)
	{
		return array_values(array_filter(ACE_Test_Env::$boot_hooks, function ($h) use ($type, $name) {
			return $h[0] === $type && $h[1] === $name;
		}));
	}

	public function test_plugin_is_a_singleton()
	{
		$this->assertSame(ACE_Wind_Dashboard::instance(), ACE_Wind_Dashboard::instance());
	}

	public function test_hooks_registered_on_load()
	{
		$this->assertCount(1, $this->boot_hooks('shortcode', 'ace_wind_dashboard'));
		foreach (array('wp_enqueue_scripts', 'rest_api_init', 'admin_menu', 'admin_init', 'admin_post_ace_wind_clear_cache') as $hook) {
			$this->assertNotEmpty($this->boot_hooks('action', $hook), "action $hook");
		}
	}

	public function test_both_rest_routes_are_registered_publicly()
	{
		$this->plugin->register_routes();
		foreach (array('ace-wind/v1/catalogue', 'ace-wind/v1/data') as $route) {
			$this->assertArrayHasKey($route, ACE_Test_Env::$routes);
			$args = ACE_Test_Env::$routes[$route];
			$this->assertSame('GET', $args['methods'], 'read-only');
			$this->assertSame('__return_true', $args['permission_callback']);
			$this->assertIsCallable($args['callback']);
		}
	}

	public function test_data_route_declares_required_and_sanitised_args()
	{
		$this->plugin->register_routes();
		$args = ACE_Test_Env::$routes['ace-wind/v1/data']['args'];
		foreach (array('family', 'resolution', 'fields') as $req) {
			$this->assertTrue($args[$req]['required'], "$req required");
		}
		foreach (array('family', 'resolution', 'fields', 'asset', 'limit', 'span', 'start', 'end') as $p) {
			$this->assertArrayHasKey('sanitize_callback', $args[$p], "$p sanitised");
		}
		$this->assertSame('absint', $args['span']['sanitize_callback']);
		$this->assertSame('absint', $args['limit']['sanitize_callback']);
	}

	public function test_family_labels_cover_every_known_family()
	{
		$m = new ReflectionMethod(ACE_Wind_Dashboard::class, 'family_labels');
		$m->setAccessible(true);
		$labels = $m->invoke(null);
		foreach (array('site_instantaneous', 'wec_instantaneous', 'wecstd', 'controller_instantaneous') as $f) {
			$this->assertArrayHasKey($f, $labels);
		}
		$this->assertSame('site_instantaneous', array_key_first($labels), 'live site data is first in the menu');
	}

	public function test_resolution_parser()
	{
		$m = new ReflectionMethod(ACE_Wind_Dashboard::class, 'res_seconds');
		$m->setAccessible(true);
		$cases = array('1s' => 1, '60s' => 60, '10m' => 600, '5m' => 300, 'daily' => 86400, 'weekly' => 0, '' => 0, 's' => 0);
		foreach ($cases as $in => $exp) {
			$this->assertSame($exp, $m->invoke(null, $in), "'$in'");
		}
	}
}
