const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_NAME_LENGTH,
  MAX_REMARK_LENGTH,
  buildCreateForm,
  buildEditForm,
  applyStartDateTime,
  validateActivityForm,
  buildActivityPayload
} = require("../utils/activityForm");


test("new and edited activities use a cover instead of an activity type", () => {
  assert.equal(buildCreateForm(new Date(2026, 7, 17, 10, 0, 0)).activityCoverId, "");
  assert.equal(buildEditForm({ activity_cover_id: "lam-001" }).activityCoverId, "lam-001");
});

test("activity name limit is 10 characters", () => {
  assert.equal(MAX_NAME_LENGTH, 10);

  const now = new Date(2026, 7, 16, 10, 0, 0);
  const base = {
    ...buildCreateForm(now),
    startDate: "2026-08-16", startTime: "12:00",
    endDate: "2026-08-16", endTime: "13:00",
    signupDeadlineDate: "2026-08-16", signupDeadlineTime: "11:00",
    remark: "活动说明",
    activityCoverId: "lam-001"
  };
  assert.equal(validateActivityForm({ ...base, name: "活".repeat(10) }, { mode: "create", now }).ok, true);
  assert.match(validateActivityForm({ ...base, name: "活".repeat(11) }, { mode: "create", now }).message, /不能超过 10 个字/);
});

test("activity remark limit is 120 characters", () => {
  assert.equal(MAX_REMARK_LENGTH, 120);

  const now = new Date(2026, 7, 16, 10, 0, 0);
  const base = {
    ...buildCreateForm(now),
    name: "羽毛球",
    startDate: "2026-08-16", startTime: "12:00",
    endDate: "2026-08-16", endTime: "13:00",
    signupDeadlineDate: "2026-08-16", signupDeadlineTime: "11:00",
    activityCoverId: "lam-001"
  };
  assert.equal(validateActivityForm({ ...base, remark: "备".repeat(120) }, { mode: "create", now }).ok, true);
  assert.match(validateActivityForm({ ...base, remark: "备".repeat(121) }, { mode: "create", now }).message, /不能超过 120 个字/);
});

test("buildCreateForm uses rounded +2h/+1h/-1h defaults", () => {
  const form = buildCreateForm(new Date(2026, 7, 16, 21, 53, 20), "boardgame");
  assert.equal(`${form.startDate} ${form.startTime}`, "2026-08-16 23:55");
  assert.equal(`${form.endDate} ${form.endTime}`, "2026-08-17 00:55");
  assert.equal(`${form.signupDeadlineDate} ${form.signupDeadlineTime}`, "2026-08-16 22:55");
  assert.equal(form.activityCoverId, "");
  assert.equal(form.limitEnabled, true);
  assert.equal(form.maxParticipants, 12);
});

test("buildEditForm preserves values and derives missing deadline", () => {
  const form = buildEditForm({
    name: "桌游夜",
    status: "未开始",
    startTime: "2026-08-20 19:00",
    endTime: "2026-08-20 22:00",
    maxParticipants: 8,
    signupEnabled: false
  });
  assert.equal(`${form.signupDeadlineDate} ${form.signupDeadlineTime}`, "2026-08-20 18:00");
  assert.equal(form.limitEnabled, true);
  assert.equal(form.maxParticipants, 8);
  assert.equal(form.signupEnabled, false);
});

test("applyStartDateTime only fills empty linked fields", () => {
  const filled = applyStartDateTime({ endDate: "", endTime: "", signupDeadlineDate: "", signupDeadlineTime: "" }, "2026-08-20 19:00");
  assert.equal(`${filled.endDate} ${filled.endTime}`, "2026-08-20 20:00");
  assert.equal(`${filled.signupDeadlineDate} ${filled.signupDeadlineTime}`, "2026-08-20 18:00");

  const preserved = applyStartDateTime({
    endDate: "2026-08-21", endTime: "21:00",
    signupDeadlineDate: "2026-08-19", signupDeadlineTime: "12:00"
  }, "2026-08-20 19:00");
  assert.equal(`${preserved.endDate} ${preserved.endTime}`, "2026-08-21 21:00");
  assert.equal(`${preserved.signupDeadlineDate} ${preserved.signupDeadlineTime}`, "2026-08-19 12:00");
});

test("validation checks text, time and participant limits", () => {
  const now = new Date(2026, 7, 16, 10, 0, 0);
  const valid = {
    ...buildCreateForm(now),
    name: "羽毛球",
    remark: "活动说明",
    startDate: "2026-08-16", startTime: "12:00",
    endDate: "2026-08-16", endTime: "13:00",
    signupDeadlineDate: "2026-08-16", signupDeadlineTime: "11:00",
    activityCoverId: "lam-001"
  };
  assert.equal(validateActivityForm(valid, { mode: "create", now }).ok, true);
  assert.match(validateActivityForm({ ...valid, name: "" }, { mode: "create", now }).message, /活动名称/);
  assert.match(validateActivityForm({ ...valid, remark: "" }, { mode: "create", now }).message, /请输入活动备注/);
  assert.match(validateActivityForm({ ...valid, remark: "   " }, { mode: "edit", now }).message, /请输入活动备注/);
  assert.match(validateActivityForm({ ...valid, endTime: "11:00" }, { mode: "create", now }).message, /结束时间/);
  assert.match(validateActivityForm({ ...valid, signupDeadlineTime: "12:30" }, { mode: "create", now }).message, /报名截止/);
  assert.match(validateActivityForm({ ...valid, limitEnabled: true, maxParticipants: 1000 }, { mode: "create", now }).message, /999/);
  assert.match(validateActivityForm({ ...valid, limitEnabled: true, maxParticipants: 3 }, { mode: "edit", participantCount: 4, now }).message, /当前报名人数 4/);
});

test("payload includes the selected cover and no activity type", () => {
  const form = { ...buildCreateForm(new Date(2026, 7, 16, 10, 0, 0)), name: "电影", activityCoverId: "lam-001" };
  const createPayload = buildActivityPayload(form, { mode: "create" });
  const editPayload = buildActivityPayload(form, { mode: "edit" });
  assert.equal(createPayload.activity_cover_id, "lam-001");
  assert.equal(editPayload.activity_cover_id, "lam-001");
  assert.equal(Object.prototype.hasOwnProperty.call(createPayload, "activity_type"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(editPayload, "activity_type"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(editPayload, "activity_style_key"), false);
  assert.equal(createPayload.max_participants, 12);

  const unlimitedPayload = buildActivityPayload({ ...form, limitEnabled: false }, { mode: "create" });
  assert.equal(unlimitedPayload.max_participants, null);
});
