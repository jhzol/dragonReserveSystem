const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const pageDir = path.join(__dirname, "../pages/history");
const source = fs.readFileSync(path.join(pageDir, "history.js"), "utf8");

function loadRankingInternals(statsServiceOverrides = {}) {
  let pageConfig = null;
  const statsService = {
    getActivityRanking: async () => [],
    getPigeonRanking: async () => [],
    ...statsServiceOverrides
  };
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    Promise,
    getApp: () => ({ globalData: { userRole: "user" } }),
    Page: (config) => { pageConfig = config; },
    wx: {},
    require(request) {
      if (request === "../../services/stats") {
        return statsService;
      }
      if (request === "../../utils/tabBarSync") {
        return { patchTabBarIfNeeded() {} };
      }
      if (request === "../../utils/safeArea") {
        return { getBottomSafeAreaRpx: () => 0 };
      }
      throw new Error(`Unexpected require: ${request}`);
    }
  };
  vm.runInNewContext(
    `${source}\nmodule.exports.__rankingTest = { pigeonRisk, formatActivityRanking, formatPigeonRanking, ACTIVITY_RANKING_PAGE_SIZE };`,
    sandbox,
    { filename: "history.js" }
  );
  return { ...sandbox.module.exports.__rankingTest, pageConfig, statsService };
}

test("activity ranking keeps absolute ranks across segmented pages", () => {
  const { formatActivityRanking, ACTIVITY_RANKING_PAGE_SIZE } = loadRankingInternals();
  const page = formatActivityRanking([
    { user_id: 21, nickname: "第二十一名", checkin_count: 3, attendance_days: 2, heatmap: [] },
    { user_id: 22, nickname: "第二十二名", checkin_count: 2, attendance_days: 1, heatmap: [] }
  ], ACTIVITY_RANKING_PAGE_SIZE, 10);

  assert.equal(ACTIVITY_RANKING_PAGE_SIZE, 20);
  assert.deepEqual(page.map((item) => item.rank), [21, 22]);
  assert.deepEqual(page.map((item) => item.progressPercent), [30, 20]);
});


test("activity ranking loads later segments and appends every remaining member", async () => {
  let requestedOptions = null;
  const { pageConfig, formatActivityRanking } = loadRankingInternals({
    getActivityRanking: async (options) => {
      requestedOptions = options;
      return [{
        user_id: 21,
        nickname: "第二十一名",
        checkin_count: 3,
        attendance_days: 1,
        heatmap: []
      }];
    }
  });
  const initialPayload = Array.from({ length: 20 }, (_, index) => ({
    user_id: index + 1,
    nickname: `用户${index + 1}`,
    checkin_count: 10 - Math.floor(index / 3),
    attendance_days: 1,
    heatmap: []
  }));
  const initialRanking = formatActivityRanking(initialPayload);
  const context = {
    _rankingRequestSequence: 1,
    data: {
      activeTab: "activity",
      isLoading: false,
      isLoadingActivityMore: false,
      activityHasMore: true,
      activityRanking: initialRanking,
      activityLeader: initialRanking[0]
    },
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };

  await pageConfig.loadMoreActivityRanking.call(context);

  assert.equal(requestedOptions.offset, 20);
  assert.equal(requestedOptions.limit, 20);
  assert.equal(context.data.activityRanking.length, 21);
  assert.equal(context.data.activityRanking[20].rank, 21);
  assert.equal(context.data.activityRest.length, 17);
  assert.equal(context.data.activityHasMore, false);
  assert.equal(context.data.isLoadingActivityMore, false);
});

test("pigeon risk uses the confirmed 50% and 25% boundaries", () => {
  const { pigeonRisk } = loadRankingInternals();

  assert.deepEqual(
    { ...pigeonRisk(50) },
    { text: "高风险", description: "这个人报名了\n系统也不占人数" }
  );
  assert.equal(pigeonRisk(49.999).text, "中风险");
  assert.deepEqual(
    { ...pigeonRisk(25) },
    { text: "中风险", description: "答应得快\n消失得更快" }
  );
  assert.equal(pigeonRisk(24.999).text, "低风险");
  assert.deepEqual(
    { ...pigeonRisk(0) },
    { text: "低风险", description: "偶尔加班是一件\n可以理解的事情" }
  );
});

test("pigeon percentage stays inside the ring while its angle keeps source precision", () => {
  const { formatPigeonRanking } = loadRankingInternals();
  const [item] = formatPigeonRanking([{
    user_id: 1,
    nickname: "测试用户",
    signup_count: 3,
    pigeon_count: 1,
    pigeon_rate: 33.3
  }]);

  assert.equal(item.pigeonRateText, "33");
  assert.equal(item.ringDegrees, 120);
  assert.equal(item.riskText, "中风险");
  assert.equal(item.riskDescription, "答应得快\n消失得更快");
  assert.deepEqual(Array.from(item.riskDescriptionLines), ["答应得快", "消失得更快"]);
});

test("ranking page preserves champion jokes and follows the Pencil layout fixes", () => {
  const wxml = fs.readFileSync(path.join(pageDir, "history.wxml"), "utf8");
  const wxss = fs.readFileSync(path.join(pageDir, "history.wxss"), "utf8");

  assert.match(wxml, /dragon-watermark dragon-watermark--absolute ranking-watermark/);
  assert.match(wxml, /<text class="ranking-navbar-title">排行榜<\/text>/);
  assert.match(wxml, /冒昧问一句，你没有别的朋友吗？/);
  assert.match(wxml, /发了红包就不用出现在这里了/);
  assert.match(wxml, /wx:for="{{pigeonLeader\.riskDescriptionLines}}"[^>]*class="pigeon-description-line"/);
  assert.match(wxml, /class="heatmap-calendar"/);
  assert.match(wxml, /bindscrolltolower="loadMoreActivityRanking"/);
  assert.doesNotMatch(wxml, /ranking-switch-sticky/);
  assert.doesNotMatch(wxss, /position:\s*sticky/);
  assert.match(wxml, /class="ranking-scroll-body"/);
  assert.doesNotMatch(wxml, /class="ranking-scroll"[^>]*style=/);
  assert.match(wxss, /\.ranking-scroll\s*\{[^}]*top:\s*0;[^}]*bottom:\s*0;/s);
  assert.doesNotMatch(wxss, /\.ranking-navbar\s*\{[^}]*position:\s*fixed;/s);

  assert.match(wxml, /class="ranking-switch-slider \{\{activeTab === 'pigeon' \? 'is-pigeon' : ''\}\}"/);
  assert.match(wxss, /\.ranking-switch-slider\s*\{[^}]*width:\s*calc\(\(100% - 23\.07rpx\) \/ 2\);[^}]*transition:\s*transform 180ms cubic-bezier\(\.2,\.8,\.2,1\);/s);
  assert.match(wxss, /\.ranking-switch-slider\.is-pigeon\s*\{[^}]*transform:\s*translateX\(calc\(100% \+ 7\.69rpx\)\);/s);
  assert.match(wxss, /\.ranking-switch-item\s*\{[^}]*font-size:\s*26\.92rpx;[^}]*font-weight:\s*500;[^}]*transition:\s*color 160ms ease;/s);
  assert.match(wxss, /\.ranking-switch-item\.is-active\s*\{[^}]*font-weight:\s*600;/s);
  assert.doesNotMatch(wxss, /\.ranking-switch-item\.is-active\s*\{[^}]*background:/s);
  assert.match(wxss, /\.ranking-section-title\s*\{[^}]*height:\s*42\.31rpx;[^}]*font-size:\s*38\.46rpx;[^}]*font-weight:\s*700;[^}]*line-height:\s*42\.31rpx;/s);
  assert.match(wxss, /\.champion-card\s*\{[^}]*height:\s*430\.77rpx;[^}]*padding:\s*30\.77rpx;/s);
  assert.match(wxss, /\.heatmap-card\s*\{[^}]*height:\s*384\.62rpx;/s);
  assert.match(wxss, /\.heatmap-calendar\s*\{[^}]*gap:\s*7\.69rpx;/s);
  assert.match(wxss, /\.heatmap-body\s*\{[^}]*height:\s*192\.31rpx;/s);
  assert.match(wxss, /\.ranking-row:nth-child\(n \+ 4\) \.ranking-progress-fill\s*\{[^}]*background:\s*#ffe0b2;/s);
  assert.match(wxss, /\.champion-joke\s*\{[^}]*width:\s*398\.08rpx;[^}]*height:\s*32\.69rpx;/s);
  assert.match(wxss, /\.pigeon-ring\s*\{[^}]*box-shadow:\s*0 7\.69rpx 23\.08rpx rgba\(184,74,0,\.1\);/s);
  assert.match(wxss, /\.pigeon-description\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
  assert.doesNotMatch(wxss, /font-family\s*:/);
  assert.match(wxss, /\.pigeon-description-line\s*\{[^}]*display:\s*block;[^}]*height:\s*28\.85rpx;[^}]*line-height:\s*28\.85rpx;/s);
  assert.match(wxss, /\.ranking-navbar-row\s*\{[^}]*max-width:\s*480px;[^}]*margin:\s*0 auto;/s);
  assert.match(wxss, /\.ranking-content\s*\{[^}]*max-width:\s*480px;[^}]*margin:\s*0 auto;[^}]*padding:\s*15\.38rpx 38\.46rpx;/s);
  assert.match(wxss, /\.ranking-watermark\s*\{[^}]*left:\s*calc\(50% - 25rpx\);/s);
  assert.doesNotMatch(wxss, /@media\s*\(min-width:\s*414px\)/);
  assert.match(source, /activityRest:\s*activityRanking\.slice\(4\)/);
  assert.match(source, /getActivityRanking\(\{ offset, limit: ACTIVITY_RANKING_PAGE_SIZE \}\)/);
});
