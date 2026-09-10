const userService = require("./services/user");
const authService = require("./services/auth");
const { logPageError, resumeDiagnosticUploads } = require("./services/logger");



// Session validation remains immediate; unchanged primitive profile values need no write.
function storeIfChanged(key, value) {
  if (wx.getStorageSync(key) !== value) wx.setStorageSync(key, value);
}

App({

  globalData: {

    /** 自定义 TabBar 重挂载时 data.selected 会重置，用此值在 attached 中立即恢复，避免 0→正确值 二次 transition */
    tabBarSelected: 0,

    /** 首页全屏抽屉存续期间跨原生页面生命周期保留隐藏态，避免 Tab 重挂载后覆盖抽屉。 */
    tabBarHidden: false,

    /** 冷启动首页卡片入场前，Tab 与卡片共用同一个延迟触发点。 */
    homeTabEntrancePending: true,

    /** 从其他 Tab 点击中央新建入口后，由首页 onShow 消费并打开一级抽屉。 */
    pendingOpenCreateActivity: false,

    /** 中央新建入口被权限拦截后，由“我的”页消费登录或获取权限引导。 */
    pendingCreateAccessAction: "",

    userRole: null,

    isAuthenticated: false,

    userInfo: null,

    accessToken: "",

    userId: "",

    userDocId: "",

    userProfile: null,

    sessionValidated: false,

    _sessionValidationPromise: null,

    _sessionExpiredPromptShown: false

  },



  onLaunch() {

    this.installGlobalErrorLogging();

    this.restoreSessionFromStorage();

    this.restoreAuthState();

    this.validateStoredSession({ promptOnExpired: true });

  },



  onShow() {
    resumeDiagnosticUploads();
  },

  restoreSessionFromStorage() {

    try {

      const accessToken = wx.getStorageSync("accessToken");

      const userId = wx.getStorageSync("userId");

      const nickname = wx.getStorageSync("userNickname") || "";

      const avatarUrl = wx.getStorageSync("userAvatarUrl") || "";



      if (!accessToken || !userId) return;



      this.globalData.accessToken = accessToken;

      this.globalData.userId = userId;

      this.globalData.userProfile = { nickname, avatarUrl };

    } catch (e) {

      console.error("恢复用户缓存失败", e);

    }

  },



  restoreAuthState() {

    try {

      const userRole = wx.getStorageSync("userRole");

      const isAuthenticated = wx.getStorageSync("isAuthenticated");



      if (userRole) {

        this.globalData.userRole = userRole;

        this.globalData.isAuthenticated = !!isAuthenticated;

        this.globalData.userInfo = {

          role: userRole

        };

      }

    } catch (e) {

      console.error("恢复登录状态失败", e);

    }

  },



  applyCurrentUser(user, accessToken) {

    const role = user.role || "guest";

    const isAuthenticated = role === "user" || role === "admin";



    if (accessToken) {

      this.globalData.accessToken = accessToken;

      storeIfChanged("accessToken", accessToken);

    }



    this.globalData.userId = String(user.id || "");

    this.globalData.userDocId = "";

    this.globalData.userRole = role;

    this.globalData.isAuthenticated = isAuthenticated;

    this.globalData.userInfo = { role };

    this.globalData.userProfile = {

      nickname: user.nickname || "",

      avatarUrl: user.avatar_url || ""

    };

    this.globalData.sessionValidated = true;

    this.globalData._sessionExpiredPromptShown = false;



    storeIfChanged("hasWeChatAuth", true);

    storeIfChanged("userId", String(user.id || ""));

    storeIfChanged("userNickname", user.nickname || "");

    storeIfChanged("userAvatarUrl", user.avatar_url || "");

    storeIfChanged("userRole", role);

    resumeDiagnosticUploads();

    storeIfChanged("isAuthenticated", isAuthenticated);

  },



  setAuthState(role, isAuthenticated) {

    this.globalData.userRole = role;

    this.globalData.isAuthenticated = isAuthenticated;

    this.globalData.userInfo = { role };



    try {

      storeIfChanged("userRole", role);

      storeIfChanged("isAuthenticated", isAuthenticated);

    } catch (e) {

      console.error("保存登录状态失败", e);

    }

  },



  clearAuthState() {

    this.setAuthState("guest", false);

  },



  logout() {

    try {
      const uid =
        String((this.globalData && this.globalData.userId) || "").trim() ||
        String(wx.getStorageSync("userId") || "").trim();
      if (uid) {
        const myActivitiesCache = require("./utils/myActivitiesCache");
        myActivitiesCache.removeForUser(uid);
      }
    } catch (e) {
      console.error("clear signed-up cache failed", e);
    }

    this.globalData.userRole = null;

    this.globalData.isAuthenticated = false;

    this.globalData.userInfo = null;

    this.globalData.accessToken = "";

    this.globalData.userId = "";

    this.globalData.userDocId = "";

    this.globalData.userProfile = null;

    this.globalData.sessionValidated = false;



    [

      "hasWeChatAuth",

      "accessToken",

      "userId",

      "userNickname",

      "userAvatarUrl",

      "userRole",

      "isAuthenticated"

    ].forEach((key) => wx.removeStorageSync(key));

  },

  installGlobalErrorLogging() {
    try {
      if (typeof wx.onError === "function") {
        wx.onError((error) => {
          logPageError("uncaught_error", { message: error });
        });
      }
      if (typeof wx.onUnhandledRejection === "function") {
        wx.onUnhandledRejection((event) => {
          logPageError("unhandled_rejection", event && event.reason);
        });
      }
    } catch (error) {
      console.error("安装全局错误日志失败", error);
    }
  },



  isExpiredSessionError(err) {

    const statusCode = Number(err && err.statusCode);

    return statusCode === 401 || statusCode === 403;

  },



  showSessionExpiredPrompt() {

    if (this.globalData._sessionExpiredPromptShown) return;

    this.globalData._sessionExpiredPromptShown = true;

    setTimeout(() => {

      wx.showModal({

        title: "登录状态已过期",

        content: "请重新登录后继续使用功能",

        confirmText: "立即登录",

        cancelText: "稍后",

        success: (res) => {

          if (!res.confirm) return;

          this.reauthenticateAfterExpiry();

        }

      });

    }, 300);

  },



  reauthenticateAfterExpiry() {

    wx.showLoading({ title: "登录中...", mask: true });

    authService.loginWithWechat(this)

      .then(() => {

        wx.hideLoading();

        const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
        const currentPage = pages.length ? pages[pages.length - 1] : null;
        if (currentPage && typeof currentPage.onShow === "function") currentPage.onShow();

        wx.showToast({ title: "登录成功", icon: "success" });

      })

      .catch((err) => {

        wx.hideLoading();
        wx.showToast({ title: (err && err.message) || "登录失败", icon: "none" });

      });

  },



  validateStoredSession({ promptOnExpired = false } = {}) {

    const token = this.globalData.accessToken || wx.getStorageSync("accessToken");

    if (!token) return Promise.resolve(false);

    if (this.globalData._sessionValidationPromise) {

      return this.globalData._sessionValidationPromise;

    }

    const validation = userService.getMe()

      .then((user) => {

        this.applyCurrentUser(user);

        return true;

      })

      .catch((err) => {

        if (this.isExpiredSessionError(err)) {

          this.logout();

          if (promptOnExpired) this.showSessionExpiredPrompt();

        }

        return false;

      })

      .finally(() => {

        this.globalData._sessionValidationPromise = null;

      });

    this.globalData._sessionValidationPromise = validation;

    return validation;

  },



  ensureUserReady(callback) {

    if (

      this.globalData.sessionValidated &&

      this.globalData.accessToken &&

      this.globalData.userId &&

      this.globalData.userProfile

    ) {

      callback && callback();

      return;

    }



    this.validateStoredSession({ promptOnExpired: true })

      .then((isValid) => {

        if (isValid) callback && callback();

      });

  }

});

