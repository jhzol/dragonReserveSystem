const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readActivityFormWxml() {
  const root = path.join(__dirname, "../components/activity-form-sheet");
  return ["index.wxml", "surface.wxml"]
    .map((name) => fs.readFileSync(path.join(root, name), "utf8"))
    .join("\n");
}

function loadComponentDefinition() {
  const componentPath = require.resolve("../components/activity-form-sheet/index.js");
  const previousComponent = global.Component;
  let definition;
  global.Component = (value) => { definition = value; };
  delete require.cache[componentPath];
  require(componentPath);
  global.Component = previousComponent;
  return definition;
}

function setByPath(target, pathValue, value) {
  const parts = pathValue.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    cursor[part] = cursor[part] || {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function createContext(definition, overrides = {}) {
  const data = {
    ...definition.data,
    form: {
      startDate: "2026-08-17",
      startTime: "19:30",
      endDate: "2026-08-17",
      endTime: "22:00",
      signupDeadlineDate: "2026-08-17",
      signupDeadlineTime: "18:30"
    },
    ...overrides
  };
  return {
    ...definition.methods,
    data,
    setData(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        if (key.includes(".")) setByPath(this.data, key, value);
        else this.data[key] = value;
      }
      if (typeof callback === "function") callback();
    }
  };
}

const definition = loadComponentDefinition();

test("create remark height and counter stay synchronized while typing, deleting and reopening", () => {
  const context = createContext(definition, {
    isEdit: false,
    form: { remark: "" },
    remarkCount: 0,
    remarkLineCount: 1,
    remarkTextareaHeight: 48
  });

  definition.methods.onRemarkLineChange.call(context, { detail: { lineCount: 5 } });
  assert.equal(context.data.remarkTextareaHeight, 48);
  definition.methods.onRemarkLineChange.call(context, { detail: { lineCount: 3 } });
  definition.methods.onRemarkInput.call(context, { detail: { value: "第一行\n第二行\n第三行" } });
  assert.equal(context.data.remarkTextareaHeight, 120);

  definition.methods.onRemarkInput.call(context, { detail: { value: "第一行\n第二行\n第三行" } });
  definition.methods.onRemarkLineChange.call(context, { detail: { lineCount: 3 } });
  assert.equal(context.data.form.remark, "第一行\n第二行\n第三行");
  assert.equal(context.data.remarkCount, 11);
  assert.equal(context.data.remarkLineCount, 3);
  assert.equal(context.data.remarkTextareaHeight, 120);

  definition.methods.onRemarkInput.call(context, { detail: { value: "第一行" } });
  definition.methods.onRemarkLineChange.call(context, { detail: { lineCount: 1 } });
  assert.equal(context.data.remarkCount, 3);
  assert.equal(context.data.remarkTextareaHeight, 48);

  definition.methods.onRemarkInput.call(context, { detail: { value: "" } });
  assert.equal(context.data.form.remark, "");
  assert.equal(context.data.remarkCount, 0);
  assert.equal(context.data.remarkLineCount, 1);
  assert.equal(context.data.remarkTextareaHeight, 48);

  context.data.form.remark = "旧内容";
  context.data.remarkCount = 3;
  context.data.remarkLineCount = 8;
  context.data.remarkTextareaHeight = 200;
  context.properties = {
    mode: "create",
    defaultActivityType: "badminton",
    activityTypeOptionValues: ["badminton"],
    participantCount: 0
  };
  definition.methods.initializeForm.call(context);
  assert.equal(context.data.form.remark, "");
  assert.equal(context.data.remarkCount, 0);
  assert.equal(context.data.remarkLineCount, 1);
  assert.equal(context.data.remarkTextareaHeight, 48);
});

test("edit remark initializes to its content height and shrinks after deletion", () => {
  const context = createContext(definition);
  context.properties = {
    mode: "edit",
    activity: {
      remark: "无酒精，现场会讲解规则，新手也可以轻松参加。",
      maxParticipants: 12,
      signupEnabled: true
    },
    activityTypeOptionValues: [],
    participantCount: 0
  };

  definition.methods.initializeForm.call(context);
  assert.equal(context.data.isEdit, true);
  assert.equal(context.data.remarkCount, 22);
  assert.equal(context.data.remarkLineCount, 1);
  assert.equal(context.data.remarkTextareaHeight, 48);

  definition.methods.onRemarkLineChange.call(context, {
    detail: { lineCount: 3 }
  });
  assert.equal(context.data.remarkTextareaHeight, 126);

  definition.methods.onRemarkInput.call(context, {
    detail: { value: "" }
  });
  assert.equal(context.data.remarkCount, 0);
  assert.equal(context.data.remarkLineCount, 1);
  assert.equal(context.data.remarkTextareaHeight, 48);
});

test("remark blur provides a final native-value synchronization fallback", () => {
  const context = createContext(definition, {
    form: { remark: "残留内容" },
    remarkCount: 4,
    remarkTextareaHeight: 200
  });
  definition.methods.onRemarkBlur.call(context, { detail: { value: "" } });
  assert.equal(context.data.form.remark, "");
  assert.equal(context.data.remarkCount, 0);
  assert.equal(context.data.remarkTextareaHeight, 48);
});

test("all four visible time rows open the expected picker", () => {
  const cases = [
    ["startDateTime", "datetime", "选择开始时间", "2026-08-17 19:30"],
    ["endDateTime", "datetime", "选择结束时间", "2026-08-17 22:00"],
    ["signupDeadlineDate", "date", "选择报名截止日期", "2026-08-17"],
    ["signupDeadlineTime", "time", "选择报名截止时间", "18:30"]
  ];

  for (const [target, mode, title, value] of cases) {
    const context = createContext(definition);
    definition.methods.openDateTimePicker.call(context, {
      currentTarget: { dataset: { target } }
    });
    assert.equal(context.data.pickerVisible, true);
    assert.equal(context.data.pickerTarget, target);
    assert.equal(context.data.pickerMode, mode);
    assert.equal(context.data.pickerTitle, title);
    assert.equal(context.data.pickerValue, value);
  }
});

test("edit form can delegate all time pickers to a page-root host", () => {
  const opened = [];
  const context = createContext(definition);
  context.properties = { externalDateTimePicker: true };
  context.triggerEvent = (name, detail) => opened.push({ name, detail });

  definition.methods.openDateTimePicker.call(context, {
    currentTarget: { dataset: { target: "endDateTime" } }
  });

  assert.equal(context.data.pickerVisible, true);
  assert.deepEqual(opened, [{
    name: "opendatetimepicker",
    detail: {
      target: "endDateTime",
      mode: "datetime",
      title: "选择结束时间",
      value: "2026-08-17 22:00"
    }
  }]);
});

test("datetime confirmation updates both date and time and closes picker", () => {
  const startContext = createContext(definition, { pickerTarget: "startDateTime", pickerVisible: true });
  definition.methods.confirmDateTimePicker.call(startContext, {
    detail: { dateValue: "2026-08-18", timeValue: "20:05" }
  });
  assert.equal(startContext.data.form.startDate, "2026-08-18");
  assert.equal(startContext.data.form.startTime, "20:05");
  assert.equal(startContext.data.startDateTimeLabel, "08/18 20:05");
  assert.equal(startContext.data.pickerVisible, false);

  const endContext = createContext(definition, { pickerTarget: "endDateTime", pickerVisible: true });
  definition.methods.confirmDateTimePicker.call(endContext, {
    detail: { dateValue: "2026-08-18", timeValue: "23:10" }
  });
  assert.equal(endContext.data.form.endDate, "2026-08-18");
  assert.equal(endContext.data.form.endTime, "23:10");
  assert.equal(endContext.data.endDateTimeLabel, "08/18 23:10");
  assert.equal(endContext.data.pickerVisible, false);
});

test("form markup keeps prototype labels, placeholders and full-row tap targets", () => {
  const wxml = readActivityFormWxml();
  const hostWxml = fs.readFileSync(path.join(__dirname, "../components/activity-form-sheet/index.wxml"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "../components/activity-form-sheet/index.js"), "utf8");
  const pageWxml = fs.readFileSync(path.join(__dirname, "../pages/activity_list/activity_list.wxml"), "utf8");
  assert.match(js, /submitText:\s*"发布活动"/);
  assert.match(js, /submitText:\s*isEdit \? "保存修改" : "发布活动"/);
  assert.match(wxml, />活动封面<\/text>/);
  assert.match(wxml, /data-target="startDateTime"/);
  assert.match(wxml, /data-target="endDateTime"/);
  assert.match(wxml, /data-target="signupDeadlineDate"/);
  assert.match(wxml, /data-target="signupDeadlineTime"/);
  assert.match(wxml, />日期<\/text>/);
  assert.match(wxml, />时间<\/text>/);
  assert.match(wxml, />活动备注<\/text>/);
  assert.doesNotMatch(wxml, /活动备注（选填）/);
  assert.match(wxml, /placeholder="请输入活动名称"/);
  assert.match(wxml, /请选择活动地点/);
  assert.match(wxml, /<text wx:if="{{!form\.remark}}" class="bento-placeholder-text bento-textarea-placeholder">请输入活动备注<\/text>/);
  assert.match(wxml, /placeholder="请输入活动名称"[^>]*placeholder-style="color: #9ca3af; font-weight: 400;"/);
  assert.match(wxml, /<textarea[^>]*maxlength="{{maxRemarkLength}}"[^>]*>/);
  assert.match(js, /maxRemarkLength:\s*MAX_REMARK_LENGTH/);
  assert.match(wxml, /class="textarea-input-wrap" style="height: {{remarkTextareaHeight}}rpx;"/);
  assert.match(wxml, /<textarea[^>]*aria-label="请输入活动备注"[^>]*bindinput="onRemarkInput"[^>]*bindblur="onRemarkBlur"[^>]*bindlinechange="onRemarkLineChange"[^>]*auto-height="{{false}}"[^>]*disable-default-padding="{{true}}"[^>]*\/>/);
  assert.doesNotMatch(wxml, /<textarea[^>]*placeholder=/);
  assert.match(wxml, /<textarea[^>]*disable-default-padding="{{true}}"[^>]*\/>/);
  assert.match(wxml, /<textarea[^>]*show-confirm-bar="{{false}}"[^>]*\/>/);
  assert.doesNotMatch(wxml, /可设置 1–999 人/);
  assert.doesNotMatch(wxml, /补充活动说明（选填）/);
  assert.match(hostWxml, /<view class="activity-form-sheet-root [^"]*activity-form-sheet-root--route-embedded[^"]*">[\s\S]*?<block wx:if="{{routeEmbedded && visible}}">[\s\S]*?<include src="\.\/surface\.wxml" \/>/);
  assert.match(wxml, /id="qaActivityFormContainer"[\s\S]*show="{{containerVisible}}"[\s\S]*position="bottom"/);
  assert.match(wxml, /overlay="{{true}}"[\s\S]*close-on-slide-down="{{false}}"[\s\S]*bind:clickoverlay="onClose"/);
  assert.match(wxml, /<scroll-view[^>]*type="list"[^>]*scroll-y="{{true}}"[^>]*class="activity-sheet-body"/);
  assert.match(wxml, /id="qaActivityFormSurface"[^>]*class="activity-sheet-panel [^"]*activity-sheet-panel--create/);
  assert.doesNotMatch(wxml, /draggable-sheet|root-portal|worklet:onsizeupdate|associative-container/);
  assert.doesNotMatch(wxml, /@keyframes|activity-sheet-panel-enter/);
  assert.match(wxml, /class="bento-grid [^"]*bento-grid--create/);
  assert.match(wxml, /create-completed-text/);
  assert.match(wxml, /create-completed-field/);
  assert.match(wxml, /activity-sheet-footer--create/);
  assert.match(wxml, /activity-sheet-footer-actions--create/);
  assert.match(wxml, /sheet-button--primary-create/);
  assert.match(wxml, /activity-sheet-panel[^>]*pickerVisible \|\| coverPickerVisible[^>]*activity-sheet-panel--covered/);
  const coverIndex = wxml.indexOf(">活动封面</text>");
  const limitIndex = wxml.indexOf(">限制报名人数</text>", coverIndex);
  assert.ok(coverIndex >= 0 && limitIndex > coverIndex);
  assert.doesNotMatch(wxml, />允许报名<\/text>|>活动类型<\/text>/);
  assert.match(wxml, /participant-limit-card--edit/);
  assert.match(wxml, /activity-sheet-footer-actions--edit/);
  assert.match(wxml, /sheet-button--secondary-edit/);
  assert.match(wxml, /sheet-button--primary-edit/);
  assert.match(wxml, /wx:if="{{isEdit && activity\.status !== '已取消'}}"[\s\S]*bindtap="onCancelActivity">取消活动<\/button>/);
  assert.doesNotMatch(wxml, /删除活动|onDeleteActivity/);
  assert.doesNotMatch(js, /onDeleteActivity|deleteactivity/);
  assert.doesNotMatch(wxml, /activity-sheet-panel" catchtap=/);
  assert.match(wxml, /bindtap="decrementParticipants"/);
  assert.match(wxml, /bindtap="incrementParticipants"/);
  assert.doesNotMatch(wxml, /<button class="stepper-button"/);
  assert.match(wxml, /class="activity-sheet-close-icon"[^>]*src="\/images\/icon-close\.svg"/);
  assert.match(wxml, /class="location-chevron"[^>]*icon-chevron-right-600\.svg/);
  assert.match(wxml, /class="activity-type-chevron"[^>]*src="\/images\/icon-chevron-down\.svg"/);
  assert.match(wxml, /class="stepper-icon"[^>]*src="\/images\/icon-minus\.svg"/);
  assert.match(wxml, /class="stepper-icon"[^>]*src="\/images\/icon-plus\.svg"/);
  assert.match(wxml, /class="stepper-value">{{form\.maxParticipants}}<\/text>/);
  assert.match(wxml, /class="bento-card bento-card--full stepper-card participant-limit-card--create/);
  assert.match(wxml, /form\.limitEnabled \? 'participant-limit-card--visible' : ''/);
  assert.match(wxml, /class="stepper-value-input [^\"]*"[\s\S]*?type="number"[\s\S]*?focus="{{participantInputFocused}}"/);
  assert.match(wxml, /bindtap="focusParticipantInput"/);
  assert.match(wxml, /bindinput="onParticipantInput"/);
  assert.match(wxml, /bindblur="onParticipantBlur"/);
  assert.match(wxml, /bindconfirm="onParticipantConfirm"/);
  assert.match(wxml, /class="prototype-switch[^>]*bindtap="onSwitchTap"[^>]*data-field="limitEnabled"/);
  assert.doesNotMatch(wxml, />×<\/view>/);
  assert.doesNotMatch(wxml, /class="stepper-input"/);
  assert.doesNotMatch(wxml, /<switch\s/);
  assert.doesNotMatch(wxml, /activity-sheet-body-spacer/);
});

test("activity form sheet geometry follows the prototype measurements and gives Skyline scroll-view a real flex height", () => {
  const css = fs.readFileSync(path.join(__dirname, "../components/activity-form-sheet/index.wxss"), "utf8");
  const wxml = readActivityFormWxml();
  assert.doesNotMatch(wxml, /activity-sheet-drag(?:-area)?/);
  assert.doesNotMatch(css, /\.activity-sheet-drag(?:-area)?\s*{/);
  assert.match(css, /\.activity-sheet-panel\s*{[^}]*padding-top:\s*30\.77rpx;[^}]*padding-bottom:\s*153\.85rpx;/s);
  assert.match(css, /\.activity-sheet-header\s*{[^}]*height:\s*76\.92rpx;[^}]*padding:\s*0 30\.77rpx;/s);
  assert.doesNotMatch(css, /\.activity-sheet-root\s*\{/);
  assert.match(wxml, /custom-style="height: \{\{panelHeightRpx\}\}rpx;[^\"]*border-radius: 46\.15rpx 46\.15rpx 0 0;[^\"]*overflow: hidden;"/);
  assert.match(css, /\.activity-sheet-panel\s*{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*padding-bottom:\s*153\.85rpx;[^}]*box-sizing:\s*border-box;/s);
  assert.match(css, /\.activity-sheet-body\s*{[^}]*width:\s*100%;[^}]*flex:\s*1 1 0;[^}]*height:\s*0;[^}]*min-height:\s*0;/s);
  assert.match(css, /\.activity-sheet-footer\s*{[^}]*position:\s*absolute;[^}]*bottom:\s*0;[^}]*height:\s*153.85rpx;[^}]*padding-bottom:\s*46.15rpx;/s);
  assert.match(css, /\.bento-grid\s*{[^}]*padding:\s*15.38rpx 30.77rpx;/s);
  assert.match(css, /\.activity-sheet-close-icon\s*{[^}]*width:\s*38.46rpx;[^}]*height:\s*38.46rpx;/s);
  assert.match(css, /\.compact-card\s*{[^}]*height:\s*100rpx;[^}]*padding:\s*15.38rpx 23.08rpx;/s);
  assert.match(css, /\.compact-switch-card\s*{[^}]*height:\s*100rpx;/s);
  assert.match(css, /\.prototype-switch\s*{[^}]*width:\s*88.46rpx;[^}]*height:\s*53.85rpx;[^}]*padding:\s*5.77rpx;/s);
  assert.match(css, /\.prototype-switch-thumb\s*{[^}]*width:\s*42.31rpx;[^}]*height:\s*42.31rpx;/s);
  assert.match(css, /\.stepper\s*{[^}]*width:\s*211.54rpx;[^}]*height:\s*73.08rpx;[^}]*justify-content:\s*space-between;[^}]*padding:\s*0 19.23rpx;/s);
  assert.match(css, /\.stepper-icon\s*{[^}]*width:\s*38.46rpx;[^}]*height:\s*38.46rpx;/s);
  assert.match(css, /\.stepper-value\s*{[^}]*width:\s*42.31rpx;[^}]*font-size:\s*28rpx;[^}]*line-height:\s*1;[^}]*font-weight:\s*700;/s);
  assert.match(css, /\.location-value\s*{[^}]*color:\s*#272064;[^}]*font-size:\s*28rpx;[^}]*line-height:\s*40rpx;/s);
  assert.match(css, /\.date-time-row-value--filled\s*\{[^}]*color:\s*#000000;/s);
  assert.match(css, /\.activity-time-card,[\s\S]*?\.deadline-card\s*\{[^}]*gap:\s*15.38rpx;[^}]*padding:\s*15.38rpx 23.08rpx;/s);
  assert.match(css, /\.date-time-row\s*\{[^}]*gap:\s*15.38rpx;/s);
  assert.match(css, /\.activity-time-grid,\s*\.deadline-grid\s*\{[^}]*gap:\s*15.38rpx;/s);
  assert.match(css, /\.bento-pair-row\s*\{[^}]*gap:\s*15.38rpx;/s);
  assert.match(css, /\.prototype-switch\s*\{[^}]*border-radius:\s*26.92rpx;/s);
  assert.match(css, /\.input-card\s*\{[^}]*gap:\s*16rpx;/s);
  assert.match(css, /\.activity-sheet-footer\s*\{[^}]*box-shadow:\s*0 -6rpx 24rpx rgba\(0, 0, 0, 0\.07\);/s);
  assert.match(css, /\.sheet-button\s*\{[^}]*border-radius:\s*23.08rpx;/s);
  assert.match(css, /\.activity-type-chevron\s*\{[^}]*width:\s*28rpx;[^}]*height:\s*28rpx;/s);
  assert.match(css, /\.location-value\.bento-placeholder-text\s*{[^}]*color:\s*#9ca3af;/s);
  assert.match(css, /\.activity-sheet-panel \.location-value\.bento-placeholder-text\s*{[^}]*color:\s*#9ca3af;[^}]*font-weight:\s*400;/s);
  assert.match(css, /\.textarea-input-wrap\s*{[^}]*position:\s*relative;[^}]*width:\s*100%;[^}]*min-height:\s*40rpx;/s);
  assert.match(css, /\.bento-textarea\s*{[^}]*height:\s*100%;[^}]*min-height:\s*40rpx;[^}]*font-size:\s*28rpx;[^}]*line-height:\s*40rpx;[^}]*font-weight:\s*400;/s);
  assert.match(css, /\.bento-textarea-placeholder\s*{[^}]*position:\s*absolute;[^}]*color:\s*#9ca3af;[^}]*font-size:\s*28rpx;[^}]*line-height:\s*40rpx;[^}]*font-weight:\s*400;[^}]*pointer-events:\s*none;/s);
  assert.match(css, /\.activity-sheet-panel--create\s*{[^}]*padding-bottom:\s*153\.85rpx;/s);
  assert.doesNotMatch(css, /\.activity-sheet-panel--(?:create|edit) \.activity-sheet-body\s*{/);
  assert.match(css, /\.bento-grid--create\s*{[^}]*gap:\s*15.38rpx;/s);
  assert.match(css, /\.activity-sheet-panel--create \.compact-card,[\s\S]*?height:\s*100rpx;/s);
  assert.match(css, /\.activity-sheet-panel--create \.compact-select-row\s*\{[^}]*gap:\s*16rpx;/s);
  assert.match(css, /\.activity-sheet-panel--create \.stepper-card\s*\{[^}]*min-height:\s*100rpx;/s);
  assert.match(css, /\.activity-sheet-panel--create \.stepper\s*\{[^}]*width:\s*211.54rpx;[^}]*height:\s*73.08rpx;[^}]*padding:\s*0 19.23rpx;[^}]*gap:\s*0;/s);
  assert.match(css, /\.activity-sheet-panel--create \.stepper-button\s*\{[^}]*width:\s*38.46rpx;[^}]*height:\s*38.46rpx;/s);
  assert.match(css, /\.stepper-value-input\s*\{[^}]*width:\s*42.31rpx;[^}]*height:\s*40rpx;[^}]*font-size:\s*28rpx;[^}]*font-weight:\s*700;[^}]*text-align:\s*center;/s);
  assert.match(css, /\.activity-sheet-panel--create \.participant-limit-card--create\s*\{[^}]*min-height:\s*0;[^}]*height:\s*0;[^}]*opacity:\s*0;[^}]*overflow:\s*hidden;[^}]*pointer-events:\s*none;[^}]*transition:/s);
  assert.match(css, /\.activity-sheet-panel--create \.participant-limit-card--create\.participant-limit-card--visible\s*\{[^}]*min-height:\s*100rpx;[^}]*height:\s*100rpx;[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/s);
  assert.match(css, /\.create-completed-text,[\s\S]*?color:\s*#111827;/s);
  assert.match(css, /\.activity-sheet-panel--create \.location-chevron\s*{[^}]*margin-top:\s*0;[^}]*align-self:\s*center;/s);
  assert.match(css, /\.activity-sheet-panel--create \.bento-textarea\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*48rpx;[^}]*max-height:\s*200rpx;[^}]*padding:\s*0;[^}]*line-height:\s*40rpx;/s);
  assert.doesNotMatch(css, /overflow-y:\s*auto;/);
  assert.match(css, /\.activity-sheet-footer--create\s*{[^}]*height:\s*153.85rpx;[^}]*border-top-width:\s*2rpx;/s);
  assert.match(css, /\.activity-sheet-footer-actions--create\s*{[^}]*height:\s*107.69rpx;[^}]*padding:\s*11.54rpx 38.46rpx;/s);
  assert.match(css, /\.sheet-button--primary-create\s*{[^}]*box-shadow:\s*0 4rpx 16rpx rgba\(0, 0, 0, 0\.05\);/s);
  assert.match(css, /\.activity-sheet-panel--edit\s*{[^}]*padding-bottom:\s*153\.85rpx;/s);
  assert.match(css, /\.bento-grid--edit\s*{[^}]*gap:\s*15.38rpx;/s);
  assert.match(css, /\.activity-sheet-panel--edit \.compact-card,[\s\S]*?height:\s*100rpx;/s);
  assert.match(css, /\.activity-sheet-panel--edit \.participant-limit-card--edit\s*{[^}]*min-height:\s*0;[^}]*height:\s*0;[^}]*opacity:\s*0;[^}]*overflow:\s*hidden;[^}]*pointer-events:\s*none;[^}]*transition:/s);
  assert.match(css, /\.activity-sheet-panel--edit \.participant-limit-card--edit\.participant-limit-card--visible\s*{[^}]*min-height:\s*100rpx;[^}]*height:\s*100rpx;[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/s);
  assert.match(css, /\.activity-sheet-panel--edit \.bento-textarea\s*{[^}]*height:\s*100%;[^}]*min-height:\s*48rpx;[^}]*max-height:\s*210rpx;[^}]*padding:\s*0;[^}]*line-height:\s*42rpx;/s);
  assert.match(css, /\.activity-sheet-footer--double\s*{[^}]*height:\s*153.85rpx;[^}]*border-top-width:\s*2rpx;/s);
  assert.match(css, /\.activity-sheet-footer-actions--edit\s*{[^}]*height:\s*107.69rpx;[^}]*padding:\s*11.54rpx 38.46rpx;[^}]*gap:\s*15.38rpx;/s);
  assert.match(css, /\.sheet-button--secondary-edit\s*{[^}]*width:\s*215.38rpx;[^}]*border:\s*2rpx solid #ff9800;[^}]*background:\s*transparent;[^}]*color:\s*#ff9800;[^}]*font-weight:\s*600;/s);
});

test("prototype switch tap toggles fields and initializes participant count", () => {
  const limitContext = createContext(definition, {
    minParticipants: 4,
    form: { limitEnabled: false, maxParticipants: 0 }
  });
  definition.methods.onSwitchTap.call(limitContext, {
    currentTarget: { dataset: { field: "limitEnabled" } }
  });
  assert.equal(limitContext.data.form.limitEnabled, true);
  assert.equal(limitContext.data.form.maxParticipants, 12);

  limitContext.data.participantInputFocused = true;
  definition.methods.onSwitchTap.call(limitContext, {
    currentTarget: { dataset: { field: "limitEnabled" } }
  });
  assert.equal(limitContext.data.form.limitEnabled, false);
  assert.equal(limitContext.data.participantInputFocused, false);

  const signupContext = createContext(definition, {
    form: { signupEnabled: true }
  });
  definition.methods.onSwitchTap.call(signupContext, {
    currentTarget: { dataset: { field: "signupEnabled" } }
  });
  assert.equal(signupContext.data.form.signupEnabled, false);
});

test("participant stepper respects lower and upper bounds", () => {
  const decrementContext = createContext(definition, {
    minParticipants: 1,
    form: { limitEnabled: true, maxParticipants: 12 }
  });
  definition.methods.decrementParticipants.call(decrementContext);
  assert.equal(decrementContext.data.form.maxParticipants, 11);

  const lowerBoundContext = createContext(definition, {
    minParticipants: 1,
    form: { limitEnabled: true, maxParticipants: 1 }
  });
  definition.methods.decrementParticipants.call(lowerBoundContext);
  assert.equal(lowerBoundContext.data.form.maxParticipants, 1);

  const incrementContext = createContext(definition, {
    minParticipants: 1,
    form: { limitEnabled: true, maxParticipants: 12 }
  });
  definition.methods.incrementParticipants.call(incrementContext);
  assert.equal(incrementContext.data.form.maxParticipants, 13);

  const upperBoundContext = createContext(definition, {
    minParticipants: 1,
    form: { limitEnabled: true, maxParticipants: 999 }
  });
  definition.methods.incrementParticipants.call(upperBoundContext);
  assert.equal(upperBoundContext.data.form.maxParticipants, 999);
});

test("participant number opens numeric input and normalizes typed value", () => {
  const context = createContext(definition, {
    isEdit: false,
    participantInputFocused: false,
    minParticipants: 4,
    form: { limitEnabled: true, maxParticipants: 12 }
  });

  definition.methods.focusParticipantInput.call(context);
  assert.equal(context.data.participantInputFocused, true);

  definition.methods.onParticipantInput.call(context, {
    detail: { value: "10a05" }
  });
  assert.equal(context.data.form.maxParticipants, "100");

  context.data.form.maxParticipants = "0";
  definition.methods.onParticipantBlur.call(context);
  assert.equal(context.data.form.maxParticipants, 4);
  assert.equal(context.data.participantInputFocused, false);

  context.data.form.maxParticipants = "1000";
  context.data.participantInputFocused = true;
  definition.methods.onParticipantConfirm.call(context);
  assert.equal(context.data.form.maxParticipants, 999);
  assert.equal(context.data.participantInputFocused, false);

  const editContext = createContext(definition, {
    isEdit: true,
    participantInputFocused: false,
    form: { limitEnabled: true, maxParticipants: 12 }
  });
  definition.methods.focusParticipantInput.call(editContext);
  assert.equal(editContext.data.participantInputFocused, false);
});


test("activity cover field opens its own secondary sheet and confirmation updates the form", () => {
  const context = createContext(definition, {
    isEdit: false,
    coverPickerVisible: false,
    form: { activityCoverId: "" }
  });

  definition.methods.openCoverPicker.call(context);
  assert.equal(context.data.coverPickerVisible, true);

  definition.methods.confirmCoverPicker.call(context, {
    detail: { id: "lam-001", artistName: "LAM" }
  });
  assert.equal(context.data.coverPickerVisible, false);
  assert.equal(context.data.form.activityCoverId, "lam-001");
});

test("activity type sheet follows the prototype grouping and preserves temporary selection until confirmation", () => {
  const componentPath = require.resolve("../components/activity-type-picker-sheet/index.js");
  const previousComponent = global.Component;
  let typeDefinition;
  global.Component = (value) => { typeDefinition = value; };
  delete require.cache[componentPath];
  const helpers = require(componentPath);
  global.Component = previousComponent;

  const groups = helpers.buildGroupedOptions(
    ["badminton", "boardgame", "other", "eating", "outing", "movie"],
    ["羽毛球", "桌游", "其它", "吃饭", "外出", "电影"]
  );
  assert.deepEqual(groups.map((group) => [group.title, group.options.map((item) => item.label)]), [
    ["室内活动", ["桌游", "电影", "吃饭"]],
    ["外出活动", ["外出", "羽毛球", "其他"]]
  ]);

  const events = [];
  const context = {
    ...typeDefinition.methods,
    properties: {
      value: "boardgame",
      optionValues: ["badminton", "boardgame", "other", "eating", "outing", "movie"],
      optionLabels: ["羽毛球", "桌游", "其它", "吃饭", "外出", "电影"]
    },
    data: { ...typeDefinition.data },
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { events.push({ name, detail }); }
  };
  typeDefinition.methods.initializeOptions.call(context);
  assert.equal(context.data.selectedValue, "boardgame");
  typeDefinition.methods.onSelect.call(context, { currentTarget: { dataset: { value: "outing" } } });
  assert.equal(context.data.selectedValue, "outing");
  assert.equal(events.length, 0);
  typeDefinition.methods.onConfirm.call(context);
  assert.deepEqual(events, [{ name: "confirm", detail: { value: "outing", label: "外出", index: 4 } }]);
});

test("activity cover sheet markup and dimensions match the Pencil component", () => {
  const formWxml = readActivityFormWxml();
  const coverWxml = fs.readFileSync(path.join(__dirname, "../components/activity-cover-picker-sheet/index.wxml"), "utf8");
  const coverSurfaceWxml = fs.readFileSync(path.join(__dirname, "../components/activity-cover-picker-sheet/surface.wxml"), "utf8");
  const coverCss = fs.readFileSync(path.join(__dirname, "../components/activity-cover-picker-sheet/index.wxss"), "utf8");

  assert.match(formWxml, /bindtap="openCoverPicker"/);
  assert.doesNotMatch(formWxml, /<picker[^>]*mode="selector"/);
  assert.match(formWxml, /<activity-cover-picker-sheet[\s\S]*visible="{{coverPickerVisible}}"[\s\S]*bindconfirm="confirmCoverPicker"/);
  assert.match(coverWxml, /<block wx:if="{{embedded && containerRendered}}">/);
  assert.match(coverWxml, /id="qaActivityCoverPickerContainer"[\s\S]*position="bottom"/);
  assert.match(coverSurfaceWxml, /选择活动封面/);
  assert.match(coverSurfaceWxml, /type="list" scroll-x="{{true}}" enable-flex="{{true}}"/);
  assert.match(coverSurfaceWxml, /cover-artwork--selected/);
  assert.match(coverCss, /border-radius:\s*42\.31rpx 42\.31rpx 0 0/);
  assert.match(coverCss, /width:\s*296\.15rpx/);
  assert.match(coverSurfaceWxml, /<view class="cover-artwork-border"><\/view>/);
  assert.match(coverCss, /\.cover-artwork--selected \.cover-artwork-border\s*{[\s\S]*?border-width:\s*5\.77rpx;/);
  assert.match(coverCss, /\.cover-sheet-content\s*{[\s\S]*?margin-top:\s*23\.08rpx;[\s\S]*?margin-bottom:\s*23\.08rpx;/);
  assert.doesNotMatch(coverWxml, /cover-sheet-embedded-root--suspended/);
  assert.match(coverWxml, /show="{{containerVisible}}"/);
  assert.match(coverCss, /\.cover-sheet-footer\s*{[\s\S]*?height:\s*153\.85rpx;/);
  assert.match(coverCss, /\.cover-sheet-confirm\s*{[\s\S]*?height:\s*84\.62rpx;[\s\S]*?border-radius:\s*23\.08rpx;[\s\S]*?font-weight:\s*700;/);
});

test("activity cover confirmation action keeps the prototype full width", () => {
  const coverCss = fs.readFileSync(path.join(__dirname, "../components/activity-cover-picker-sheet/index.wxss"), "utf8");

  assert.match(coverCss, /padding:\s*11\.54rpx 38\.46rpx 57\.69rpx/);
  assert.match(coverCss, /justify-content:\s*center/);
  assert.match(coverCss, /\.cover-sheet-confirm\s*\{[\s\S]*?width:\s*auto;[\s\S]*?min-width:\s*0;[\s\S]*?flex:\s*1;/);
  assert.match(coverCss, /\.cover-sheet-confirm\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/);
});

test("create and edit forms embed their pickers in one full-height native container", () => {
  const formWxml = readActivityFormWxml();
  const listWxml = fs.readFileSync(path.join(__dirname, "../pages/activity_list/activity_list.wxml"), "utf8");
  const detailWxml = fs.readFileSync(path.join(__dirname, "../pages/activity_detail/activity_detail.wxml"), "utf8");
  const pickerWxml = fs.readFileSync(path.join(__dirname, "../components/date-time-picker-sheet/index.wxml"), "utf8");
  const pickerSurfaceWxml = fs.readFileSync(path.join(__dirname, "../components/date-time-picker-sheet/surface.wxml"), "utf8");
  assert.match(formWxml, /<date-time-picker-sheet[\s\S]*wx:if="{{!externalDateTimePicker}}"/);
  assert.match(formWxml, /<date-time-picker-sheet[\s\S]*visible="{{pickerVisible}}"/);
  assert.match(formWxml, /bottom-offset-rpx="{{routeEmbedded \? 323\.08 : 0}}"/);
  assert.match(listWxml, /id="qaActivityCreateContainer"[\s\S]*custom-style="height: 100%; background: transparent; border-radius: 0; overflow: hidden;"/);
  assert.match(listWxml, /<activity-form-sheet[\s\S]*id="qaActivityCreateForm"[\s\S]*style="display: block; width: 100%; height: 100%;"[\s\S]*route-embedded="{{true}}"/);
  assert.doesNotMatch(listWxml, /external-date-time-picker|openCreateDateTimePicker|qaActivityCreateDateTimePicker/);
  assert.match(detailWxml, /id="qaActivityEditContainer"[\s\S]*custom-style="height: 100%; background: transparent; border-radius: 0; overflow: hidden;"/);
  assert.match(detailWxml, /<activity-form-sheet[\s\S]*id="qaActivityFormSheet"[\s\S]*style="display: block; width: 100%; height: 100%;"[\s\S]*route-embedded="{{true}}"[\s\S]*mode="edit"/);
  assert.doesNotMatch(detailWxml, /external-date-time-picker|openEditDateTimePicker|qaEditDateTimePickerSheet/);
  assert.match(pickerWxml, /<block wx:if="{{embedded && containerRendered}}">/);
  assert.match(pickerWxml, /<page-container[\s\S]*wx:if="{{!embedded && containerRendered}}"/);
  assert.match(pickerWxml, /id="qaDateTimePickerContainer"[\s\S]*show="{{containerVisible}}"[\s\S]*position="bottom"/);
  assert.match(pickerWxml, /overlay="{{true}}"[\s\S]*close-on-slide-down="{{false}}"[\s\S]*bind:clickoverlay="onClose"/);
  assert.match(pickerSurfaceWxml, /id="qaDateTimePickerSurface"[^>]*class="picker-sheet-panel"/);
  assert.doesNotMatch(pickerWxml, /draggable-sheet|root-portal|worklet:onsizeupdate/);
});



test("picker uses five flat Skyline swiper columns and prototype clipping geometry", () => {
  const formCss = fs.readFileSync(path.join(__dirname, "../components/activity-form-sheet/index.wxss"), "utf8");
  const pickerWxml = fs.readFileSync(path.join(__dirname, "../components/date-time-picker-sheet/index.wxml"), "utf8");
  const pickerSurfaceWxml = fs.readFileSync(path.join(__dirname, "../components/date-time-picker-sheet/surface.wxml"), "utf8");
  const pickerCss = fs.readFileSync(path.join(__dirname, "../components/date-time-picker-sheet/index.wxss"), "utf8");
  const pickerJs = fs.readFileSync(path.join(__dirname, "../components/date-time-picker-sheet/index.js"), "utf8");

  assert.match(pickerSurfaceWxml, /class="picker-sheet-selection picker-sheet-selection--{{mode}}"/);
  assert.equal((pickerSurfaceWxml.match(/<swiper class="picker-sheet-column/g) || []).length, 5);
  assert.equal((pickerSurfaceWxml.match(/display-multiple-items="5"/g) || []).length, 5);
  assert.equal((pickerSurfaceWxml.match(/duration="90"/g) || []).length, 5);
  assert.equal((pickerSurfaceWxml.match(/cache-extent="1"/g) || []).length, 5);
  assert.match(pickerSurfaceWxml, /vertical="{{true}}"[^>]*display-multiple-items="5"/);
  assert.match(pickerSurfaceWxml, /bindchange="onFlatColumnChange"/);
  assert.match(pickerSurfaceWxml, /current="{{yearSwiperIndex}}"/);
  assert.match(pickerSurfaceWxml, /current="{{minuteSwiperIndex}}"/);
  assert.doesNotMatch(pickerSurfaceWxml, /current="{{pickerValue\[/);
  assert.doesNotMatch(pickerSurfaceWxml, /current="{{(?:hour|minute)PickerIndex}}"/);
  assert.doesNotMatch(pickerSurfaceWxml, /picker-view|picker-view-column|indicator-class|indicator-style/);
  assert.match(pickerSurfaceWxml, /class="picker-sheet-muted-mask picker-sheet-muted-mask--top"/);
  assert.match(pickerSurfaceWxml, /class="picker-sheet-muted-mask picker-sheet-muted-mask--bottom"/);
  assert.match(pickerSurfaceWxml, /src="\/images\/icon-close\.svg"/);
  assert.match(pickerSurfaceWxml, /<view class="picker-sheet-confirm"[\s\S]*>确定<\/view>/);
  assert.doesNotMatch(pickerSurfaceWxml, /<button class="picker-sheet-confirm"/);
  assert.match(pickerSurfaceWxml, /picker-sheet-item--selected/);
  assert.doesNotMatch(pickerSurfaceWxml, /mask-style="background:\s*transparent;"/);

  assert.doesNotMatch(pickerJs, /getFixedHeightSheetSize|skylineSheet|scrollTo\(/);
  assert.doesNotMatch(formCss, /\.activity-sheet-panel--covered\s*\{[^}]*filter\s*:/s);
  assert.match(pickerCss, /\.picker-sheet-embedded-mask\s*\{[^}]*background:\s*rgba\(21, 21, 31, 0\.4\);/s);
  assert.match(pickerWxml, /custom-style="height: 761\.54rpx; max-height: 92vh; bottom: {{bottomOffsetRpx}}rpx;[^\"]*border-radius: 46\.15rpx 46\.15rpx 0 0;/);
  assert.match(pickerCss, /\.picker-sheet-panel\s*{[\s\S]*?height:\s*100%;[\s\S]*?max-height:\s*100%;[\s\S]*?border-radius:\s*46\.15rpx 46\.15rpx 0 0;/);
  assert.match(pickerCss, /\.picker-sheet-wheel\s*{[\s\S]*?height:\s*498\.08rpx;[\s\S]*?flex:\s*none;/);
  assert.match(pickerCss, /\.picker-sheet-selection\s*{[\s\S]*?z-index:\s*0;[\s\S]*?top:\s*201\.92rpx;[\s\S]*?height:\s*92\.31rpx;[\s\S]*?background:\s*#f5f5f5;[\s\S]*?pointer-events:\s*none;/);
  assert.match(pickerCss, /\.picker-sheet-view\s*\{[\s\S]*?top:\s*17\.31rpx;[\s\S]*?height:\s*461\.54rpx;/);
  assert.doesNotMatch(pickerCss, /scaleY\(/);
  assert.match(pickerCss, /\.picker-sheet-column\s*\{[\s\S]*?height:\s*461\.54rpx;/);
  assert.match(pickerCss, /\.picker-sheet-item\s*{[\s\S]*?height:\s*92\.31rpx;[\s\S]*?color:\s*#000000;[\s\S]*?font-size:\s*26\.92rpx;[\s\S]*?font-weight:\s*400;/);
  assert.match(pickerCss, /\.picker-sheet-item--selected\s*\{[^}]*font-weight:\s*600;/s);
  assert.match(pickerCss, /\.picker-sheet-muted-mask--top\s*\{[\s\S]*?height:\s*201\.92rpx;[\s\S]*?rgba\(255, 255, 255, 0\.58\)/);
  assert.match(pickerCss, /\.picker-sheet-muted-mask--bottom\s*\{[\s\S]*?top:\s*294\.23rpx;[\s\S]*?height:\s*203\.85rpx;[\s\S]*?rgba\(255, 255, 255, 0\.58\)/);
  assert.match(pickerCss, /\.picker-sheet-view--date \.picker-sheet-column--year\s*{[\s\S]*?width:\s*192\.31rpx;[\s\S]*?flex:\s*none;/);
  assert.match(pickerCss, /\.picker-sheet-view--date \.picker-sheet-column--month\s*{[\s\S]*?width:\s*192\.31rpx;[\s\S]*?flex:\s*none;/);
  assert.match(pickerCss, /\.picker-sheet-view--date \.picker-sheet-column--day\s*{[\s\S]*?min-width:\s*0;[\s\S]*?flex:\s*1;/);
  assert.match(pickerCss, /\.picker-sheet-view--datetime\s*{[^}]*padding:\s*0 30\.77rpx;/s);
  assert.match(pickerCss, /\.picker-sheet-view--datetime \.picker-sheet-column--year\s*{[\s\S]*?width:\s*96\.15rpx;[\s\S]*?flex:\s*none;/);
  assert.match(pickerCss, /\.picker-sheet-view--datetime \.picker-sheet-column--month\s*{[\s\S]*?width:\s*92\.31rpx;[\s\S]*?flex:\s*none;/);
  assert.match(pickerCss, /\.picker-sheet-view--datetime \.picker-sheet-column--day\s*{[\s\S]*?width:\s*246\.15rpx;[\s\S]*?flex:\s*none;/);
  assert.match(pickerCss, /\.picker-sheet-view--datetime \.picker-sheet-column--hour,[\s\S]*?width:\s*126\.92rpx;[\s\S]*?flex:\s*none;/);
  assert.match(pickerCss, /\.picker-sheet-view--datetime \.picker-sheet-column--hour\s*{[^}]*margin-left:\s*0;/s);
  assert.match(pickerCss, /\.picker-sheet-footer\s*{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*4;[\s\S]*?height:\s*153\.85rpx;[\s\S]*?padding-bottom:\s*57\.69rpx;[\s\S]*?box-shadow:\s*0 -6rpx 24rpx rgba\(0, 0, 0, 0\.07\);/);
  assert.match(pickerCss, /\.picker-sheet-confirm\s*{[\s\S]*?width:\s*calc\(100% - 61\.54rpx\);[\s\S]*?margin:\s*0 30\.77rpx;[\s\S]*?border-radius:\s*23\.08rpx;/);
  assert.match(pickerCss, /\.picker-sheet-embedded-panel\s*{[\s\S]*?bottom:\s*-761\.54rpx;[\s\S]*?transition:\s*bottom 220ms/);
  assert.doesNotMatch(pickerCss, /\.picker-sheet-embedded-panel[^}]*transform:/s);
});

test("activity form typography uses even pixel sizes and picker columns use date units without slash separators", () => {
  const formCss = fs.readFileSync(path.join(__dirname, "../components/activity-form-sheet/index.wxss"), "utf8");
  const pickerCss = fs.readFileSync(path.join(__dirname, "../components/date-time-picker-sheet/index.wxss"), "utf8");
  const pickerWxml = fs.readFileSync(path.join(__dirname, "../components/date-time-picker-sheet/index.wxml"), "utf8");
  const pickerSurfaceWxml = fs.readFileSync(path.join(__dirname, "../components/date-time-picker-sheet/surface.wxml"), "utf8");
  const oddPixelRpx = /font-size:\s*(22|26|30|34|42)rpx/;
  assert.doesNotMatch(formCss, oddPixelRpx);
  assert.doesNotMatch(pickerCss, oddPixelRpx);
  assert.match(pickerSurfaceWxml, /wx:for="{{yearLabels}}"/);
  assert.match(pickerSurfaceWxml, /}}月<\/view>/);
  assert.match(pickerSurfaceWxml, /wx:for="{{dayLabels}}"/);
  assert.doesNotMatch(pickerSurfaceWxml, /}}\s*\/<\/view>/);
  assert.match(pickerSurfaceWxml, /index === pickerValue\[0\][^\n]*picker-sheet-item--selected/);
  assert.match(pickerSurfaceWxml, /index === hourPickerIndex[^\n]*picker-sheet-item--selected/);
});

test("critical custom component hosts keep stable qa ids for runtime validation", () => {
  const listWxml = fs.readFileSync(
    path.join(__dirname, "../pages/activity_list/activity_list.wxml"),
    "utf8"
  );
  const detailWxml = fs.readFileSync(
    path.join(__dirname, "../pages/activity_detail/activity_detail.wxml"),
    "utf8"
  );
  const formWxml = fs.readFileSync(
    path.join(__dirname, "../components/activity-form-sheet/index.wxml"),
    "utf8"
  );

  const createFormHost = listWxml.match(/<activity-form-sheet\b[\s\S]*?\/>/)?.[0] || "";
  const editFormHost = detailWxml.match(/<activity-form-sheet\b[\s\S]*?\/>/)?.[0] || "";
  const coverPickerHost = formWxml.match(/<activity-cover-picker-sheet\b[\s\S]*?\/>/)?.[0] || "";
  const dateTimePickerHost = formWxml.match(/<date-time-picker-sheet\b[\s\S]*?\/>/)?.[0] || "";

  assert.match(createFormHost, /\bid="qaActivityCreateForm"/);
  assert.match(createFormHost, /\bmode="create"/);
  assert.match(createFormHost, /\broute-embedded="{{true}}"/);
  assert.match(createFormHost, /\bstyle="display: block; width: 100%; height: 100%;"/);
  assert.doesNotMatch(createFormHost, /\bexternal-date-time-picker/);
  assert.doesNotMatch(createFormHost, /\bexternal-activity-type-picker/);
  assert.match(editFormHost, /\bid="qaActivityFormSheet"/);
  assert.match(editFormHost, /\bmode="edit"/);
  assert.match(editFormHost, /\broute-embedded="{{true}}"/);
  assert.match(editFormHost, /\bstyle="display: block; width: 100%; height: 100%;"/);
  assert.doesNotMatch(editFormHost, /\bexternal-date-time-picker/);
  assert.match(coverPickerHost, /\bid="qaActivityCoverPickerSheet"/);
  assert.match(dateTimePickerHost, /\bid="qaDateTimePickerSheet"/);
  assert.doesNotMatch(listWxml, /\bid="qaActivityCreateDateTimePicker"/);
  assert.doesNotMatch(detailWxml, /\bid="qaEditDateTimePickerSheet"/);
});

test("edit activity cancellation uses the shared warning dialog before emitting the action", () => {
  const componentDir = path.join(__dirname, "../components/activity-form-sheet");
  const config = JSON.parse(fs.readFileSync(path.join(componentDir, "index.json"), "utf8"));
  const wxml = fs.readFileSync(path.join(componentDir, "index.wxml"), "utf8");
  const js = fs.readFileSync(path.join(componentDir, "index.js"), "utf8");

  assert.equal(config.usingComponents["create-access-dialog"], "../create-access-dialog/index");
  assert.match(wxml, /<create-access-dialog[\s\S]*?id="qaCancelActivityDialog"[\s\S]*?bindconfirm="confirmCancelActivity"/);
  assert.match(js, /onCancelActivity\(\)[\s\S]*?selectComponent\("#qaCancelActivityDialog"\)[\s\S]*?title:\s*"确认取消活动？"[\s\S]*?confirmText:\s*"确认取消"[\s\S]*?confirmBehavior:\s*"emit"/);
  assert.match(js, /confirmCancelActivity\(\)[\s\S]*?this\.triggerEvent\("cancelactivity"\)/);
});
