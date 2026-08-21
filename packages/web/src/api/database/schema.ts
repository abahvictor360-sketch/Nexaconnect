import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Vifug schema - implements data-model.md exactly.
 * Store words, not slides. Sections stored once; arrangements order them.
 * Styling cascades: theme -> song override -> arrangement/playlist-item override.
 */

const now = () => new Date().toISOString();

export const songs = sqliteTable("songs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  altTitles: text("alt_titles"), // JSON array
  authors: text("authors"), // JSON array
  copyright: text("copyright"),
  ccliNumber: text("ccli_number"),
  defaultLang: text("default_lang").notNull().default("en"), // BCP-47
  songKey: text("song_key"),
  tempo: integer("tempo"),
  tags: text("tags"), // JSON array
  themeId: text("theme_id"),
  backgroundId: text("background_id"),
  // Per-song text color, layered over the resolved theme's color the same
  // way Bible/Presentation overrides layer over the app theme.
  textColor: text("text_color"),
  source: text("source").notNull().default("manual"), // manual|import_txt|import_docx|import_pptx|library
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

export const sections = sqliteTable("sections", {
  id: text("id").primaryKey(),
  songId: text("song_id").notNull(),
  type: text("type").notNull(), // verse|chorus|pre_chorus|bridge|tag|intro|ending|refrain
  label: text("label").notNull(),
  number: integer("number"),
  lang: text("lang").notNull().default("en"),
  lyrics: text("lyrics").notNull(), // raw, newline-separated
  manualBreaks: text("manual_breaks"), // JSON array of line indexes
  orderIndex: integer("order_index").notNull().default(0),
  /**
   * Colour/emphasis as JSON: [{ start, end, color?, bold?, italic?,
   * underline? }] with character offsets into `lyrics`. Kept beside the text
   * rather than as markup inside it so the lyrics stay plain and searchable.
   */
  format: text("format"),
  /** Per-section alignment override; null = inherit the theme's. */
  textAlign: text("text_align"),
});

export const arrangements = sqliteTable("arrangements", {
  id: text("id").primaryKey(),
  songId: text("song_id").notNull(),
  name: text("name").notNull(),
  isDefault: integer("is_default").notNull().default(0),
});

export const arrangementItems = sqliteTable("arrangement_items", {
  id: text("id").primaryKey(),
  arrangementId: text("arrangement_id").notNull(),
  sectionId: text("section_id").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
});

export const translations = sqliteTable("translations", {
  id: text("id").primaryKey(),
  sectionId: text("section_id").notNull(),
  lang: text("lang").notNull(),
  lyrics: text("lyrics").notNull(),
  source: text("source").notNull().default("human"), // human|imported|machine
});

export const media = sqliteTable("media", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // image|video|audio|color
  uri: text("uri").notNull(),
  loop: integer("loop").default(1),
  fit: text("fit").default("cover"),
  // Videos are silent by default (matches how backgrounds are normally used -
  // playing under lyrics/scripture). Toggle off per item when a video should
  // play WITH sound (e.g. a welcome or testimony video shown on its own).
  muted: integer("muted").default(1),
  /**
   * What this file is for. null = an ordinary background the operator added
   * and expects to see in the Media library.
   *
   * "slide" marks a page rendered out of an imported deck. Those are parts of
   * a presentation rather than media in their own right: a twenty-slide import
   * would otherwise drop twenty pictures into the library and into every
   * background picker, burying the handful of backgrounds actually chosen on
   * purpose. They are hidden from listings and travel with their presentation.
   */
  role: text("role"),
  /** LUT-style look preset id (see web/lib/color-filters.ts), or a raw CSS filter string. */
  colorFilter: text("color_filter"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

/**
 * Presentations - the same "store words, not slide images" philosophy as
 * songs, extended to freeform slides (title/body text over a background).
 * Built in-app or imported from PPTX (best-effort text + first image per
 * slide, not a pixel-exact PPTX renderer).
 */
export const presentations = sqliteTable("presentations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  source: text("source").notNull().default("manual"), // manual|import_pptx
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

export const presentationSlides = sqliteTable("presentation_slides", {
  id: text("id").primaryKey(),
  presentationId: text("presentation_id").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  heading: text("heading"),
  body: text("body"), // newline-separated
  backgroundId: text("background_id"), // FK -> media.id, nullable (color/none)
  // Design carried over from an imported deck (or set by hand): the slide's
  // own background/text color. null = inherit the app theme.
  bgColor: text("bg_color"),
  textColor: text("text_color"),
  /** Colour/emphasis ranges over `body`. See sections.format. */
  format: text("format"),
  /** Per-slide alignment override; null = inherit the theme's. */
  textAlign: text("text_align"),
});

export const themes = sqliteTable("themes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  fontId: text("font_id"),
  fontSize: integer("font_size"), // null = auto-fit
  fontWeight: integer("font_weight").default(600),
  textColor: text("text_color").default("#FFFFFF"),
  textAlign: text("text_align").default("center"),
  textOutline: text("text_outline"), // JSON {color,width}
  backgroundId: text("background_id"),
  bgColor: text("bg_color").default("#000000"),
  overlayScrim: integer("overlay_scrim").default(0),
  displayMode: text("display_mode").default("fullscreen"), // fullscreen|lower_third|lower_third_bg
  maxLines: integer("max_lines").default(2),
  verticalPos: text("vertical_pos").default("center"),
  safeMargin: integer("safe_margin").default(6),
  transition: text("transition").default("fade"),
  transitionMs: integer("transition_ms").default(300),
});

export const fonts = sqliteTable("fonts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source").notNull(), // system|uploaded
  filePath: text("file_path"),
});

export const playlists = sqliteTable("playlists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  serviceDate: text("service_date"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const playlistItems = sqliteTable("playlist_items", {
  id: text("id").primaryKey(),
  playlistId: text("playlist_id").notNull(),
  itemType: text("item_type").notNull().default("song"), // song | scripture | blank | header
  songId: text("song_id"),
  arrangementId: text("arrangement_id"),
  // scripture items: version id + reference string (e.g. "John 3:16-18")
  scriptureRef: text("scripture_ref"),
  scriptureVersion: text("scripture_version"),
  // free label for headers / blank slides
  label: text("label"),
  themeOverride: text("theme_override"),
  bgOverride: text("bg_override"),
  orderIndex: integer("order_index").notNull().default(0),
});

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey().default("app"),
  config: text("config").notNull(), // JSON blob
});
