const GROUPS = [
  {
    key: "indoor",
    title: "室内活动",
    values: ["boardgame", "movie", "eating"]
  },
  {
    key: "outdoor",
    title: "外出活动",
    values: ["outing", "badminton", "other"]
  }
];

const FALLBACK_LABELS = {
  boardgame: "桌游",
  movie: "电影",
  eating: "吃饭",
  outing: "外出",
  badminton: "羽毛球",
  other: "其他"
};
function normalizeLabel(value, label) {
  if (value === "other") return "其他";
  return String(label || FALLBACK_LABELS[value] || value);
}

function buildGroupedOptions(optionValues, optionLabels) {
  const values = Array.isArray(optionValues) ? optionValues : [];
  const labels = Array.isArray(optionLabels) ? optionLabels : [];
  const optionMap = {};

  values.forEach((rawValue, index) => {
    const value = String(rawValue || "");
    if (!value) return;
    optionMap[value] = {
      value,
      label: normalizeLabel(value, labels[index]),
      index
    };
  });

  return GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    options: group.values.map((value) => optionMap[value]).filter(Boolean)
  })).filter((group) => group.options.length > 0);
}

Component({
  options: {
    styleIsolation: "isolated"
  },

  properties: {
    visible: { type: Boolean, value: false },
    value: { type: String, value: "" },
    embedded: { type: Boolean, value: false },
    optionValues: { type: Array, value: [] },
    optionLabels: { type: Array, value: [] }
  },

  data: {
    containerRendered: false,
    containerVisible: false,
    groups: [],
    selectedValue: ""
  },

  observers: {
    "visible, value, optionValues, optionLabels, embedded": function (visible) {
      if (visible) {
        this.initializeOptions(() => this.mountContainer());
      } else {
        this.unmountContainer();
      }
    }
  },

  lifetimes: {
    attached() {
      if (this.properties.visible) {
        this.initializeOptions(() => this.mountContainer());
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

    initializeOptions(callback) {
      const groups = buildGroupedOptions(this.properties.optionValues, this.properties.optionLabels);
      const availableValues = groups.reduce((result, group) => (
        result.concat(group.options.map((option) => option.value))
      ), []);
      const selectedValue = availableValues.includes(this.properties.value)
        ? this.properties.value
        : (availableValues[0] || "");
      this.setData({ groups, selectedValue }, callback);
    },

    stopPropagation() {},

    onClose() {
      this.triggerEvent("close");
    },

    onSelect(e) {
      const value = String(e.currentTarget.dataset.value || "");
      if (!value) return;
      this.setData({ selectedValue: value });
    },

    onConfirm() {
      const selectedValue = this.data.selectedValue;
      for (const group of this.data.groups) {
        const option = group.options.find((item) => item.value === selectedValue);
        if (option) {
          this.triggerEvent("confirm", option);
          return;
        }
      }
    }
  }
});

module.exports = {
  GROUPS,
  FALLBACK_LABELS,
  normalizeLabel,
  buildGroupedOptions
};
