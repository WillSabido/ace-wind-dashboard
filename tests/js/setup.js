const { NOW, cleanupListeners } = require("./helpers");

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  cleanupListeners();
  jest.clearAllTimers();
  jest.useRealTimers();
  document.body.innerHTML = "";
  delete window.uPlot;
  delete window.ResizeObserver;
  delete global.fetch;
  delete document.hidden; // remove any per-test override; falls back to jsdom's prototype getter
});
