const {
  clamp,
  daysInMonth,
  range,
  formatDate,
  formatTime,
  buildDayLabels,
  buildPickerState
} = require("../../utils/dateTimePicker");

Component({
  options: {
    styleIsolation: "isolated"
  },

  properties: {
    visible: { type: Boolean, value: false },
    mode: { type: String, value: "datetime" },
    title: { type: String, value: "选择日期和时间" },
    value: { type: String, value: "" },
    embedded: { type: Boolean, value: false },
    bottomOffsetRpx: { type: Number, value: 0 },
    minYear: { type: Number, value: 0 },
    maxYear: { type: Number, value: 0 },
    minuteStep: { type: Number, value: 5 }
  },

  data: {
    containerRendered: false,
    containerVisible: false,
    years: [],
    yearLabels: [],
    months: [],
    days: [],
    dayLabels: [],
    hours: [],
    minutes: [],
    pickerValue: [],
    yearSwiperIndex: 0,
    monthSwiperIndex: 0,
    daySwiperIndex: 0,
    hourColumnIndex: 3,
    minuteColumnIndex: 4,
    hourPickerIndex: 0,
    minutePickerIndex: 0,
    hourSwiperIndex: 0,
    minuteSwiperIndex: 0,
    showDate: true,
    showTime: true
  },

  observers: {
    "visible, mode, value, minYear, maxYear, minuteStep, embedded": function (visible) {
      if (visible) {
        this.initializePicker(() => this.mountContainer());
      } else {
        this.unmountContainer();
      }
    }
  },

  lifetimes: {
    attached() {
      if (this.properties.visible) {
        this.initializePicker(() => this.mountContainer());
      }
    }
  },

  methods: {
    mountContainer() {
      if (this._leaveTimer) {
        clearTimeout(this._leaveTimer);
        this._leaveTimer = null;
      }
      this.setData({ containerRendered: true, containerVisible: false }, () => {
        wx.nextTick(() => {
          if (this.properties.visible) this.setData({ containerVisible: true });
        });
      });
    },

    unmountContainer() {
      this.setData({ containerVisible: false });
      if (!this.properties.embedded) return;
      if (this._leaveTimer) clearTimeout(this._leaveTimer);
      this._leaveTimer = setTimeout(() => {
        this._leaveTimer = null;
        if (!this.properties.visible) {
          this.setData({ containerRendered: false });
          this.triggerEvent("afterleave");
        }
      }, 220);
    },

    onContainerAfterLeave() {
      if (!this.properties.visible) {
        this.setData({ containerRendered: false });
        this.triggerEvent("afterleave");
      }
    },

    initializePicker(callback) {
      const pickerState = buildPickerState({
        mode: this.properties.mode,
        value: this.properties.value,
        minYear: this.properties.minYear,
        maxYear: this.properties.maxYear,
        minuteStep: this.properties.minuteStep
      });

      // mode 是 observer 监听的 property。这里若再次 setData({ mode })，
      // 微信运行时会反复触发 observer，导致选择器递归初始化并卡死模拟器。
      const { mode, ...renderState } = pickerState;
      const hourColumnIndex = renderState.showDate ? 3 : 0;
      const minuteColumnIndex = renderState.showDate ? 4 : 1;
      renderState.hourColumnIndex = hourColumnIndex;
      renderState.minuteColumnIndex = minuteColumnIndex;
      renderState.yearSwiperIndex = renderState.pickerValue[0] || 0;
      renderState.monthSwiperIndex = renderState.pickerValue[1] || 0;
      renderState.daySwiperIndex = renderState.pickerValue[2] || 0;
      renderState.hourPickerIndex = renderState.pickerValue[hourColumnIndex] || 0;
      renderState.minutePickerIndex = renderState.pickerValue[minuteColumnIndex] || 0;
      renderState.hourSwiperIndex = renderState.hourPickerIndex;
      renderState.minuteSwiperIndex = renderState.minutePickerIndex;
      this.setData(renderState, callback);
    },

    stopPropagation() {},

    onClose() {
      this.triggerEvent("close");
    },

    onPickerChange(e) {
      const mode = this.data.mode;
      const next = (e.detail && e.detail.value ? e.detail.value : []).slice();
      if (mode === "time") {
        this.setData({
          pickerValue: next,
          hourPickerIndex: next[0] || 0,
          minutePickerIndex: next[1] || 0,
          hourSwiperIndex: next[0] || 0,
          minuteSwiperIndex: next[1] || 0
        });
        return;
      }

      const yearIndex = clamp(Number(next[0]) || 0, 0, this.data.years.length - 1);
      const monthIndex = clamp(Number(next[1]) || 0, 0, 11);
      const year = this.data.years[yearIndex];
      const month = this.data.months[monthIndex];
      const nextDays = range(1, daysInMonth(year, month));
      const dayIndex = clamp(Number(next[2]) || 0, 0, nextDays.length - 1);
      next[0] = yearIndex;
      next[1] = monthIndex;
      next[2] = dayIndex;
      this.setData({
        days: nextDays,
        dayLabels: buildDayLabels(year, month),
        pickerValue: next,
        yearSwiperIndex: next[0] || 0,
        monthSwiperIndex: next[1] || 0,
        daySwiperIndex: next[2] || 0,
        hourPickerIndex: next[3] || 0,
        minutePickerIndex: next[4] || 0,
        hourSwiperIndex: next[3] || 0,
        minuteSwiperIndex: next[4] || 0
      });
    },

    onFlatColumnChange(e) {
      const column = Number(e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.column);
      const current = Number(e.detail && e.detail.current);
      if (!Number.isInteger(column) || !Number.isInteger(current)) return;
      const next = (this.data.pickerValue || []).slice();
      if (Number(next[column]) === current) return;
      next[column] = current;

      const mode = this.data.mode;
      if (mode === "time") {
        const patch = { [`pickerValue[${column}]`]: current };
        if (column === 0) patch.hourPickerIndex = current;
        if (column === 1) patch.minutePickerIndex = current;
        this.setData(patch);
        return;
      }

      // 年/月改变时才需要重建日期列。拖动日、时、分只更新该列的索引，
      // 避免每经过一个刻度都序列化整月文案并重绘五列。
      if (column === 0 || column === 1) {
        const yearIndex = clamp(Number(next[0]) || 0, 0, this.data.years.length - 1);
        const monthIndex = clamp(Number(next[1]) || 0, 0, 11);
        const year = this.data.years[yearIndex];
        const month = this.data.months[monthIndex];
        const nextDays = range(1, daysInMonth(year, month));
        const dayIndex = clamp(Number(next[2]) || 0, 0, nextDays.length - 1);
        next[0] = yearIndex;
        next[1] = monthIndex;
        next[2] = dayIndex;
        this.setData({
          days: nextDays,
          dayLabels: buildDayLabels(year, month),
          pickerValue: next,
          daySwiperIndex: dayIndex
        });
        return;
      }

      const patch = { [`pickerValue[${column}]`]: current };
      if (column === this.data.hourColumnIndex) patch.hourPickerIndex = current;
      if (column === this.data.minuteColumnIndex) patch.minutePickerIndex = current;
      this.setData(patch);
    },

    onConfirm() {
      const mode = this.data.mode;
      const indexes = this.data.pickerValue || [];
      let dateValue = "";
      let timeValue = "";

      if (mode !== "time") {
        const year = this.data.years[indexes[0] || 0];
        const month = this.data.months[indexes[1] || 0];
        const day = this.data.days[indexes[2] || 0];
        dateValue = formatDate(year, month, day);
      }

      if (mode !== "date") {
        const offset = mode === "datetime" ? 3 : 0;
        const hour = this.data.hours[indexes[offset] || 0];
        const minute = this.data.minutes[indexes[offset + 1] || 0];
        timeValue = formatTime(hour, minute);
      }

      const value = mode === "date"
        ? dateValue
        : mode === "time"
          ? timeValue
          : `${dateValue} ${timeValue}`;
      this.triggerEvent("confirm", { mode, value, dateValue, timeValue });
    }
  }
});
