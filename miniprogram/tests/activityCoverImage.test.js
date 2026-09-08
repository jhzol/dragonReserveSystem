const test = require("node:test");
const assert = require("node:assert/strict");
const { enrichSingleActivity } = require("../utils/activityEnrich");

test("shared activity enrichment uses full cover rather than thumbnail for small cards", () => {
  const activity = enrichSingleActivity({
    id: 1,
    activity_cover: {
      id: "test-001",
      image_url: "https://example.com/full.jpg",
      thumbnail_url: "https://example.com/thumb.jpg"
    }
  }, [], "", "");
  assert.equal(activity.smallCardBgImageUrl, "https://example.com/full.jpg");
  assert.equal(activity.smallCardBgImageUrl, activity.largeCardBgImageUrl);
});
