function getMinimumWindowSize(display) {
  // Electron display geometry is in DIP, so this also respects OS scaling.
  return [
    Math.ceil(display.workAreaSize.width / 2),
    Math.ceil(display.workAreaSize.height / 2),
  ];
}

function installWindowSizePolicy(window, screen) {
  const update = () => {
    if (window.isDestroyed()) return;
    const minimum = getMinimumWindowSize(screen.getDisplayMatching(window.getBounds()));
    const previous = window.getMinimumSize();
    if (minimum.some((value, index) => value !== previous[index])) {
      window.setMinimumSize(...minimum);
    }
    if (window.isMaximized() || window.isFullScreen() || window.isMinimized()) return;
    const size = window.getSize();
    if (size.some((value, index) => value < minimum[index])) {
      window.setSize(Math.max(size[0], minimum[0]), Math.max(size[1], minimum[1]));
    }
  };
  window.on("move", update);
  window.on("restore", update);
  window.on("unmaximize", update);
  window.on("leave-full-screen", update);
  screen.on("display-metrics-changed", update);
  screen.on("display-added", update);
  screen.on("display-removed", update);
  window.once("closed", () => {
    screen.removeListener("display-metrics-changed", update);
    screen.removeListener("display-added", update);
    screen.removeListener("display-removed", update);
  });
  update();
}

module.exports = { getMinimumWindowSize, installWindowSizePolicy };
