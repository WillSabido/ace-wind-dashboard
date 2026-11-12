import { catalogue } from '../api';
import type { Catalogue } from '../types';
import {
	BLOCK_NAME, DECIMAL_LABELS, DEFAULT_ATTRS, DIRECTION_OPTIONS, ENV_FALLBACK, ICON_OPTIONS, LAYOUT_OPTIONS, METRIC_OPTIONS,
	buildConfig, familyChange, familyOptions, fieldOptions, metricChange, unitOptions
} from './block-model';
import { CUSTOM } from './metrics';
import { mountReading } from './reading-view';
import type { Any, ReadingAttrs, ReadingEnv, WpGlobal } from './types';

/**
 * Registers the "ACE Live Reading" block. Title, attributes and supports come from block.json
 * (registered by PHP); this adds the editor UI. The preview is the real tile, live.
 */
export function registerBlock(wp: WpGlobal, env: ReadingEnv = ENV_FALLBACK): void {
	const { createElement: h, Fragment, useEffect, useRef, useState } = wp.element;
	const { InspectorControls, useBlockProps, MediaUpload, MediaUploadCheck, PanelColorSettings } = wp.blockEditor;
	const { PanelBody, SelectControl, ToggleControl, TextControl, RangeControl, Button } = wp.components;
	const __ = (s: string): string => wp.i18n.__(s, 'ace-wind-dashboard');

	function Edit(props: { attributes: Partial<ReadingAttrs>; setAttributes: (a: Partial<ReadingAttrs>) => void }): Any {
		const attrs: ReadingAttrs = { ...DEFAULT_ATTRS, ...props.attributes };
		const set = props.setAttributes;
		const host = useRef<HTMLElement>(null);
		const [cat, setCat] = useState<Catalogue | null>(null);

		// Live preview: (re)mount the real tile whenever any setting changes.
		const signature = JSON.stringify(attrs);
		useEffect(() => {
			if (!host.current) return undefined;
			const mounted = mountReading(host.current, buildConfig(attrs, env));
			return () => mounted.destroy();
		}, [signature]);

		// The catalogue is only needed for "Other measurement".
		useEffect(() => {
			if (attrs.metric !== CUSTOM || cat) return;
			catalogue(env.rest).then(setCat, () => undefined);
		}, [attrs.metric]);

		const select = (label: string, value: string, options: { value: string; label: string }[], onChange: (v: string) => void, help?: string): Any =>
			h(SelectControl, { label: __(label), value, options, onChange, help, __nextHasNoMarginBottom: true });
		const toggle = (label: string, key: keyof ReadingAttrs): Any =>
			h(ToggleControl, { label: __(label), checked: !!attrs[key], onChange: (v: boolean) => set({ [key]: v }), __nextHasNoMarginBottom: true });

		const units = unitOptions(attrs);
		const measurement = [
			select('Measurement', attrs.metric, METRIC_OPTIONS, (v) => set(metricChange(v))),
			attrs.metric === CUSTOM && h(Fragment, null,
				select('Data set', attrs.family, [{ value: '', label: cat ? __('Choose…') : __('Loading…') }, ...familyOptions(cat)],
					(v) => set(familyChange(cat, v))),
				attrs.family && select('Value', attrs.field, fieldOptions(cat, attrs.family), (v) => set({ field: v }))
			),
			units.length > 0 && select('Unit', attrs.unit || units[0].value, units, (v) => set({ unit: v })),
			attrs.metric === 'wind_direction' && select('Show direction as', attrs.directionFormat, DIRECTION_OPTIONS, (v) => set({ directionFormat: v as ReadingAttrs['directionFormat'] })),
			h(RangeControl, {
				label: __('Decimal places'), min: -1, max: 3, value: attrs.decimals,
				onChange: (v: number | undefined) => set({ decimals: v === undefined ? -1 : v }),
				renderTooltipContent: (v: number) => DECIMAL_LABELS[v + 1], help: __('-1 chooses a sensible number automatically.'),
				__nextHasNoMarginBottom: true
			}),
			toggle('Show label', 'showLabel'),
			attrs.showLabel && h(TextControl, { label: __('Label'), value: attrs.label, placeholder: __('Default for this measurement'), onChange: (v: string) => set({ label: v }), __nextHasNoMarginBottom: true }),
			toggle('Show extra detail line', 'showDetail'),
			toggle('Show time of last reading', 'showUpdated')
		];

		const iconPanel = [
			select('Icon', attrs.icon, ICON_OPTIONS, (v) => set({ icon: v as ReadingAttrs['icon'] })),
			attrs.icon === 'image' && h(MediaUploadCheck, null,
				h(MediaUpload, {
					onSelect: (m: { url: string }) => set({ iconUrl: m.url }),
					allowedTypes: ['image'], value: attrs.iconUrl,
					render: (r: { open: () => void }) => h(Fragment, null,
						attrs.iconUrl && h('img', { src: attrs.iconUrl, alt: '', style: { maxWidth: '64px', maxHeight: '64px', display: 'block', marginBottom: '8px' } }),
						h(Button, { variant: 'secondary', onClick: r.open }, attrs.iconUrl ? __('Replace image') : __('Choose image or SVG')),
						attrs.iconUrl && h(Button, { variant: 'link', isDestructive: true, onClick: () => set({ iconUrl: '' }), style: { marginLeft: '8px' } }, __('Remove'))
					)
				})
			),
			attrs.icon !== 'none' && select('Layout', attrs.layout, LAYOUT_OPTIONS, (v) => set({ layout: v as ReadingAttrs['layout'] })),
			attrs.icon !== 'none' && h(RangeControl, { label: __('Icon size'), min: 24, max: 160, step: 4, value: attrs.iconSize, onChange: (v: number | undefined) => set({ iconSize: v || DEFAULT_ATTRS.iconSize }), __nextHasNoMarginBottom: true }),
			attrs.icon !== 'none' && toggle('Animate the icon', 'animate'),
			attrs.icon !== 'none' && attrs.icon !== 'image' && h(PanelColorSettings, {
				title: __('Icon colour'), initialOpen: false, disableCustomColors: false,
				colorSettings: [{ label: __('Icon'), value: attrs.iconColor, onChange: (v: string | undefined) => set({ iconColor: v || '' }) }]
			})
		];

		return h(Fragment, null,
			h(InspectorControls, null,
				h(PanelBody, { title: __('Reading'), initialOpen: true }, ...measurement),
				h(PanelBody, { title: __('Icon'), initialOpen: true }, ...iconPanel)
			),
			h('div', useBlockProps(), h('div', { className: 'acewd-reading', ref: host }))
		);
	}

	wp.blocks.registerBlockType(BLOCK_NAME, { edit: Edit, save: () => null });
}
