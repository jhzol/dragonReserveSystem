const test = require("node:test");
const assert = require("node:assert/strict");
const {
  daysInMonth,
  buildMinutes,
  roundUpToMinuteStep,
  formatDayWithWeekday,
  buildDayLabels,
  buildPickerState
} = require("../utils/dateTimePicker");

test("daysInMonth handles leap years and month lengths", () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 7), 31);
});

test("buildMinutes uses five-minute steps and preserves legacy minute", () => {
  assert.deepEqual(buildMinutes(5), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  assert.deepEqual(buildMinutes(5, 7), [0, 5, 7, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
});

test("roundUpToMinuteStep rounds across day boundary", () => {
  assert.equal(roundUpToMinuteStep(new Date(2026, 7, 16, 23, 58, 20), 5).getTime(), new Date(2026, 7, 17, 0, 0, 0).getTime());
  assert.equal(roundUpToMinuteStep(new Date(2026, 7, 16, 9, 10, 1), 5).getTime(), new Date(2026, 7, 16, 9, 15, 0).getTime());
  assert.equal(roundUpToMinuteStep(new Date(2026, 7, 16, 9, 10, 0), 5).getTime(), new Date(2026, 7, 16, 9, 10, 0).getTime());
});

test("date picker day labels include the weekday for every rendered date", () => {
  assert.equal(formatDayWithWeekday(2026, 8, 14), "14日 · 周五");
  assert.deepEqual(buildDayLabels(2026, 8).slice(11, 16), [
    "12日 · 周三",
    "13日 · 周四",
    "14日 · 周五",
    "15日 · 周六",
    "16日 · 周日"
  ]);
});

test("buildPickerState maps date, time and datetime indexes", () => {
  const now = new Date(2026, 7, 16, 9, 0, 0);
  const date = buildPickerState({ mode: "date", value: "2028-02-29", now });
  assert.deepEqual(date.pickerValue, [4, 1, 28]);
  assert.equal(date.days.length, 29);
  assert.equal(date.dayLabels[28], "29日 · 周二");
  assert.equal(date.yearLabels[date.pickerValue[0]], "2028");

  const time = buildPickerState({ mode: "time", value: "09:07", now });
  assert.equal(time.hours[time.pickerValue[0]], 9);
  assert.equal(time.minutes[time.pickerValue[1]], 7);

  const datetime = buildPickerState({ mode: "datetime", value: "2026-08-16 13:35", now });
  assert.equal(datetime.years[datetime.pickerValue[0]], 2026);
  assert.equal(datetime.months[datetime.pickerValue[1]], 8);
  assert.equal(datetime.days[datetime.pickerValue[2]], 16);
  assert.equal(datetime.hours[datetime.pickerValue[3]], 13);
  assert.equal(datetime.minutes[datetime.pickerValue[4]], 35);
  assert.equal(datetime.dayLabels[datetime.pickerValue[2]], "16日 · 周日");
  assert.equal(datetime.yearLabels[datetime.pickerValue[0]], "26");
});

function loadPickerComponentDefinition() {
  const componentPath = require.resolve("../components/date-time-picker-sheet/index.js");
  const previousComponent = global.Component;
  let definition;
  global.Component = (value) => { definition = value; };
  delete require.cache[componentPath];
  require(componentPath);
  global.Component = previousComponent;
  return definition;
}

function applyComponentPatch(context, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const indexed = key.match(/^(\w+)\[(\d+)]$/);
    if (!indexed) {
      context.data[key] = value;
      return;
    }
    const list = (context.data[indexed[1]] || []).slice();
    list[Number(indexed[2])] = value;
    context.data[indexed[1]] = list;
  });
}

test("picker initialization does not write observed mode property", () => {
  const definition = loadPickerComponentDefinition();
  let patch;
  const context = {
    properties: {
      mode: "datetime",
      value: "2026-08-17 19:30",
      minYear: 0,
      maxYear: 0,
      minuteStep: 5
    },
    setData(value) { patch = value; }
  };

  definition.methods.initializePicker.call(context);

  assert.equal(Object.prototype.hasOwnProperty.call(patch, "mode"), false);
  assert.deepEqual(patch.pickerValue.length, 5);
  assert.equal(patch.showDate, true);
  assert.equal(patch.showTime, true);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "selectedHourIndex"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "selectedMinuteIndex"), false);
});

test("datetime wheel keeps all five column indexes without delayed visual-selection state", () => {
  const definition = loadPickerComponentDefinition();
  let patch;
  const context = {
    data: {
      mode: "datetime",
      years: [2026],
      months: Array.from({ length: 12 }, (_, index) => index + 1)
    },
    setData(value) { patch = value; }
  };

  definition.methods.onPickerChange.call(context, {
    detail: { value: [0, 7, 16, 19, 6] }
  });

  assert.deepEqual(patch.pickerValue, [0, 7, 16, 19, 6]);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "selectedHourIndex"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "selectedMinuteIndex"), false);
});

test("flat swiper column updates only its own index and keeps all five datetime values", () => {
  const definition = loadPickerComponentDefinition();
  let patch;
  const context = {
    ...definition.methods,
    data: {
      mode: "datetime",
      pickerValue: [0, 7, 16, 19, 6],
      hourColumnIndex: 3,
      minuteColumnIndex: 4,
      years: [2026],
      months: Array.from({ length: 12 }, (_, index) => index + 1)
    },
    setData(value) { patch = value; }
  };

  definition.methods.onFlatColumnChange.call(context, {
    currentTarget: { dataset: { column: 4 } },
    detail: { current: 7 }
  });

  assert.equal(patch["pickerValue[4]"], 7);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "pickerValue"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "days"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "dayLabels"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "minuteSwiperIndex"), false);
  assert.equal(patch.minutePickerIndex, 7);
});

test("rapid touch-driven enum changes stay local and do not call audio or haptic APIs", () => {
  const definition = loadPickerComponentDefinition();
  const previousWx = global.wx;
  let audioCreateCount = 0;
  let vibrationCount = 0;
  global.wx = {
    createInnerAudioContext() { audioCreateCount += 1; },
    vibrateShort() { vibrationCount += 1; }
  };

  try {
    let patch;
    const context = {
      ...definition.methods,
      data: { mode: "time", pickerValue: [3, 4] },
      setData(value) {
        patch = value;
        applyComponentPatch(this, value);
      }
    };

    for (let current = 4; current <= 10; current += 1) {
      definition.methods.onFlatColumnChange.call(context, {
        currentTarget: { dataset: { column: 0 } },
        detail: { current, source: "touch" }
      });
    }
    definition.methods.onFlatColumnChange.call(context, {
      currentTarget: { dataset: { column: 1 } },
      detail: { current: 5, source: "" }
    });
    assert.equal(audioCreateCount, 0);
    assert.equal(vibrationCount, 0);
    assert.deepEqual(context.data.pickerValue, [10, 5]);
    assert.equal(Object.prototype.hasOwnProperty.call(patch, "minuteSwiperIndex"), false);
  } finally {
    global.wx = previousWx;
  }
});

test("changing year or month rebuilds weekday labels for the day column", () => {
  const definition = loadPickerComponentDefinition();
  let patch;
  const context = {
    data: {
      mode: "date",
      years: [2026, 2027],
      months: Array.from({ length: 12 }, (_, index) => index + 1)
    },
    setData(value) { patch = value; }
  };

  definition.methods.onPickerChange.call(context, {
    detail: { value: [1, 1, 27] }
  });

  assert.equal(patch.days.length, 28);
  assert.equal(patch.dayLabels[0], "01日 · 周一");
  assert.equal(patch.dayLabels[27], "28日 · 周日");
});
