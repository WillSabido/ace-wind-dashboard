import { ENV_FALLBACK } from './block-model';
import { registerBlock } from './editor';

// Entry point of blocks/live-reading/editor.js (block editor only).
if (window.wp) {
	registerBlock(window.wp, window.ACE_WIND_BLOCK || ENV_FALLBACK);
}
