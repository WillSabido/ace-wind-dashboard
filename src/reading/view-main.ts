import { initReadings } from './reading-view';

// Entry point of blocks/live-reading/view.js (loaded on the front end only when the block is on the page).
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => { initReadings(); });
} else {
	initReadings();
}
