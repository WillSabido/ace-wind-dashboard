import { initAll } from "./dashboard";

// Entry point of the bundle (assets/js/dashboard.js): wait for the DOM, then build every dashboard.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAll);
} else {
  initAll();
}
