const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  MIN_TOUCHES,
  MAX_TOUCHES,
  PROGRESS_DURATION_MS,
  SELECT_DELAY_MS,
  TOO_MANY_DURATION_MS,
  WINNER_TRANSITION_DURATION_MS,
  DESIGN_WIDTH_PX,
  STAGE_HEIGHT_PX,
  TOUCH_DIAMETER_PX,
  getTouchId,
  getProgress,
  getTouchColor,
  getAvailableTouchColorIndex,
  getSelectionWaitMs,
  normalizeTouchPosition
} = require("../utils/chwazi");

const pageDir = path.join(__dirname, "../pages/chwazi");
const pagePath = path.join(pageDir, "chwazi.js");

function loadPageDefinition() {
  const previousPage = global.Page;
  let definition;
  try {
    global.Page = (value) => { definition = value; };
    delete require.cache[require.resolve(pagePath)];
    require(pagePath);
  } finally {
    if (previousPage === undefined) delete global.Page;
    else global.Page = previousPage;
  }
  return definition;
}

function createPageContext(definition, { liveTimers = false } = {}) {
  const context = {
    ...definition,
    data: {
      ...definition.data,
      status: "idle",
      pageBackground: "#09090B",
      touches: []
    },
    _stageRect: { left: 0, top: 130, width: 390, height: 540 },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    }
  };
  if (!liveTimers) {
    context._maybeScheduleSelection = () => {};
    context._cancelSelection = () => {};
    context._startTooManyTimer = () => {};
    context._startWinnerTransitionFallback = () => {};
  }
  return context;
}

function createSelectorQueryHarness() {
  const requests = [];
  return {
    requests,
    wx: {
      createSelectorQuery() {
        const request = {};
        requests.push(request);
        return {
          select(selector) {
            request.selector = selector;
            return this;
          },
          boundingClientRect(callback) {
            request.rectCallback = callback;
            return this;
          },
          exec(callback) {
            request.execCallback = callback;
            return this;
          }
        };
      }
    },
    complete(index, rect) {
      const request = requests[index];
      assert.ok(request, `selector query ${index} should exist`);
      request.rectCallback(rect);
      request.execCallback();
    }
  };
}

function withGlobalWx(wxValue, run) {
  const previousWx = global.wx;
  global.wx = wxValue;
  try {
    return run();
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
}

function makeRawTouches(count, startIdentifier = 0) {
  return Array.from({ length: count }, (_, index) => ({
    identifier: startIdentifier + index,
    clientX: 80 + index * 40,
    clientY: 220 + index * 20
  }));
}

test("Chwazi timing, reference geometry and touch limits are explicit", () => {
  assert.equal(MIN_TOUCHES, 2);
  assert.equal(MAX_TOUCHES, 5);
  assert.equal(PROGRESS_DURATION_MS, 1500);
  assert.equal(SELECT_DELAY_MS, 350);
  assert.equal(TOO_MANY_DURATION_MS, 3000);
  assert.equal(WINNER_TRANSITION_DURATION_MS, 480);
  assert.equal(DESIGN_WIDTH_PX, 390);
  assert.equal(STAGE_HEIGHT_PX, 540);
  assert.equal(TOUCH_DIAMETER_PX, 120);
});

test("Chwazi progress clamps between zero and one", () => {
  assert.equal(getProgress(1000, 500, 1500), 0);
  assert.equal(getProgress(1000, 1750, 1500), 0.5);
  assert.equal(getProgress(1000, 3000, 1500), 1);
  assert.equal(getProgress(null, 3000, 1500), 0);
  assert.equal(getProgress("", 3000, 1500), 0);
});

test("Chwazi identifies touches and uses the five prototype colors", () => {
  assert.equal(getTouchId({ identifier: 7 }, 0), "7");
  assert.equal(getTouchId({}, 2), "touch-2");
  assert.deepEqual(getTouchColor(0), { outer: "#FFD500", inner: "#FFE663" });
  assert.deepEqual(getTouchColor(4), { outer: "#49B675", inner: "#75D69B" });
  assert.equal(getAvailableTouchColorIndex(new Set([0, 2, 3])), 1);
});

test("touch coordinates normalize to the 390px Pencil stage at different screen widths", () => {
  for (const width of [375, 390, 430]) {
    const scale = width / 390;
    const rect = { left: 12, top: 96, width, height: 540 * scale };
    const position = normalizeTouchPosition({
      clientX: rect.left + 233 * scale,
      clientY: rect.top + 371 * scale
    }, rect);
    assert.ok(Math.abs(position.xPx - 233) < 0.0001);
    assert.ok(Math.abs(position.yPx - 371) < 0.0001);
  }

  assert.deepEqual(
    normalizeTouchPosition({ clientX: -50, clientY: -50 }, { left: 0, top: 0, width: 390, height: 540 }),
    { xPx: 60, yPx: 60 }
  );
  assert.equal(
    normalizeTouchPosition(
      { clientX: 100, clientY: -30 },
      { left: 0, top: 0, width: 390, height: 540 },
      { minY: -42, maxY: 480 }
    ).yPx,
    -30
  );
  assert.equal(normalizeTouchPosition({ clientX: 100, clientY: 100 }, null), null);
  assert.equal(normalizeTouchPosition({}, { left: 0, top: 0, width: 390, height: 540 }), null);
});

test("touches in the gap above the visual stage remain inside the interactive surface", () => {
  const page = createPageContext(loadPageDefinition());
  const position = page._getTouchPosition({ clientX: 195, clientY: 100 });
  assert.equal(position.xPx, 195);
  assert.equal(position.yPx, -30);
});

test("fallback geometry fills the viewport down to the bottom safe area", () => {
  const page = createPageContext(loadPageDefinition());
  const windowInfo = {
    windowWidth: 390,
    windowHeight: 844,
    statusBarHeight: 47,
    safeAreaInsets: { bottom: 34 }
  };
  page._windowInfo = windowInfo;

  withGlobalWx({ getWindowInfo: () => windowInfo }, () => {
    page._setFallbackStageRect("idle");
  });

  assert.equal(page._stageRect.top, 133);
  assert.ok(Math.abs(page._stageRect.height - 677) < 0.01);
  const bottomPosition = page._getTouchPosition({ clientX: 195, clientY: 790 });
  assert.ok(Math.abs(bottomPosition.yPx - 617) < 0.01);
  assert.ok(Math.abs(bottomPosition.yPx + TOUCH_DIAMETER_PX / 2 - 677) < 0.01);
});

test("selection only becomes eligible after the newest participant deadline", () => {
  assert.equal(getSelectionWaitMs([{ startedAt: 100 }], 100), null);
  assert.equal(getSelectionWaitMs([{ startedAt: 100 }, { startedAt: 400 }], 400), 1850);
  assert.equal(getSelectionWaitMs([{ startedAt: 100 }, { startedAt: 400 }], 2250), 0);
});

test("one touch never selects while two touches select at the absolute deadline", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100 });
  const definition = loadPageDefinition();
  const oneTouchPage = createPageContext(definition, { liveTimers: true });
  oneTouchPage._syncTouches(makeRawTouches(1));
  t.mock.timers.tick(PROGRESS_DURATION_MS + SELECT_DELAY_MS + 1);
  assert.equal(oneTouchPage.data.status, "touching");
  assert.equal(oneTouchPage.data.touches.length, 1);
  assert.ok(!oneTouchPage._selectionTimer);

  const twoTouchPage = createPageContext(definition, { liveTimers: true });
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    twoTouchPage._syncTouches(makeRawTouches(2));
    t.mock.timers.tick(PROGRESS_DURATION_MS + SELECT_DELAY_MS - 1);
    assert.equal(twoTouchPage.data.status, "touching");
    t.mock.timers.tick(1);
    assert.equal(twoTouchPage.data.status, "selected");
    assert.equal(twoTouchPage.data.touches[0].id, "0");
    assert.equal(twoTouchPage.data.winnerTransitioning, true);
    assert.equal(twoTouchPage.data.touches.length, 1);
    assert.equal(twoTouchPage.data.winnerTouchId, "0");
  } finally {
    Math.random = originalRandom;
  }
});

test("the newest participant owns the deadline and moving does not restart it", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100 });
  const page = createPageContext(loadPageDefinition(), { liveTimers: true });
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    page._syncTouches(makeRawTouches(1));
    t.mock.timers.tick(500);
    page._syncTouches(makeRawTouches(2));
    const selectionTimer = page._selectionTimer;
    const firstStartedAt = page.data.touches[0].startedAt;
    page._syncTouches([
      { identifier: 0, clientX: 120, clientY: 280 },
      { identifier: 1, clientX: 260, clientY: 360 }
    ]);
    assert.equal(page._selectionTimer, selectionTimer);
    assert.equal(page.data.touches[0].startedAt, firstStartedAt);

    t.mock.timers.tick(PROGRESS_DURATION_MS + SELECT_DELAY_MS - 1);
    assert.equal(page.data.status, "touching");
    t.mock.timers.tick(1);
    assert.equal(page.data.status, "selected");
  } finally {
    Math.random = originalRandom;
  }
});

test("removing a participant cancels the stale selection deadline", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100 });
  const page = createPageContext(loadPageDefinition(), { liveTimers: true });
  page._syncTouches(makeRawTouches(2));
  assert.ok(page._selectionTimer);
  t.mock.timers.tick(500);
  page._syncTouches([makeRawTouches(2)[0]]);
  assert.ok(!page._selectionTimer);
  t.mock.timers.tick(PROGRESS_DURATION_MS + SELECT_DELAY_MS);
  assert.equal(page.data.status, "touching");
  assert.equal(page.data.touches.length, 1);
});

test("touch colors survive movement and remain unique when participants change", () => {
  const page = createPageContext(loadPageDefinition());
  page._syncTouches([{ identifier: 1, clientX: 100, clientY: 300 }]);
  const firstColor = {
    outer: page.data.touches[0].outerColor,
    inner: page.data.touches[0].innerColor
  };

  page._syncTouches([
    { identifier: 1, clientX: 110, clientY: 310 },
    { identifier: 2, clientX: 260, clientY: 360 }
  ]);
  assert.deepEqual(
    { outer: page.data.touches[0].outerColor, inner: page.data.touches[0].innerColor },
    firstColor
  );
  assert.notEqual(page.data.touches[0].colorIndex, page.data.touches[1].colorIndex);

  page._syncTouches([{ identifier: 2, clientX: 260, clientY: 360 }]);
  const retainedColorIndex = page.data.touches[0].colorIndex;
  page._syncTouches([
    { identifier: 2, clientX: 260, clientY: 360 },
    { identifier: 3, clientX: 160, clientY: 260 }
  ]);
  assert.equal(page.data.touches[0].colorIndex, retainedColorIndex);
  assert.notEqual(page.data.touches[0].colorIndex, page.data.touches[1].colorIndex);
});

test("rapid touchmove events apply only the latest positions once per frame", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = createPageContext(loadPageDefinition());
  const updates = [];
  page._syncTouches = (touches) => updates.push(touches);

  page.onStageTouchMove({ touches: [{ identifier: 1, clientX: 100, clientY: 200 }] });
  page.onStageTouchMove({ touches: [{ identifier: 1, clientX: 140, clientY: 240 }] });

  t.mock.timers.tick(15);
  assert.equal(updates.length, 0);
  t.mock.timers.tick(1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0].clientX, 140);
  assert.equal(updates[0][0].clientY, 240);
});

test("touchend cancels a stale queued move before applying the final state", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = createPageContext(loadPageDefinition());
  const updates = [];
  page._syncTouches = (touches) => updates.push(touches);

  page.onStageTouchMove({ touches: [{ identifier: 1, clientX: 140, clientY: 240 }] });
  page.onStageTouchEnd({ touches: [] });
  t.mock.timers.tick(16);

  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], []);
});

test("progress ring uses one rounded canvas arc without a split radial seam", () => {
  const calls = [];
  const context = {
    clearRect: (...args) => calls.push(["clearRect", ...args]),
    beginPath: () => calls.push(["beginPath"]),
    setStrokeStyle: (value) => calls.push(["setStrokeStyle", value]),
    setLineWidth: (value) => calls.push(["setLineWidth", value]),
    setLineCap: (value) => calls.push(["setLineCap", value]),
    arc: (...args) => calls.push(["arc", ...args]),
    stroke: () => calls.push(["stroke"]),
    draw: () => calls.push(["draw"])
  };
  const wxHarness = {
    createCanvasContext(canvasId) {
      calls.push(["createCanvasContext", canvasId]);
      return context;
    }
  };

  withGlobalWx(wxHarness, () => {
    const page = createPageContext(loadPageDefinition());
    page._stageRect.width = 375;
    page.data.status = "touching";
    page.data.touches = [{
      id: "1",
      canvasId: "chwazi-ring-1",
      startedAt: 100,
      outerColor: "#FFD500"
    }];
    const pending = page._drawTouchRings(850);
    const arc = calls.find((call) => call[0] === "arc");
    const lineWidth = calls.find((call) => call[0] === "setLineWidth");

    assert.equal(pending, true);
    assert.deepEqual(calls.find((call) => call[0] === "setLineCap"), ["setLineCap", "round"]);
    assert.ok(Math.abs(lineWidth[1] - 9 * 375 / 390) < 0.0001);
    assert.equal(arc.length, 7);
    assert.ok(Math.abs(arc[4] - (-Math.PI / 2)) < 0.0001);
    assert.ok(Math.abs(arc[5] - (Math.PI / 2)) < 0.0001);
  });
});

test("winner stays under the selected finger and over-five state cannot become a six-touch game", () => {
  const definition = loadPageDefinition();
  const page = createPageContext(definition);
  const winner = {
    id: "2",
    colorIndex: 1,
    innerColor: "#1198B9",
    outerColor: "#1C839B",
    leftRpx: 448.08,
    topRpx: 713.46,
    innerLeftRpx: 484.62,
    innerTopRpx: 750
  };

  page._showWinner(winner);
  assert.equal(page.data.status, "selected");
  assert.equal(page.data.pageBackground, "#1198B9");
  assert.equal(page.data.touches[0].leftRpx, winner.leftRpx);
  assert.equal(page.data.touches[0].topRpx, winner.topRpx);
  assert.equal(page.data.winnerTransitioning, true);
  assert.equal(page.data.winnerRevealOriginXpx, 293);
  assert.equal(page.data.winnerRevealOriginYpx, 559);

  let enteredTooMany = false;
  const overflowPage = createPageContext(definition);
  overflowPage._enterTooMany = () => { enteredTooMany = true; };
  overflowPage._syncTouches(Array.from({ length: 6 }, (_, index) => ({
    identifier: index,
    clientX: 80 + index,
    clientY: 220 + index
  })));
  assert.equal(enteredTooMany, true);
});

test("selected winner follows its original finger and moves the collapse center", () => {
  const page = createPageContext(loadPageDefinition());
  page._showWinner({
    id: "2",
    colorIndex: 1,
    innerColor: "#1198B9",
    outerColor: "#1C839B",
    leftRpx: 448.08,
    topRpx: 713.46,
    innerLeftRpx: 484.62,
    innerTopRpx: 750,
    xRpx: 563.46,
    yRpx: 828.85
  });
  const firstOrigin = {
    x: page.data.winnerRevealOriginXpx,
    y: page.data.winnerRevealOriginYpx
  };

  page._syncTouches([{ identifier: 2, clientX: 330, clientY: 300 }]);

  assert.equal(page.data.touches.length, 1);
  assert.equal(page.data.touches[0].id, "2");
  assert.notEqual(page.data.touches[0].xRpx, 563.46);
  assert.notEqual(page.data.winnerRevealOriginXpx, firstOrigin.x);
  assert.notEqual(page.data.winnerRevealOriginYpx, firstOrigin.y);
});

test("collapse radius starts at the farthest viewport corner instead of an oversized vmax circle", () => {
  const page = createPageContext(loadPageDefinition());
  page._windowInfo = { windowWidth: 390, windowHeight: 844 };
  const origin = { xPx: 293, yPx: 559 };
  const radius = page._getWinnerCollapseRadius(origin);
  const cornerDistances = [
    Math.hypot(origin.xPx, origin.yPx),
    Math.hypot(390 - origin.xPx, origin.yPx),
    Math.hypot(origin.xPx, 844 - origin.yPx),
    Math.hypot(390 - origin.xPx, 844 - origin.yPx)
  ];

  assert.equal(radius, Number(Math.max(...cornerDistances).toFixed(2)));
  assert.ok(radius < 844);
});

test("an old stage measurement cannot revive five cached touches after the sixth touch", () => {
  const harness = createSelectorQueryHarness();
  withGlobalWx(harness.wx, () => {
    const page = createPageContext(loadPageDefinition());
    page._stageRect = null;
    page._windowInfo = null;
    const fiveTouches = Array.from({ length: 5 }, (_, index) => ({
      identifier: index,
      clientX: 80 + index,
      clientY: 220 + index
    }));

    page._syncTouches(fiveTouches);
    assert.equal(page._pendingRawTouches.length, 5);
    assert.equal(page._touchStartedAtById.size, 5);

    page._syncTouches([...fiveTouches, { identifier: 5, clientX: 100, clientY: 240 }]);
    assert.equal(page.data.status, "tooMany");
    assert.equal(page._pendingRawTouches, null);
    assert.equal(page._touchStartedAtById.size, 0);

    harness.complete(0, { left: 0, top: 130, width: 390, height: 540 });
    assert.equal(page.data.status, "tooMany");
    assert.deepEqual(page.data.touches, []);
  });
});

test("touchstart detects a sixth identifier reported only through changedTouches", () => {
  const page = createPageContext(loadPageDefinition());
  const fiveTouches = makeRawTouches(5);

  page.onStageTouchStart({ touches: fiveTouches, changedTouches: [fiveTouches[4]] });
  assert.equal(page.data.status, "touching");
  assert.equal(page.data.touches.length, 5);

  page.onStageTouchStart({
    touches: fiveTouches,
    changedTouches: [{ identifier: 5, clientX: 300, clientY: 360 }]
  });
  assert.equal(page.data.status, "tooMany");
  assert.deepEqual(page.data.touches, []);
});

test("touchstart counts a changed sixth touch even without an identifier", () => {
  const page = createPageContext(loadPageDefinition());
  const fiveTouches = makeRawTouches(5);

  page.onStageTouchStart({ touches: fiveTouches, changedTouches: [fiveTouches[4]] });
  page.onStageTouchStart({
    touches: fiveTouches,
    changedTouches: [{ clientX: 300, clientY: 360 }]
  });

  assert.equal(page.data.status, "tooMany");
  assert.deepEqual(page.data.touches, []);
});

test("five tracked touches followed by touchcancel enter the delayed over-five fallback", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100 });
  const page = createPageContext(loadPageDefinition(), { liveTimers: true });
  const fiveTouches = makeRawTouches(5);

  page.onStageTouchStart({ touches: fiveTouches, changedTouches: [fiveTouches[4]] });
  assert.equal(page.data.status, "touching");
  assert.equal(page._getTrackedTouchCount(), 5);

  page.onStageTouchCancel({ touches: [], changedTouches: fiveTouches });

  assert.equal(page.data.status, "touching");
  t.mock.timers.tick(79);
  assert.equal(page.data.status, "touching");
  t.mock.timers.tick(1);
  assert.equal(page.data.status, "tooMany");
  assert.deepEqual(page.data.touches, []);
  assert.equal(page._latestTooManyTouchCount, 6);
});

test("page hide cancels the ambiguous five-touch fallback", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100 });
  const page = createPageContext(loadPageDefinition(), { liveTimers: true });
  const fiveTouches = makeRawTouches(5);

  page.onStageTouchStart({ touches: fiveTouches, changedTouches: [fiveTouches[4]] });
  page.onStageTouchCancel({ touches: [], changedTouches: fiveTouches });
  page.onHide();
  t.mock.timers.tick(80);

  assert.equal(page.data.status, "idle");
  assert.equal(page._tooManyCancellationTimer, null);
});

test("touchcancel below the device limit keeps the normal reset behavior", () => {
  const page = createPageContext(loadPageDefinition());
  const touches = makeRawTouches(4);

  page.onStageTouchStart({ touches, changedTouches: [touches[3]] });
  page.onStageTouchCancel({ touches: [], changedTouches: touches });

  assert.equal(page.data.status, "idle");
  assert.deepEqual(page.data.touches, []);
});

test("touch and selection sounds use the requested assets and fire once per event", () => {
  const contexts = [];
  const wxHarness = {
    createInnerAudioContext() {
      const context = {
        src: "",
        playCount: 0,
        stopCount: 0,
        paused: true,
        stop() { this.stopCount += 1; this.paused = true; },
        play() { this.playCount += 1; this.paused = false; },
        destroy() {}
      };
      contexts.push(context);
      return context;
    }
  };

  withGlobalWx(wxHarness, () => {
    const page = createPageContext(loadPageDefinition());
    page._initAudio();
    const firstTouches = makeRawTouches(1);
    page.onStageTouchStart({ touches: firstTouches, changedTouches: [firstTouches[0]] });
    page.onStageTouchStart({
      touches: makeRawTouches(2),
      changedTouches: [{ identifier: 1, clientX: 120, clientY: 240 }]
    });
    page._showWinner(page.data.touches[0]);
  });

  assert.equal(contexts.length, MAX_TOUCHES + 1);
  assert.equal(contexts[0].src, "/audio/chwazi-touch-down.wav");
  assert.equal(contexts[MAX_TOUCHES].src, "/audio/chwazi-selection.mp3");
  assert.equal(contexts[0].playCount, 1);
  assert.equal(contexts[1].playCount, 1);
  assert.equal(contexts[MAX_TOUCHES].playCount, 1);
  assert.equal(contexts.slice(2, MAX_TOUCHES).every((context) => context.playCount === 0), true);
  assert.equal(contexts.every((context) => context.stopCount === 0), true);
});

test("hidden and locked states stop or suppress audio feedback", () => {
  const contexts = [];
  withGlobalWx({
    createInnerAudioContext() {
      const context = {
        src: "",
        playCount: 0,
        stopCount: 0,
        paused: true,
        stop() { this.stopCount += 1; this.paused = true; },
        play() { this.playCount += 1; this.paused = false; },
        destroy() {}
      };
      contexts.push(context);
      return context;
    }
  }, () => {
    const page = createPageContext(loadPageDefinition());
    page._initAudio();
    page._playSelection();
    page.onHide();
    assert.equal(contexts[MAX_TOUCHES].stopCount, 1);

    page.data.status = "tooMany";
    page.onStageTouchStart({ touches: makeRawTouches(1), changedTouches: makeRawTouches(1) });
    page.data.status = "idle";
    page._waitForAllTouchesReleased = true;
    page.onStageTouchStart({ touches: makeRawTouches(1), changedTouches: makeRawTouches(1) });
  });

  assert.equal(contexts.slice(0, MAX_TOUCHES).every((context) => context.playCount === 0), true);
});

test("touch-down WAV starts within 15ms instead of carrying leading silence", () => {
  const audio = fs.readFileSync(path.join(pageDir, "../../audio/chwazi-touch-down.wav"));
  assert.equal(audio.toString("ascii", 0, 4), "RIFF");
  assert.equal(audio.toString("ascii", 8, 12), "WAVE");
  assert.equal(audio.readUInt16LE(20), 1);
  const channelCount = audio.readUInt16LE(22);
  const sampleRate = audio.readUInt32LE(24);
  const bitsPerSample = audio.readUInt16LE(34);
  assert.equal(channelCount, 2);
  assert.equal(sampleRate, 48000);
  assert.equal(bitsPerSample, 16);

  const dataOffset = 44;
  const sampleCount = (audio.length - dataOffset) / 2;
  let peak = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    peak = Math.max(peak, Math.abs(audio.readInt16LE(dataOffset + index * 2)));
  }
  const threshold = peak * 0.01;
  let onsetFrame = null;
  for (let sample = 0; sample < sampleCount; sample += channelCount) {
    let framePeak = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      framePeak = Math.max(framePeak, Math.abs(audio.readInt16LE(dataOffset + (sample + channel) * 2)));
    }
    if (framePeak >= threshold) {
      onsetFrame = sample / channelCount;
      break;
    }
  }
  assert.notEqual(onsetFrame, null);
  assert.ok(onsetFrame / sampleRate * 1000 < 15);
});

test("selection MP3 uses the trimmed stream without the two leading frames", () => {
  const audio = fs.readFileSync(path.join(pageDir, "../../audio/chwazi-selection.mp3"));
  assert.equal(audio.subarray(0, 4).toString("hex"), "fffbd244");
  assert.equal(audio.subarray(0, 1024).includes(Buffer.from("LAME3.100")), false);
  assert.ok(audio.length < 76000);
});

test("selection triggers one short vibration", () => {
  const calls = [];
  withGlobalWx({
    vibrateShort(options) { calls.push(options); }
  }, () => {
    const page = createPageContext(loadPageDefinition());
    page._showWinner({ id: "0", innerColor: "#FFE663", outerColor: "#FFD500" });
    page._showWinner({ id: "1", innerColor: "#1198B9", outerColor: "#1C839B" });
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].type, "medium");
  assert.equal(calls[1].type, "medium");
});

test("over-five warning stays locked for three seconds and then requires release", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100 });
  const page = createPageContext(loadPageDefinition(), { liveTimers: true });
  page._syncTouches(makeRawTouches(6));
  assert.equal(page.data.status, "tooMany");
  const warningTimer = page._tooManyTimer;

  page._syncTouches([]);
  page._syncTouches(makeRawTouches(2));
  page.onStageTouchStart({ touches: makeRawTouches(6), changedTouches: [] });
  assert.equal(page.data.status, "tooMany");
  assert.equal(page._tooManyTimer, warningTimer);

  t.mock.timers.tick(TOO_MANY_DURATION_MS - 1);
  assert.equal(page.data.status, "tooMany");
  t.mock.timers.tick(1);
  assert.equal(page.data.status, "idle");
  assert.equal(page._waitForAllTouchesReleased, true);

  page._syncTouches(makeRawTouches(2));
  assert.equal(page.data.status, "idle");
  assert.deepEqual(page.data.touches, []);
  page._syncTouches([]);
  assert.equal(page._waitForAllTouchesReleased, false);
  page._syncTouches(makeRawTouches(2));
  assert.equal(page.data.status, "touching");
});

test("releasing every finger during the warning restores an unlocked idle state", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100 });
  const page = createPageContext(loadPageDefinition(), { liveTimers: true });
  page._syncTouches(makeRawTouches(6));
  page._syncTouches([]);
  t.mock.timers.tick(TOO_MANY_DURATION_MS);
  assert.equal(page.data.status, "idle");
  assert.equal(page._waitForAllTouchesReleased, false);
  page._syncTouches(makeRawTouches(2));
  assert.equal(page.data.status, "touching");
});

test("winner transition completion is idempotent and stale animation events are ignored", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100 });
  const page = createPageContext(loadPageDefinition(), { liveTimers: true });
  const touches = [
    {
      id: "0",
      innerColor: "#FFE663",
      outerColor: "#FFD500",
      xRpx: 192.31,
      yRpx: 326.92,
      leftRpx: 76.92,
      topRpx: 211.54
    },
    {
      id: "1",
      innerColor: "#1198B9",
      outerColor: "#1C839B",
      xRpx: 563.46,
      yRpx: 828.85,
      leftRpx: 448.08,
      topRpx: 713.46
    }
  ];
  page.data.touches = touches;
  page._showWinner(touches[1]);
  const firstTransitionId = page.data.winnerTransitionId;
  assert.equal(page.data.winnerTransitioning, true);

  page.onWinnerTransitionEnd({
    target: { id: "winner-curtain-touch-child" },
    currentTarget: { dataset: { transitionId: firstTransitionId } }
  });
  assert.equal(page.data.winnerTransitioning, true);
  page.onWinnerTransitionEnd({
    target: { id: "qa-chwazi-winner-collapse-disc" },
    currentTarget: { dataset: { transitionId: firstTransitionId } }
  });
  assert.equal(page.data.status, "selected");
  assert.equal(page.data.winnerTransitioning, false);
  t.mock.timers.tick(WINNER_TRANSITION_DURATION_MS + 120);
  assert.equal(page.data.status, "selected");

  page._resetGame();
  page.data.touches = touches;
  page._showWinner(touches[0]);
  const secondTransitionId = page.data.winnerTransitionId;
  assert.notEqual(secondTransitionId, firstTransitionId);
  page.onWinnerTransitionEnd({
    target: { id: "qa-chwazi-winner-collapse-disc" },
    currentTarget: { dataset: { transitionId: firstTransitionId } }
  });
  assert.equal(page.data.winnerTransitioning, true);
  t.mock.timers.tick(WINNER_TRANSITION_DURATION_MS + 119);
  assert.equal(page.data.winnerTransitioning, true);
  t.mock.timers.tick(1);
  assert.equal(page.data.winnerTransitioning, false);
});

test("only the latest forced stage measurement can update geometry", () => {
  const rectA = { left: 0, top: 130, width: 390, height: 540 };
  const rectB = { left: 0, top: 126, width: 430, height: 595.38 };

  for (const completionOrder of [[1, 0], [0, 1]]) {
    const harness = createSelectorQueryHarness();
    withGlobalWx(harness.wx, () => {
      const page = createPageContext(loadPageDefinition());
      page._measureStage();
      page._measureStage(true);
      assert.equal(page._stageMeasureGeneration, 2);
      assert.equal(page._stageMeasurePending, true);

      for (const index of completionOrder) {
        harness.complete(index, index === 0 ? rectA : rectB);
        if (index === 0 && completionOrder[0] === 0) {
          assert.equal(page._stageMeasurePending, true);
        }
      }

      assert.equal(page._stageMeasurePending, false);
      assert.equal(page._stageRect, rectB);
    });
  }
});

test("cached touches retain their own first-seen times while stage geometry is pending", () => {
  const harness = createSelectorQueryHarness();
  const originalNow = Date.now;
  withGlobalWx(harness.wx, () => {
    try {
      let now = 100;
      Date.now = () => now;
      const page = createPageContext(loadPageDefinition());
      page._stageRect = null;
      page._windowInfo = null;

      page._syncTouches([{ identifier: 1, clientX: 100, clientY: 300 }]);
      now = 400;
      page._syncTouches([
        { identifier: 1, clientX: 100, clientY: 300 },
        { identifier: 2, clientX: 260, clientY: 360 }
      ]);
      now = 600;
      harness.complete(0, { left: 0, top: 130, width: 390, height: 540 });

      const byId = new Map(page.data.touches.map((touch) => [touch.id, touch]));
      assert.equal(byId.get("1").startedAt, 100);
      assert.equal(byId.get("2").startedAt, 400);
      assert.equal(page._pendingRawTouches, null);
    } finally {
      Date.now = originalNow;
    }
  });
});

test("missing geometry pauses timers and caches only the current participants", () => {
  const page = createPageContext(loadPageDefinition());
  let cancelCount = 0;
  let winnerCount = 0;
  page._stageRect = null;
  page._windowInfo = null;
  page.data.status = "touching";
  page.data.touches = [{ id: "1" }, { id: "2" }];
  page._cancelSelection = () => { cancelCount += 1; };
  page._showWinner = () => { winnerCount += 1; };
  page._measureStage = () => {};

  page._syncTouches([{ identifier: 2, clientX: 260, clientY: 360 }]);

  assert.equal(cancelCount, 1);
  assert.equal(winnerCount, 0);
  assert.deepEqual(page._pendingRawTouches.map((touch) => touch.identifier), [2]);
});

test("selected result stays locked until every finger is lifted", () => {
  const page = createPageContext(loadPageDefinition());
  page._touchStartedAtById = new Map([["2", 100]]);
  page._showWinner({
    id: "2",
    innerColor: "#1198B9",
    outerColor: "#1C839B",
    leftRpx: 448.08,
    topRpx: 713.46
  });
  const selectedSnapshot = JSON.parse(JSON.stringify(page.data));
  page._enterTooMany = () => { throw new Error("selected result must not enter tooMany"); };

  page._syncTouches(Array.from({ length: 6 }, (_, index) => ({ identifier: index })));
  assert.deepEqual(page.data, selectedSnapshot);

  page._syncTouches([]);
  assert.equal(page.data.status, "selected");
  page.onWinnerTransitionEnd({
    target: { id: "qa-chwazi-winner-collapse-disc" },
    currentTarget: { dataset: { transitionId: page.data.winnerTransitionId } }
  });
  assert.equal(page.data.status, "idle");
  assert.deepEqual(page.data.touches, []);
  assert.equal(page._touchStartedAtById.size, 0);
});

test("Chwazi page matches the Pencil stage, ring and over-five presentation", () => {
  const js = fs.readFileSync(path.join(pageDir, "chwazi.js"), "utf8");
  const wxml = fs.readFileSync(path.join(pageDir, "chwazi.wxml"), "utf8");
  const wxss = fs.readFileSync(path.join(pageDir, "chwazi.wxss"), "utf8");
  const json = JSON.parse(fs.readFileSync(path.join(pageDir, "chwazi.json"), "utf8"));

  assert.match(js, /onStageTouchStart/);
  assert.match(js, /MIN_TOUCHES/);
  assert.match(js, /MAX_TOUCHES/);
  assert.match(js, /TOO_MANY_DURATION_MS/);
  assert.match(js, /WINNER_TRANSITION_DURATION_MS/);
  assert.match(js, /Math\.random\(\) \* this\.data\.touches\.length/);
  assert.doesNotMatch(js, /setInterval|clearInterval|TICK_MS|_startTicker|_tick\s*\(/);
  assert.match(wxml, /catchtouchstart="onStageTouchStart"/);
  assert.match(wxml, /catchtouchmove="onStageTouchMove"/);
  assert.match(wxml, /catchtouchend="onStageTouchEnd"/);
  assert.match(wxml, /id="qa-chwazi-touch-surface"[\s\S]*?catchtouchstart="onStageTouchStart"/);
  assert.doesNotMatch(wxml, /id="qa-chwazi-stage"[\s\S]*?catchtouchstart="onStageTouchStart"/);
  assert.match(wxml, /canvas-id="\{\{item\.canvasId\}\}"/);
  assert.doesNotMatch(wxml, /conic-gradient\(|touch-ring-half|touch-ring-cutout|touch-ring-cap/);
  assert.match(wxml, /id="qa-chwazi-winner-curtain"/);
  assert.match(wxml, /data-transition-id="\{\{winnerTransitionId\}\}"/);
  assert.match(wxml, /left: \{\{winnerRevealOriginXpx\}\}px; top: \{\{winnerRevealOriginYpx\}\}px; width: \{\{winnerCollapseDiameterPx\}\}px; height: \{\{winnerCollapseDiameterPx\}\}px;/);
  assert.match(wxml, /bindanimationend="onWinnerTransitionEnd"/);
  assert.match(wxml, /id="qa-chwazi-winner-collapse-disc"/);
  assert.match(wxml, /id="qa-chwazi-stage"/);
  assert.match(js, /iPhone 不支持 5 个以上的触摸/);
  assert.match(js, /tooManyMessage: " iPhone/);
  assert.match(js, /都打羽毛球去了/);
  assert.doesNotMatch(js, /都去打羽毛球去了/);
  assert.doesNotMatch(wxml, /请所有人按住屏幕|选中啦|touch-ring-track/);
  assert.match(wxss, /\.chwazi-navbar-inner\s*{[\s\S]*?height:\s*84\.61538rpx/);
  assert.match(wxss, /\.chwazi-back image\s*{[\s\S]*?transform:\s*translateX\(-7\.69231rpx\)/);
  assert.match(wxss, /\.chwazi-page\s*{[\s\S]*?display:\s*flex;[\s\S]*?height:\s*100vh;[\s\S]*?flex-direction:\s*column/);
  assert.match(wxss, /\.chwazi-touch-surface\s*{[\s\S]*?display:\s*flex;[\s\S]*?flex:\s*1 1 auto;[\s\S]*?flex-direction:\s*column;[\s\S]*?padding-top:\s*80\.76923rpx/);
  assert.match(wxss, /\.chwazi-touch-surface--selected\s*{[\s\S]*?padding-top:\s*76\.92308rpx/);
  assert.match(wxss, /\.chwazi-stage\s*{[\s\S]*?min-height:\s*0;[\s\S]*?flex:\s*1 1 auto/);
  assert.doesNotMatch(wxss, /\.chwazi-stage(?:--selected)?\s*{[\s\S]*?height:\s*(?:1038\.46|1269\.23077)rpx/);
  assert.match(wxml, /class="chwazi-bottom-safe-area" style="height: \{\{bottomSafeAreaRpx\}\}rpx;"/);
  assert.match(js, /setLineCap\("round"\)/);
  assert.match(js, /context\.arc\([\s\S]*?Math\.PI \* 2 \* progress/);
  assert.match(wxss, /\.touch-ring-canvas\s*{[\s\S]*?width:\s*230\.77rpx;[\s\S]*?height:\s*230\.77rpx/);
  assert.match(wxss, /\.chwazi-touch-surface\s*{[\s\S]*?overflow:\s*hidden/);
  assert.doesNotMatch(wxss, /chwazi-ring-right|chwazi-ring-left|touch-ring-arc/);
  assert.match(wxss, /\.chwazi-winner-collapse-disc\s*{[\s\S]*?border-radius:\s*50%;[\s\S]*?animation-name:\s*chwazi-collapse-to-winner;[\s\S]*?animation-duration:\s*480ms;/);
  assert.doesNotMatch(wxss, /300vmax|150vmax/);
  assert.match(wxss, /@keyframes chwazi-collapse-to-winner\s*{[\s\S]*?from\s*{\s*transform:\s*translate\(-50%, -50%\) scale\(1\);[\s\S]*?to\s*{\s*transform:\s*translate\(-50%, -50%\) scale\(0\);/);
  assert.match(wxss, /\.touch-point--selected::before/);
  assert.match(wxss, /\.chwazi-too-many\s*{[\s\S]*?top:\s*453\.85rpx;[\s\S]*?z-index:\s*10;[\s\S]*?line-height:\s*1\.45/);
  assert.equal(json.disableScroll, true);
  assert.equal(json.navigationBarTextStyle, "white");
});
