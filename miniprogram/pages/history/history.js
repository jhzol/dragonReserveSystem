const app = getApp();
const statsService = require("../../services/stats");
const { patchTabBarIfNeeded } = require("../../utils/tabBarSync");
const { getBottomSafeAreaRpx } = require("../../utils/safeArea");

const DEFAULT_AVATAR = "/images/default-avatar.svg";
const MONTH_NAMES = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const ACTIVITY_RANKING_PAGE_SIZE = 20;

function avatarOf(item) {
  return item.avatar_url || DEFAULT_AVATAR;
}

function chunkHeatmap(days) {
  const weeks = [];
  for (let index = 0; index < 12; index += 1) {
    const weekDays = (days || []).slice(index * 7, index * 7 + 7).map((day) => ({
      date: day.date,
      durationHours: Number(day.duration_hours || 0),
      level: Number(day.level || 0),
      title: `${day.date} · ${Number(day.duration_hours || 0)} 小时`
    }));
    const firstDate = weekDays[0] && weekDays[0].date;
    const monthIndex = firstDate ? Number(firstDate.slice(5, 7)) - 1 : -1;
    const previousFirstDate = index > 0 && days[(index - 1) * 7] && days[(index - 1) * 7].date;
    const previousMonthIndex = previousFirstDate ? Number(previousFirstDate.slice(5, 7)) - 1 : -1;
    weeks.push({
      key: `week-${index}`,
      days: weekDays,
      monthLabel: index === 0 || monthIndex !== previousMonthIndex ? MONTH_NAMES[monthIndex] || "" : ""
    });
  }
  return weeks;
}

function formatActivityRanking(list, rankOffset = 0, leaderCountOverride = 0) {
  const leaderCount = Number(leaderCountOverride || (list[0] && list[0].checkin_count) || 0);
  return (list || []).map((item, index) => ({
    userId: String(item.user_id),
    rank: rankOffset + index + 1,
    name: item.nickname || "未命名",
    avatarUrl: avatarOf(item),
    checkinCount: Number(item.checkin_count || 0),
    attendanceDays: Number(item.attendance_days || 0),
    progressPercent: leaderCount ? Math.max(8, Math.round((Number(item.checkin_count || 0) / leaderCount) * 100)) : 0,
    heatmapWeeks: chunkHeatmap(item.heatmap || [])
  }));
}

function pigeonRisk(rate) {
  if (rate >= 50) {
    return { text: "高风险", description: "这个人报名了\n系统也不占人数" };
  }
  if (rate >= 25) {
    return { text: "中风险", description: "答应得快\n消失得更快" };
  }
  return { text: "低风险", description: "偶尔加班是一件\n可以理解的事情" };
}

function formatPigeonRanking(list) {
  const leaderCount = Number((list[0] && list[0].pigeon_count) || 0);
  return (list || []).map((item, index) => {
    const pigeonRate = Number(item.pigeon_rate || 0);
    const risk = pigeonRisk(pigeonRate);
    return {
      userId: String(item.user_id),
      rank: index + 1,
      name: item.nickname || "未命名",
      avatarUrl: avatarOf(item),
      signupCount: Number(item.signup_count || 0),
      pigeonCount: Number(item.pigeon_count || 0),
      pigeonRate,
      pigeonRateText: String(Math.round(pigeonRate)),
      riskText: risk.text,
      riskDescription: risk.description,
      riskDescriptionLines: risk.description.split("\n"),
      ringDegrees: Math.max(0, Math.min(360, Math.round(pigeonRate * 3.6))),
      progressPercent: leaderCount ? Math.max(8, Math.round((Number(item.pigeon_count || 0) / leaderCount) * 100)) : 0
    };
  });
}

function podiumOrder(list) {
  return [list[2], list[1], list[3]].filter(Boolean);
}

Page({
  data: {
    statusBarHeight: 20,
    activeTab: "activity",
    activityRanking: [],
    pigeonRanking: [],
    activityLeader: null,
    pigeonLeader: null,
    activityPodium: [],
    pigeonPodium: [],
    activityRest: [],
    pigeonRest: [],
    activityHasMore: false,
    isLoadingActivityMore: false,
    isLoading: true,
    bottomSafeAreaRpx: 0
  },

  onLoad() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({
        statusBarHeight: info.statusBarHeight || 20,
        bottomSafeAreaRpx: getBottomSafeAreaRpx()
      });
    } catch (error) {
      console.warn("Failed to read status bar height", error);
    }
  },

  onShow() {
    patchTabBarIfNeeded(this, {
      selected: 2,
      isAdmin: app.globalData.userRole === "admin"
    });
    this.loadRankings();
  },

  switchRankingTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab && tab !== this.data.activeTab) this.setData({ activeTab: tab });
  },

  loadRankings() {
    const sequence = (this._rankingRequestSequence || 0) + 1;
    this._rankingRequestSequence = sequence;
    this.setData({ isLoading: true, isLoadingActivityMore: false });
    return Promise.all([
      statsService.getActivityRanking({ offset: 0, limit: ACTIVITY_RANKING_PAGE_SIZE }),
      statsService.getPigeonRanking()
    ]).then(([activityPayload, pigeonPayload]) => {
        if (this._rankingRequestSequence !== sequence) return;
        const activityRanking = formatActivityRanking(activityPayload || []);
        const pigeonRanking = formatPigeonRanking(pigeonPayload || []);
        this.setData({
          activityRanking,
          pigeonRanking,
          activityLeader: activityRanking[0] || null,
          pigeonLeader: pigeonRanking[0] || null,
          activityPodium: podiumOrder(activityRanking),
          pigeonPodium: podiumOrder(pigeonRanking),
          activityRest: activityRanking.slice(4),
          pigeonRest: pigeonRanking.slice(4, 8),
          activityHasMore: (activityPayload || []).length === ACTIVITY_RANKING_PAGE_SIZE,
          isLoadingActivityMore: false,
          isLoading: false
        });
      })
      .catch((error) => {
        if (this._rankingRequestSequence !== sequence) return;
        this.setData({ isLoading: false, isLoadingActivityMore: false });
        wx.showToast({ title: (error && error.message) || "加载排行榜失败", icon: "none" });
      });
  },

  loadMoreActivityRanking() {
    if (
      this.data.activeTab !== "activity" ||
      this.data.isLoading ||
      this.data.isLoadingActivityMore ||
      !this.data.activityHasMore
    ) {
      return Promise.resolve();
    }

    const sequence = this._rankingRequestSequence;
    const offset = this.data.activityRanking.length;
    const leaderCount = Number((this.data.activityLeader && this.data.activityLeader.checkinCount) || 0);
    this.setData({ isLoadingActivityMore: true });

    return statsService.getActivityRanking({ offset, limit: ACTIVITY_RANKING_PAGE_SIZE })
      .then((payload) => {
        if (this._rankingRequestSequence !== sequence) return;
        const page = formatActivityRanking(payload || [], offset, leaderCount);
        const knownUserIds = new Set(this.data.activityRanking.map((item) => item.userId));
        const nextRanking = this.data.activityRanking.concat(
          page.filter((item) => !knownUserIds.has(item.userId))
        );
        this.setData({
          activityRanking: nextRanking,
          activityRest: nextRanking.slice(4),
          activityHasMore: (payload || []).length === ACTIVITY_RANKING_PAGE_SIZE,
          isLoadingActivityMore: false
        });
      })
      .catch((error) => {
        if (this._rankingRequestSequence !== sequence) return;
        this.setData({ isLoadingActivityMore: false });
        wx.showToast({ title: (error && error.message) || "加载更多失败", icon: "none" });
      });
  },

  onAvatarError(event) {
    const list = event.currentTarget.dataset.list;
    const index = Number(event.currentTarget.dataset.index);
    if (!list || Number.isNaN(index)) return;
    this.setData({ [`${list}[${index}].avatarUrl`]: DEFAULT_AVATAR });
  }
});
