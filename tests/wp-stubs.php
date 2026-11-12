<?php

/**
 * Minimal stand-ins for the WordPress functions/classes the plugin uses, so the
 * suite runs with plain PHPUnit (no database, no WordPress install).
 *
 * All mutable state lives in ACE_Test_Env and is wiped by ACE_Test_Env::reset().
 */

define('ABSPATH', __DIR__ . '/');
define('HOUR_IN_SECONDS', 3600);

class ACE_Test_Env
{
	public static $options     = array();
	public static $transients  = array();
	public static $http_calls  = array();
	/** @var callable|null function ( string $url ): array|WP_Error */
	public static $http        = null;
	public static $hooks       = array();
	public static $boot_hooks  = array();
	public static $shortcodes  = array();
	public static $routes      = array();
	public static $enqueued    = array();
	public static $deleted_options = array();
	public static $cache_flushes   = 0;
	public static $actions         = array();

	public static function reset()
	{
		self::$options = self::$transients = self::$http_calls = array();
		self::$hooks = self::$shortcodes = self::$routes = self::$enqueued = self::$deleted_options = array();
		self::$http = null;
		self::$cache_flushes = 0;
		self::$actions = array();
		$GLOBALS['wpdb']->queries = array();
	}
}

class ACE_Fake_Wpdb
{
	public $options = 'wp_options';
	public $queries = array();
	public function query($sql)
	{
		$this->queries[] = $sql;
		return 1;
	}
}
$GLOBALS['wpdb'] = new ACE_Fake_Wpdb();

/* ---- Classes ---- */

class WP_Error
{
	public $code;
	public $message;
	public $data;
	public function __construct($code = '', $message = '', $data = '')
	{
		$this->code = $code;
		$this->message = $message;
		$this->data = $data;
	}
	public function get_error_code()
	{
		return $this->code;
	}
	public function get_error_message()
	{
		return $this->message;
	}
	public function get_error_data()
	{
		return $this->data;
	}
}

class WP_REST_Response
{
	public $data;
	public $status;
	public $headers = array();
	public function __construct($data = null, $status = 200)
	{
		$this->data = $data;
		$this->status = $status;
	}
	public function header($k, $v)
	{
		$this->headers[$k] = $v;
	}
	public function get_status()
	{
		return $this->status;
	}
}

class WP_REST_Request implements ArrayAccess
{
	private $p;
	public function __construct(array $p = array())
	{
		$this->p = $p;
	}
	public function offsetExists($o): bool
	{
		return isset($this->p[$o]);
	}
	#[\ReturnTypeWillChange]
	public function offsetGet($o)
	{
		return $this->p[$o] ?? null;
	}
	public function offsetSet($o, $v): void
	{
		$this->p[$o] = $v;
	}
	public function offsetUnset($o): void
	{
		unset($this->p[$o]);
	}
}

/* ---- Hooks / registration ---- */

function add_action($hook, $cb, $prio = 10, $args = 1)
{
	ACE_Test_Env::$hooks[] = array('action', $hook, $cb);
}
function add_filter($hook, $cb, $prio = 10, $args = 1)
{
	ACE_Test_Env::$hooks[] = array('filter', $hook, $cb);
}
function add_shortcode($tag, $cb)
{
	ACE_Test_Env::$shortcodes[$tag] = $cb;
	ACE_Test_Env::$hooks[] = array('shortcode', $tag, $cb);
}
function do_action($tag, ...$args)
{
	ACE_Test_Env::$actions[] = array_merge(array($tag), $args);
}
function register_rest_route($ns, $route, $args)
{
	ACE_Test_Env::$routes[$ns . $route] = $args;
}
function register_setting(...$a) {}
function add_options_page(...$a) {}
function plugin_basename($f)
{
	return basename(dirname($f)) . '/' . basename($f);
}
function plugin_dir_url($f)
{
	return 'https://example.test/wp-content/plugins/ace-wind-dashboard/';
}
function wp_register_style($h, ...$a)
{
	ACE_Test_Env::$enqueued[] = array('register_style', $h);
}
function wp_register_script($h, ...$a)
{
	ACE_Test_Env::$enqueued[] = array('register_script', $h);
}
function wp_enqueue_style($h)
{
	ACE_Test_Env::$enqueued[] = array('style', $h);
}
function wp_enqueue_script($h)
{
	ACE_Test_Env::$enqueued[] = array('script', $h);
}
function shortcode_atts($defaults, $atts, $tag = '')
{
	$atts = (array) $atts;
	$out  = array();
	foreach ($defaults as $k => $v) {
		$out[$k] = array_key_exists($k, $atts) ? $atts[$k] : $v;
	}
	return $out;
}

/* ---- Options / transients / cache ---- */

function get_option($k, $d = false)
{
	return ACE_Test_Env::$options[$k] ?? $d;
}
function update_option($k, $v)
{
	ACE_Test_Env::$options[$k] = $v;
	return true;
}
function delete_option($k)
{
	ACE_Test_Env::$deleted_options[] = $k;
	unset(ACE_Test_Env::$options[$k]);
	return true;
}
function get_transient($k)
{
	return ACE_Test_Env::$transients[$k] ?? false;
}
function set_transient($k, $v, $t = 0)
{
	ACE_Test_Env::$transients[$k] = $v;
	return true;
}
function wp_cache_flush()
{
	ACE_Test_Env::$cache_flushes++;
	return true;
}

/* ---- HTTP ---- */

function wp_safe_remote_get($url, $args = array())
{
	ACE_Test_Env::$http_calls[] = $url;
	if (! ACE_Test_Env::$http) {
		return new WP_Error('no_handler', 'No fake HTTP handler configured');
	}
	return call_user_func(ACE_Test_Env::$http, $url);
}
function wp_remote_retrieve_response_code($r)
{
	return $r['code'] ?? 0;
}
function wp_remote_retrieve_body($r)
{
	return $r['body'] ?? '';
}
function wp_remote_retrieve_header($r, $h)
{
	return $r['headers'][strtolower($h)] ?? '';
}

/* ---- Utilities / sanitising / escaping ---- */

function is_wp_error($x)
{
	return $x instanceof WP_Error;
}
function wp_parse_args($a, $d = array())
{
	return array_merge($d, is_array($a) ? $a : array());
}
function wp_list_pluck($list, $field)
{
	return array_column($list, $field);
}
function wp_json_encode($d, $f = 0)
{
	return json_encode($d, $f);
}
function untrailingslashit($s)
{
	return rtrim($s, '/\\');
}
function home_url($p = '')
{
	return 'https://example.test' . $p;
}
function rest_url($p = '')
{
	return 'https://example.test/wp-json/' . ltrim($p, '/');
}
function esc_html__($s, $d = '')
{
	return htmlspecialchars($s, ENT_QUOTES);
}
function esc_html($s)
{
	return htmlspecialchars($s, ENT_QUOTES);
}
function esc_attr($s)
{
	return htmlspecialchars($s, ENT_QUOTES);
}
function esc_url($s)
{
	return $s;
}
function esc_url_raw($url, $protocols = null)
{
	$url = trim((string) $url);
	$p   = parse_url($url);
	$ok  = $protocols ?: array('http', 'https');
	if (empty($p['scheme']) || empty($p['host']) || ! in_array(strtolower($p['scheme']), $ok, true)) {
		return '';
	}
	return $url;
}
function sanitize_text_field($s)
{
	return trim(strip_tags((string) $s));
}
function sanitize_key($s)
{
	return preg_replace('/[^a-z0-9_\-]/', '', strtolower((string) $s));
}
function absint($n)
{
	return abs((int) $n);
}
function __return_true()
{
	return true;
}
