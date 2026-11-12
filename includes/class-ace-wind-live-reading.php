<?php
/**
 * The "ACE Live Reading" block: a live readout tile (power, wind speed, ...) with an animated icon.
 *
 * Block metadata is in blocks/live-reading/block.json. The tile itself is drawn in the browser (and in the
 * block editor) by the same TypeScript, so this class only registers the block, sanitises its attributes and
 * prints a container carrying them. Page caches therefore never freeze a reading.
 */

defined( 'ABSPATH' ) || exit;

final class ACE_Wind_Live_Reading {

	const BLOCK = 'ace-wind/live-reading';

	/** "custom" = any other measurement, chosen by data set + field. */
	const METRICS = array( 'power', 'power_pct', 'wind_speed', 'wind_direction', 'rotor_speed', 'custom' );
	const LAYOUTS = array( 'left', 'right', 'top', 'background' );
	const ICONS   = array( 'auto', 'turbine', 'wind', 'compass', 'bolt', 'gauge', 'image', 'none' );
	const FORMATS = array( 'both', 'compass', 'degrees' );

	/** Placeholder labels shown before JavaScript draws the tile. */
	const LABELS = array(
		'power'          => 'Power output',
		'power_pct'      => 'Share of rated output',
		'wind_speed'     => 'Wind speed',
		'wind_direction' => 'Wind direction',
		'rotor_speed'    => 'Rotor speed',
		'custom'         => 'Live reading',
	);

	/** @var ACE_Wind_Dashboard */
	private $plugin;

	public function __construct( ACE_Wind_Dashboard $plugin ) {
		$this->plugin = $plugin;
		add_action( 'init', array( $this, 'register' ) );
	}

	/** Defaults; must equal the "default" of every attribute in block.json (a test enforces this). */
	public static function defaults() {
		return array(
			'metric'          => 'power',
			'family'          => '',
			'field'           => '',
			'unit'            => '',
			'decimals'        => -1,
			'showLabel'       => true,
			'label'           => '',
			'showDetail'      => true,
			'showUpdated'     => false,
			'directionFormat' => 'both',
			'icon'            => 'auto',
			'iconUrl'         => '',
			'iconColor'       => '',
			'layout'          => 'left',
			'iconSize'        => 56,
			'animate'         => true,
		);
	}

	/** Site-wide values the tile needs (also given to the editor script). */
	public function env() {
		$o = $this->plugin->opts();
		return array(
			'rest'        => esc_url_raw( rest_url( ACE_Wind_Dashboard::NS . '/' ) ),
			'ratedKw'     => (int) $o['rated_kw'],
			'liveRefresh' => (int) $o['live_refresh'],
			'tz'          => $o['timezone'],
		);
	}

	public function register() {
		if ( ! function_exists( 'register_block_type' ) ) {
			return;
		}
		register_block_type(
			dirname( __DIR__ ) . '/blocks/live-reading',
			array( 'render_callback' => array( $this, 'render' ) )
		);

		// Give the editor script the site-wide settings it needs to show a live preview.
		if ( function_exists( 'generate_block_asset_handle' ) ) {
			wp_add_inline_script(
				generate_block_asset_handle( self::BLOCK, 'editorScript' ),
				'window.ACE_WIND_BLOCK = ' . wp_json_encode( $this->env() ) . ';',
				'before'
			);
		}
	}

	private static function bool( $v ) {
		return filter_var( $v, FILTER_VALIDATE_BOOLEAN );
	}

	private static function choice( $v, array $allowed, $fallback ) {
		return in_array( $v, $allowed, true ) ? $v : $fallback;
	}

	/** Whitelist and clamp every attribute; anything unexpected falls back to its default. */
	public static function normalize( array $in ) {
		$d = self::defaults();
		$a = array_merge( $d, array_intersect_key( $in, $d ) );

		$metric = self::choice( $a['metric'], self::METRICS, $d['metric'] );
		$family = is_scalar( $a['family'] ) ? sanitize_key( (string) $a['family'] ) : '';
		$field  = is_scalar( $a['field'] ) ? sanitize_key( (string) $a['field'] ) : '';
		if ( 'custom' === $metric && ( '' === $family || '' === $field ) ) {
			$metric = $d['metric'];   // an unfinished "other measurement" shows the default instead of an error
		}
		if ( 'custom' !== $metric ) {
			$family = $field = '';
		}

		$color = is_string( $a['iconColor'] ) ? sanitize_hex_color( $a['iconColor'] ) : '';
		$url   = is_string( $a['iconUrl'] ) ? esc_url_raw( $a['iconUrl'], array( 'http', 'https' ) ) : '';

		return array(
			'metric'          => $metric,
			'family'          => $family,
			'field'           => $field,
			'unit'            => mb_substr( sanitize_text_field( (string) ( is_scalar( $a['unit'] ) ? $a['unit'] : '' ) ), 0, 12 ),
			'decimals'        => max( -1, min( 3, (int) $a['decimals'] ) ),
			'showLabel'       => self::bool( $a['showLabel'] ),
			'label'           => mb_substr( sanitize_text_field( (string) ( is_scalar( $a['label'] ) ? $a['label'] : '' ) ), 0, 80 ),
			'showDetail'      => self::bool( $a['showDetail'] ),
			'showUpdated'     => self::bool( $a['showUpdated'] ),
			'directionFormat' => self::choice( $a['directionFormat'], self::FORMATS, $d['directionFormat'] ),
			'icon'            => self::choice( $a['icon'], self::ICONS, $d['icon'] ),
			'iconUrl'         => $url ? $url : '',
			'iconColor'       => $color ? $color : '',
			'layout'          => self::choice( $a['layout'], self::LAYOUTS, $d['layout'] ),
			'iconSize'        => max( 16, min( 200, (int) $a['iconSize'] ) ),
			'animate'         => self::bool( $a['animate'] ),
		);
	}

	/** Render callback: a container the front-end script fills in and keeps updated. */
	public function render( $attributes = array(), $content = '', $block = null ) {
		$a      = self::normalize( (array) $attributes );
		$config = $a + $this->env();
		$label  = '' !== $a['label'] ? $a['label'] : self::LABELS[ $a['metric'] ];

		$wrapper = function_exists( 'get_block_wrapper_attributes' )
			? get_block_wrapper_attributes()
			: 'class="wp-block-ace-wind-live-reading"';

		return '<div ' . $wrapper . '>'
			. '<div class="acewd-reading" data-config="' . esc_attr( wp_json_encode( $config ) ) . '">'
			. '<div class="acewd-r__body">'
			. ( $a['showLabel'] ? '<div class="acewd-r__label">' . esc_html( $label ) . '</div>' : '' )
			. '<div class="acewd-r__value">–</div>'
			. '</div>'
			. '<noscript>' . esc_html__( 'Enable JavaScript to see the live turbine reading.', 'ace-wind-dashboard' ) . '</noscript>'
			. '</div></div>';
	}
}
