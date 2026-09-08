const activityService = require("../../services/activity");
const { setActivityCoverPreviewSession } = require("../../utils/activityCoverPreviewSession");

let catalogCache = null;
let catalogPromise = null;

function normalizeCatalog(value) {
  if (!Array.isArray(value)) return [];
  return value.map((artist) => ({
    slug: String(artist.slug || ""),
    displayName: String(artist.display_name || artist.displayName || ""),
    avatarUrl: String(artist.avatar_url || artist.avatarUrl || ""),
    artworks: (Array.isArray(artist.artworks) ? artist.artworks : []).map((artwork, artworkIndex) => ({
      id: String(artwork.id || ""),
      artistSlug: String(artwork.artist_slug || artwork.artistSlug || artist.slug || ""),
      artistName: String(artwork.artist_name || artwork.artistName || artist.display_name || ""),
      artistAvatarUrl: String(artwork.artist_avatar_url || artwork.artistAvatarUrl || artist.avatar_url || ""),
      width: Number(artwork.width) || 0,
      height: Number(artwork.height) || 0,
      thumbnailUrl: String(artwork.thumbnail_url || artwork.thumbnailUrl || ""),
      imageUrl: String(artwork.image_url || artwork.imageUrl || ""),
      enterDelayMs: artworkIndex * 200
    })).filter((artwork) => artwork.id && artwork.thumbnailUrl && artwork.imageUrl)
  })).filter((artist) => artist.slug && artist.artworks.length);
}

function loadCatalog() {
  if (catalogCache) return Promise.resolve(catalogCache);
  if (catalogPromise) return catalogPromise;
  catalogPromise = activityService.listActivityCovers()
    .then((result) => {
      catalogCache = normalizeCatalog(result);
      return catalogCache;
    })
    .finally(() => {
      catalogPromise = null;
    });
  return catalogPromise;
}

Component({
  options: { styleIsolation: "isolated" },

  properties: {
    visible: { type: Boolean, value: false },
    value: { type: String, value: "" },
    embedded: { type: Boolean, value: false }
  },

  data: {
    containerRendered: false,
    containerVisible: false,
    loading: false,
    loadFailed: false,
    skeletonGroups: [0, 1, 2],
    skeletonCards: [0, 1, 2],
    previewTransitionDuration: 360,
    artists: [],
    selectedId: ""
  },

  observers: {
    "visible, value": function (visible, value) {
      if (visible) {
        this.setData({ selectedId: String(value || "") });
        this.loadAndMount();
      } else {
        this.unmountContainer();
      }
    }
  },

  lifetimes: {
    attached() {
      if (this.properties.visible) this.loadAndMount();
    },
    detached() {
      if (this._leaveTimer) clearTimeout(this._leaveTimer);
    }
  },

  methods: {
    loadAndMount() {
      if (catalogCache) {
        this.setData({ artists: catalogCache, loading: false, loadFailed: false }, () => {
          this.mountContainer();
        });
        return;
      }
      this.setData({ loading: true, loadFailed: false }, () => {
        this.mountContainer();
      });
      loadCatalog()
        .then((artists) => {
          if (!this.properties.visible) return;
          this.setData({ artists, loading: false, loadFailed: false });
        })
        .catch(() => {
          if (!this.properties.visible) return;
          this.setData({ loading: false, loadFailed: true });
        });
    },

    retryLoad() {
      catalogCache = null;
      this.loadAndMount();
    },

    mountContainer() {
      if (this._leaveTimer) clearTimeout(this._leaveTimer);
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
        if (!this.properties.visible) this.setData({ containerRendered: false });
      }, 240);
    },

    onContainerAfterLeave() {
      if (!this.properties.visible) this.setData({ containerRendered: false });
    },

    stopPropagation() {},

    onClose() {
      this.triggerEvent("close");
    },

    onSelect(e) {
      const id = String(e.currentTarget.dataset.id || "");
      if (id) this.setData({ selectedId: id });
    },

    onPreview(e) {
      const artistIndex = Number(e.currentTarget.dataset.artistIndex);
      const artworkIndex = Number(e.currentTarget.dataset.artworkIndex);
      const artist = this.data.artists[artistIndex];
      if (!artist || !artist.artworks[artworkIndex]) return;
      const artwork = artist.artworks[artworkIndex];
      setActivityCoverPreviewSession({ artist, artworkIndex });

      const openPreview = (openContainer) => {
        const options = {
          url: "/pages/activity_cover_preview/activity_cover_preview",
          events: {
            disableActivityCoverPreviewReturnTransition: () => {
              this.setData({ previewTransitionDuration: 0 });
            },
            selectActivityCover: (selectedArtwork) => {
              if (!selectedArtwork || !selectedArtwork.id) return;
              this.setData({ selectedId: String(selectedArtwork.id) }, () => {
                this.triggerEvent("confirm", selectedArtwork);
              });
            }
          }
        };
        if (openContainer) options.withOpenContainer = openContainer;
        wx.navigateTo(options);
      };

      this.setData({ previewTransitionDuration: 360 }, () => {
        this.createSelectorQuery()
          .select(`#coverPreviewTransition-${artistIndex}-${artworkIndex}`)
          .node()
          .exec((result) => {
            const openContainer = result && result[0] && result[0].node;
            openPreview(openContainer || null);
          });
      });
    },

    onConfirm() {
      const selectedId = this.data.selectedId;
      for (const artist of this.data.artists) {
        const artwork = artist.artworks.find((item) => item.id === selectedId);
        if (artwork) {
          this.triggerEvent("confirm", artwork);
          return;
        }
      }
      wx.showToast({ title: "请选择活动封面", icon: "none" });
    }
  }
});

module.exports = { normalizeCatalog };
