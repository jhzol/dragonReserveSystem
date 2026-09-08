const test = require("node:test");
const assert = require("node:assert/strict");

const safeArea = require("../utils/safeArea");

function withWx(wxValue, callback) {
  const previousWx = global.wx;
  try {
    global.wx = wxValue;
    return callback();
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
}

test("safe area prefers safeAreaInsets.bottom and converts px to rpx", () => {
  withWx({
    getWindowInfo() {
      return {
        windowWidth: 375,
        windowHeight: 812,
        safeAreaInsets: { bottom: 34 },
        safeArea: { bottom: 778 }
      };
    },
    getDeviceInfo() {
      return { platform: "ios", system: "iOS 19" };
    }
  }, () => {
    assert.equal(safeArea.getBottomSafeAreaPx(safeArea.getWindowInfoCompat()), 34);
    assert.equal(safeArea.getBottomSafeAreaRpx(), 68);
  });
});

test("safe area supports the legacy safeArea.bottom coordinate", () => {
  withWx({
    getWindowInfo() {
      return { windowWidth: 390, windowHeight: 844, safeArea: { bottom: 810 } };
    }
  }, () => {
    assert.equal(safeArea.getBottomSafeAreaPx(safeArea.getWindowInfoCompat()), 34);
    assert.equal(safeArea.getBottomSafeAreaRpx(), 65.38);
  });
});

test("Android uses the 24px design fallback when the runtime explicitly reports zero inset", () => {
  withWx({
    getWindowInfo() {
      return {
        windowWidth: 360,
        windowHeight: 800,
        safeAreaInsets: null,
        safeArea: { top: 35, bottom: 800, height: 765 }
      };
    },
    getDeviceInfo() {
      return {
        platform: "android",
        brand: "vivo",
        model: "V2359A",
        system: "Android 15"
      };
    }
  }, () => {
    assert.equal(safeArea.getBottomSafeAreaPx(safeArea.getWindowInfoCompat()), 0);
    assert.equal(safeArea.getBottomSafeAreaRpx(), 46.15);
    const diagnostic = safeArea.buildSafeAreaDiagnostic();
    assert.equal(diagnostic.computedBottomPx, 0);
    assert.equal(diagnostic.computedBottomRpx, 0);
    assert.equal(diagnostic.resolvedBottomRpx, 46.15);
    assert.equal(diagnostic.androidFallbackApplied, true);
  });
});

test("HarmonyOS simulator uses the same 24px design fallback when no inset is reported", () => {
  withWx({
    getWindowInfo() {
      return {
        windowWidth: 366,
        windowHeight: 809,
        safeArea: { top: 39, bottom: 809, height: 770 }
      };
    },
    getDeviceInfo() {
      return {
        platform: "devtools",
        brand: "devtools",
        model: "HUAWEI Mate 80",
        system: "HarmonyOS"
      };
    }
  }, () => {
    const diagnostic = safeArea.buildSafeAreaDiagnostic();
    assert.equal(diagnostic.computedBottomPx, 0);
    assert.equal(diagnostic.resolvedBottomRpx, 46.15);
    assert.equal(diagnostic.androidFallbackApplied, true);
    assert.equal(safeArea.getBottomSafeAreaRpx(), 46.15);
  });
});

test("Android still prefers a real positive bottom inset", () => {
  withWx({
    getWindowInfo() {
      return {
        windowWidth: 420,
        windowHeight: 876,
        safeAreaInsets: { bottom: 24 },
        safeArea: { top: 36, bottom: 852 }
      };
    },
    getDeviceInfo() {
      return { platform: "android", system: "Android 16" };
    }
  }, () => {
    assert.equal(safeArea.getBottomSafeAreaRpx(), 42.86);
    const diagnostic = safeArea.buildSafeAreaDiagnostic();
    assert.equal(diagnostic.resolvedBottomRpx, 42.86);
    assert.equal(diagnostic.androidFallbackApplied, false);
  });
});

test("non-Android environments remain zero when no bottom inset is reported", () => {
  withWx({
    getWindowInfo() {
      return { windowWidth: 390, windowHeight: 844 };
    }
  }, () => {
    assert.equal(safeArea.getBottomSafeAreaRpx(), 0);
  });
});

test("safe area clamps invalid or negative values to zero outside Android", () => {
  withWx({
    getWindowInfo() {
      return {
        windowWidth: 375,
        windowHeight: 812,
        safeAreaInsets: { bottom: -10 }
      };
    }
  }, () => {
    assert.equal(safeArea.getBottomSafeAreaRpx(), 0);
  });
});

test("safe area diagnostic exposes raw and resolved runtime values", () => {
  withWx({
    getWindowInfo() {
      return {
        pixelRatio: 3,
        screenWidth: 420,
        screenHeight: 900,
        windowWidth: 420,
        windowHeight: 876,
        safeAreaInsets: { bottom: 24 },
        safeArea: { top: 36, bottom: 852 }
      };
    },
    getDeviceInfo() {
      return {
        platform: "android",
        brand: "Example",
        model: "Example Phone",
        system: "Android 16"
      };
    }
  }, () => {
    const diagnostic = safeArea.buildSafeAreaDiagnostic();
    assert.deepEqual(diagnostic.safeAreaInsets, { bottom: 24 });
    assert.deepEqual(diagnostic.safeArea, { top: 36, bottom: 852 });
    assert.equal(diagnostic.platform, "android");
    assert.equal(diagnostic.windowHeight, 876);
    assert.equal(diagnostic.screenHeight, 900);
    assert.equal(diagnostic.computedBottomPx, 24);
    assert.equal(diagnostic.computedBottomRpx, 42.86);
    assert.equal(diagnostic.resolvedBottomRpx, 42.86);
    assert.equal(safeArea.getBottomSafeAreaRpx(), 42.86);
  });
});

test("all four tab pages and the custom tab bar share the same safe-area resolver", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const relativeFiles = [
    "../pages/activity_list/activity_list.js",
    "../pages/activity_calendar/activity_calendar.js",
    "../pages/history/history.js",
    "../pages/profile/profile.js",
    "../custom-tab-bar/index.js"
  ];

  for (const relativeFile of relativeFiles) {
    const source = fs.readFileSync(path.join(__dirname, relativeFile), "utf8");
    assert.match(source, /getBottomSafeAreaRpx/);
  }
});
