const {
  SWIPE_OPEN_THRESHOLD_RATIO,
  clamp,
  getSwipeSettledState,
  getActionMetrics,
  formatCheckinParts,
  buildProgressView,
  getMaxHeightRpx
} = require("./logic");
function getRpxPerPx() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const width = Number(info && info.windowWidth);
    return width > 0 ? 750 / width : 750 / 390;
  } catch (error) {
    return 750 / 390;
  }
}

function getDrawerHeightRpx(rowCount, maxHeightRpx, safeBottomRpx) {
  const count = Math.max(0, Math.floor(Number(rowCount) || 0));
  const safeBottom = Math.max(0, Number(safeBottomRpx) || 0);
  const fixedChromeRpx = 130.77 + 15.38 + 153.85 + 15.38 + 61.54 + 30.77 + safeBottom;
  const bodyRpx = count > 0
    ? count * 123.08 + Math.max(0, count - 1) * 7.69
    : 576.92;
  return Math.min(Number(maxHeightRpx) || 1384.62, fixedChromeRpx + bodyRpx);
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    participants: { type: Array, value: [] },
    participantCount: { type: Number, value: 0 },
    checkinCount: { type: Number, value: 0 },
    maxParticipants: { type: Number, value: null },
    canManage: { type: Boolean, value: false },
    isAdmin: { type: Boolean, value: false },
    safeBottomRpx: { type: Number, value: 0 }
  },

  data: {
    containerRendered: false,
    containerVisible: false,
    drawerHeightRpx: 984.61,
    rows: [],
    memberListScrollEnabled: true,
    actionOffsetRpx: 0,
    actionAreaWidthRpx: 0,
    maxHeightRpx: 1384.62,
    bodyMaxHeightRpx: 1253.85,
    participantCountText: "0",
    participantLimitText: "",
    participantHasLimit: false,
    progressWidth: "0%",
    progressMessage: "暂无成员报名"
  },

  observers: {
    visible(visible) {
      if (visible) {
        this.prepareParticipantsContainer();
      } else {
        this._gesture = null;
        this.setData({ containerVisible: false, memberListScrollEnabled: true });
      }
    },
    participants(value) {
      this.setRows(value);
    },
    "canManage, isAdmin"() {
      this.setRows(this.properties.participants || []);
    },
    "participantCount, checkinCount, maxParticipants"() {
      this.setProgress();
    },
    safeBottomRpx() {
      this.updateHeightConstraints();
    }
  },

  lifetimes: {
    attached() {
      this.updateHeightConstraints();
      this.setRows(this.properties.participants || []);
      this.setProgress();
      if (this.properties.visible) this.prepareParticipantsContainer();
    }
  },

  methods: {
    prepareParticipantsContainer() {
      this.setRows(this.properties.participants || [], () => {
        this.setProgress(() => this.mountContainer());
      });
    },

    mountContainer() {
      this.setData({ containerRendered: true, containerVisible: false }, () => {
        wx.nextTick(() => {
          if (this.properties.visible) this.setData({ containerVisible: true });
        });
      });
    },

    onContainerAfterLeave() {
      if (!this.properties.visible) {
        this.setData({ containerRendered: false });
      }
    },

    updateHeightConstraints() {
      const maxHeightRpx = getMaxHeightRpx();
      const fixedChromeRpx = 130.77;
      const safeBottomRpx = Number(this.properties.safeBottomRpx) || 0;
      this.setData({
        maxHeightRpx,
        bodyMaxHeightRpx: Math.max(0, Math.round((maxHeightRpx - fixedChromeRpx - safeBottomRpx) * 100) / 100),
        drawerHeightRpx: getDrawerHeightRpx(this.data.rows.length, maxHeightRpx, safeBottomRpx)
      });
    },

    setProgress(callback) {
      const progress = buildProgressView(
        this.properties.participantCount,
        this.properties.checkinCount,
        this.properties.maxParticipants
      );
      this.setData(progress, callback);
    },

    setRows(participants, callback) {
      const actionMetrics = getActionMetrics(this.properties.canManage, this.properties.isAdmin);
      const rows = (Array.isArray(participants) ? participants : []).map((item, index) => {
        const row = item && typeof item === "object" ? item : { name: String(item || "未命名") };
        const checked = !!(row.checkedInAt || row.checkedInAtRaw);
        const parts = formatCheckinParts(row.checkedInAtRaw || row.checkedInAt);
        const checkinLocation = checked
          ? String(row.checkinLocationName || row.checkinAddress || "").trim()
          : "";
        return {
          ...row,
          rowKey: row.rowKey || (row.id != null && row.id !== "" ? `participant-${row.id}` : `participant-${index}`),
          name: row.name || "未命名",
          avatarUrl: row.avatarUrl || "/images/default-avatar.svg",
          hasCheckedIn: checked,
          hasCheckinLocation: Boolean(checkinLocation),
          checkinDateText: checked ? parts.date : "—",
          checkinTimeText: checked ? parts.time : "—",
          checkinLocationText: checkinLocation || "—",
          availableActions: this.properties.canManage
            ? (this.properties.isAdmin
              ? (checked ? ["cancelcheckin", "remove"] : ["retrocheckin", "remove"])
              : ["remove"])
            : [],
          offsetX: 0,
          actionOpen: false
        };
      });
      this.setData({
        rows,
        ...actionMetrics,
        drawerHeightRpx: getDrawerHeightRpx(
          rows.length,
          this.data.maxHeightRpx,
          this.properties.safeBottomRpx
        )
      }, callback);
    },

    onMaskTap() {
      this.triggerEvent("close");
    },

    onTouchStart(e) {
      const index = Number(e.currentTarget.dataset.index);
      const touch = e.touches && e.touches[0];
      if (!Number.isFinite(index) || !touch || !this.properties.canManage) return;
      const row = this.data.rows[index];
      if (!row) return;
      this.closeOpenRows(index);
      this._gesture = {
        index,
        startX: touch.clientX,
        startY: touch.clientY,
        startOffsetX: row.offsetX || 0,
        horizontal: null
      };
    },

    onTouchMove(e) {
      const gesture = this._gesture;
      const touch = e.touches && e.touches[0];
      if (!gesture || !touch || !this.properties.canManage) return;
      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      if (gesture.horizontal === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        gesture.horizontal = Math.abs(dx) > Math.abs(dy);
      }
      if (!gesture.horizontal) return;
      const dxRpx = dx * getRpxPerPx();
      const actionOffsetRpx = Number(this.data.actionOffsetRpx) || 0;
      const next = clamp(gesture.startOffsetX + dxRpx, -actionOffsetRpx, 0);
      // setData is asynchronous in the Mini Program runtime. Keep the latest
      // gesture offset locally so touchend never snaps from stale row data.
      gesture.currentOffsetX = next;
      const rows = this.data.rows.map((row, i) => i === gesture.index
        ? { ...row, offsetX: next, actionOpen: Math.abs(next) >= actionOffsetRpx * SWIPE_OPEN_THRESHOLD_RATIO }
        : row);
      this.setData({ rows, memberListScrollEnabled: false });
    },

    onTouchEnd() {
      const gesture = this._gesture;
      this._gesture = null;
      if (!gesture || gesture.horizontal !== true || !this.properties.canManage) {
        if (!this.data.memberListScrollEnabled) this.setData({ memberListScrollEnabled: true });
        return;
      }
      const row = this.data.rows[gesture.index];
      if (!row) {
        this.setData({ memberListScrollEnabled: true });
        return;
      }
      const endOffsetX = Number.isFinite(gesture.currentOffsetX)
        ? gesture.currentOffsetX
        : (row.offsetX || 0);
      const settledState = getSwipeSettledState(
        gesture.startOffsetX,
        endOffsetX,
        this.data.actionOffsetRpx
      );
      const rows = this.data.rows.map((item, index) => index === gesture.index
        ? { ...item, ...settledState }
        : item);
      this.setData({ rows, memberListScrollEnabled: true });
    },

    onTouchCancel() {
      this.onTouchEnd();
    },

    closeOpenRows(exceptIndex) {
      const rows = this.data.rows.map((row, index) => index === exceptIndex
        ? row
        : { ...row, offsetX: 0, actionOpen: false });
      this.setData({ rows });
    },

    onActionTap(e) {
      const index = Number(e.currentTarget.dataset.index);
      const action = String(e.currentTarget.dataset.action || "");
      const row = this.data.rows[index];
      if (!row || !action || !this.properties.canManage) return;
      if ((action === "retrocheckin" || action === "cancelcheckin") && !this.properties.isAdmin) return;
      this.closeOpenRows(index);
      this.triggerEvent(action, { id: row.id, name: row.name, row });
    },

    onCloseTap() {
      this.triggerEvent("close");
    },

    noop() {}
  }
});
