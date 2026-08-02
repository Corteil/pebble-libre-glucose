#include <pebble.h>

// Number of history points shown on the graph (15 min apart = 12 hours)
#define GRAPH_POINTS 48

#define PERSIST_KEY_STATE 1
#define STATE_VERSION 2

// Status codes sent by the phone-side JS
enum {
  STATUS_OK = 0,
  STATUS_NO_CONFIG = 1,
  STATUS_LOGIN_FAILED = 2,
  STATUS_NETWORK_ERROR = 3,
  STATUS_NO_CONNECTION = 4,
  STATUS_ACCEPT_TERMS = 5,
};

// A reading older than this is considered stale and drawn dimmed
#define STALE_SECONDS (15 * 60)

typedef struct __attribute__((packed)) {
  uint8_t version;
  int16_t mgdl;          // current reading, mg/dL (0 = none)
  int16_t delta_mgdl;    // change since previous reading
  int8_t trend;          // 1..5 (falling fast .. rising fast)
  uint8_t units_mmol;    // 0 = mg/dL, 1 = mmol/L
  uint8_t status;
  uint8_t alert_low;
  uint8_t alert_high;
  uint8_t theme_light;   // 0 = dark (default), 1 = light
  uint16_t low_mgdl;     // low threshold
  uint16_t high_mgdl;    // high threshold
  int32_t reading_ts;    // epoch of current reading
  int32_t graph_start;   // epoch of graph[0]
  int32_t graph_interval;
  uint8_t graph[GRAPH_POINTS]; // mg/dL / 2, 0 = no data
} State;

static State s_state;

static Window *s_window;
static TextLayer *s_time_layer;
static TextLayer *s_date_layer;
static TextLayer *s_glucose_layer;
static TextLayer *s_info_layer;
static Layer *s_trend_layer;
static Layer *s_graph_layer;

static char s_time_buf[8];
static char s_date_buf[16];
static char s_glucose_buf[8];
static char s_info_buf[40];

static GColor theme_bg(void) {
  return s_state.theme_light ? GColorWhite : GColorBlack;
}

static GColor theme_fg(void) {
  return s_state.theme_light ? GColorBlack : GColorWhite;
}

// Dimmed foreground for stale/missing data
static GColor theme_dim(void) {
#if defined(PBL_COLOR)
  return s_state.theme_light ? GColorDarkGray : GColorLightGray;
#else
  return theme_fg();
#endif
}

// Threshold guide lines on the graph
static GColor theme_guide(void) {
#if defined(PBL_COLOR)
  return s_state.theme_light ? GColorLightGray : GColorDarkGray;
#else
  return theme_fg();
#endif
}

static GColor glucose_color(int mgdl) {
#if defined(PBL_COLOR)
  if (mgdl <= 0) {
    return theme_dim();
  }
  // Light theme needs darker shades to stay readable on white
  if (mgdl < s_state.low_mgdl) {
    return s_state.theme_light ? GColorDarkCandyAppleRed : GColorRed;
  }
  if (mgdl > s_state.high_mgdl) {
    return s_state.theme_light ? GColorWindsorTan : GColorChromeYellow;
  }
  return s_state.theme_light ? GColorIslamicGreen : GColorGreen;
#else
  (void)mgdl;
  return theme_fg();
#endif
}

static bool reading_is_stale(void) {
  return s_state.reading_ts == 0 ||
         (time(NULL) - s_state.reading_ts) > STALE_SECONDS;
}

// Format a glucose value in the configured units into buf
static void format_glucose(char *buf, size_t len, int mgdl) {
  if (mgdl <= 0) {
    snprintf(buf, len, "--");
    return;
  }
  if (s_state.units_mmol) {
    int tenths = (mgdl * 10 + 9) / 18; // mmol/L * 10, rounded
    snprintf(buf, len, "%d.%d", tenths / 10, tenths % 10);
  } else {
    snprintf(buf, len, "%d", mgdl);
  }
}

static void format_delta(char *buf, size_t len, int delta) {
  if (s_state.units_mmol) {
    int tenths = (delta * 10 + (delta >= 0 ? 9 : -9)) / 18;
    snprintf(buf, len, "%s%d.%d", tenths < 0 ? "-" : "+",
             abs(tenths) / 10, abs(tenths) % 10);
  } else {
    snprintf(buf, len, "%+d", delta);
  }
}

static void update_info_text(void) {
  switch (s_state.status) {
    case STATUS_NO_CONFIG:
      snprintf(s_info_buf, sizeof(s_info_buf), "Set up in app settings");
      break;
    case STATUS_LOGIN_FAILED:
      snprintf(s_info_buf, sizeof(s_info_buf), "LibreLinkUp login failed");
      break;
    case STATUS_NETWORK_ERROR:
      snprintf(s_info_buf, sizeof(s_info_buf), "No connection to Libre");
      break;
    case STATUS_NO_CONNECTION:
      snprintf(s_info_buf, sizeof(s_info_buf), "No sharing connection");
      break;
    case STATUS_ACCEPT_TERMS:
      snprintf(s_info_buf, sizeof(s_info_buf), "Accept terms in LinkUp app");
      break;
    default:
      if (s_state.reading_ts == 0) {
        snprintf(s_info_buf, sizeof(s_info_buf), "Waiting for data...");
      } else {
        char delta_buf[8];
        format_delta(delta_buf, sizeof(delta_buf), s_state.delta_mgdl);
        int age_min = (time(NULL) - s_state.reading_ts) / 60;
        if (age_min < 0) {
          age_min = 0;
        }
        if (age_min > 99) {
          snprintf(s_info_buf, sizeof(s_info_buf), "%s  old data", delta_buf);
        } else {
          snprintf(s_info_buf, sizeof(s_info_buf), "%s  %dm ago", delta_buf,
                   age_min);
        }
      }
      break;
  }
  text_layer_set_text(s_info_layer, s_info_buf);
}

// Repaint everything whose color depends on the theme. Safe to call any
// time after window_load; glucose/trend/graph colors are handled by
// update_glucose_ui and the layer update procs.
static void apply_theme(void) {
  window_set_background_color(s_window, theme_bg());
  text_layer_set_text_color(s_time_layer, theme_fg());
  text_layer_set_text_color(s_date_layer, theme_fg());
  text_layer_set_text_color(s_info_layer, theme_fg());
}

static void update_glucose_ui(void) {
  format_glucose(s_glucose_buf, sizeof(s_glucose_buf), s_state.mgdl);
  text_layer_set_text(s_glucose_layer, s_glucose_buf);
  text_layer_set_text_color(
      s_glucose_layer,
      reading_is_stale() ? theme_dim() : glucose_color(s_state.mgdl));
  layer_mark_dirty(s_trend_layer);
  layer_mark_dirty(s_graph_layer);
  update_info_text();
}

static void update_time(void) {
  time_t now = time(NULL);
  struct tm *t = localtime(&now);
  strftime(s_time_buf, sizeof(s_time_buf),
           clock_is_24h_style() ? "%H:%M" : "%I:%M", t);
  // Strip a leading zero in 12h mode
  if (!clock_is_24h_style() && s_time_buf[0] == '0') {
    memmove(s_time_buf, s_time_buf + 1, strlen(s_time_buf));
  }
  text_layer_set_text(s_time_layer, s_time_buf);
  strftime(s_date_buf, sizeof(s_date_buf), "%a %e %b", t);
  text_layer_set_text(s_date_layer, s_date_buf);
}

// --- Trend arrow ---------------------------------------------------------

static void trend_update_proc(Layer *layer, GContext *ctx) {
  int t = s_state.trend;
  if (s_state.mgdl <= 0 || t < 1 || t > 5) {
    return;
  }
  GRect b = layer_get_bounds(layer);
  GPoint c = GPoint(b.size.w / 2, b.size.h / 2);

  // Direction vectors indexed by trend value 1..5
  static const int8_t dx[6] = {0, 0, 1, 1, 1, 0};
  static const int8_t dy[6] = {0, 1, 1, 0, -1, -1};
  // Normalise diagonal length a little (10 straight, 8 diagonal)
  int len = (dx[t] && dy[t]) ? 7 : 9;

  GPoint tail = GPoint(c.x - dx[t] * len, c.y - dy[t] * len);
  GPoint tip = GPoint(c.x + dx[t] * len, c.y + dy[t] * len);

  GColor color =
      reading_is_stale() ? theme_dim() : glucose_color(s_state.mgdl);
  graphics_context_set_stroke_color(ctx, color);
  graphics_context_set_stroke_width(ctx, 3);
  graphics_draw_line(ctx, tail, tip);

  // Arrow head: two strokes at 45 degrees back from the tip
  int h = 5;
  // Perpendicular vector
  int px = -dy[t], py = dx[t];
  GPoint h1 = GPoint(tip.x - dx[t] * h + px * h, tip.y - dy[t] * h + py * h);
  GPoint h2 = GPoint(tip.x - dx[t] * h - px * h, tip.y - dy[t] * h - py * h);
  graphics_draw_line(ctx, tip, h1);
  graphics_draw_line(ctx, tip, h2);
}

// --- Graph ---------------------------------------------------------------

static int graph_display_max(void) {
  int max_mgdl = 220;
  for (int i = 0; i < GRAPH_POINTS; i++) {
    int v = s_state.graph[i] * 2;
    if (v + 20 > max_mgdl) {
      max_mgdl = v + 20;
    }
  }
  if (max_mgdl > 400) {
    max_mgdl = 400;
  }
  return max_mgdl;
}

static int16_t mgdl_to_y(int mgdl, int display_max, GRect b) {
  const int display_min = 40;
  if (mgdl < display_min) {
    mgdl = display_min;
  }
  if (mgdl > display_max) {
    mgdl = display_max;
  }
  return b.size.h - 1 -
         ((mgdl - display_min) * (b.size.h - 1) / (display_max - display_min));
}

static void draw_dashed_hline(GContext *ctx, int y, GRect b) {
  for (int x = 0; x < b.size.w; x += 5) {
    graphics_draw_line(ctx, GPoint(x, y), GPoint(x + 2, y));
  }
}

static void graph_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  int display_max = graph_display_max();

  // Threshold guide lines
  graphics_context_set_stroke_width(ctx, 1);
  graphics_context_set_stroke_color(ctx, theme_guide());
  draw_dashed_hline(ctx, mgdl_to_y(s_state.low_mgdl, display_max, b), b);
  draw_dashed_hline(ctx, mgdl_to_y(s_state.high_mgdl, display_max, b), b);

  // Data points, joined where consecutive
  int prev_x = -1, prev_y = 0;
  bool prev_valid = false;
  for (int i = 0; i < GRAPH_POINTS; i++) {
    int mgdl = s_state.graph[i] * 2;
    if (mgdl <= 0) {
      prev_valid = false;
      continue;
    }
    int x = (b.size.w - 1) * i / (GRAPH_POINTS - 1);
    int y = mgdl_to_y(mgdl, display_max, b);
    graphics_context_set_stroke_color(ctx, glucose_color(mgdl));
    graphics_context_set_fill_color(ctx, glucose_color(mgdl));
    if (prev_valid) {
      graphics_context_set_stroke_width(ctx, 1);
      graphics_draw_line(ctx, GPoint(prev_x, prev_y), GPoint(x, y));
    }
    graphics_fill_rect(ctx, GRect(x - 1, y - 1, 2, 2), 0, GCornerNone);
    prev_x = x;
    prev_y = y;
    prev_valid = true;
  }
}

// --- Messaging -----------------------------------------------------------

static void maybe_alert(int prev_mgdl) {
  if (s_state.mgdl <= 0 || prev_mgdl == s_state.mgdl) {
    return;
  }
  if (s_state.alert_low && s_state.mgdl < s_state.low_mgdl &&
      (prev_mgdl <= 0 || prev_mgdl >= (int)s_state.low_mgdl)) {
    vibes_double_pulse();
  } else if (s_state.alert_high && s_state.mgdl > s_state.high_mgdl &&
             prev_mgdl > 0 && prev_mgdl <= (int)s_state.high_mgdl) {
    vibes_short_pulse();
  }
}

static void inbox_received_handler(DictionaryIterator *iter, void *context) {
  int prev_mgdl = s_state.mgdl;
  Tuple *t;

  if ((t = dict_find(iter, MESSAGE_KEY_STATUS))) {
    s_state.status = t->value->int32;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_GLUCOSE_MGDL))) {
    s_state.mgdl = t->value->int32;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_TREND))) {
    s_state.trend = t->value->int32;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_DELTA_MGDL))) {
    s_state.delta_mgdl = t->value->int32;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_READING_TS))) {
    s_state.reading_ts = t->value->int32;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_UNITS_MMOL))) {
    s_state.units_mmol = t->value->int32 ? 1 : 0;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_LOW_MGDL))) {
    s_state.low_mgdl = t->value->int32;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_HIGH_MGDL))) {
    s_state.high_mgdl = t->value->int32;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_ALERT_LOW))) {
    s_state.alert_low = t->value->int32 ? 1 : 0;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_ALERT_HIGH))) {
    s_state.alert_high = t->value->int32 ? 1 : 0;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_THEME_LIGHT))) {
    s_state.theme_light = t->value->int32 ? 1 : 0;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_GRAPH_START_TS))) {
    s_state.graph_start = t->value->int32;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_GRAPH_INTERVAL))) {
    s_state.graph_interval = t->value->int32;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_GRAPH_DATA))) {
    memset(s_state.graph, 0, sizeof(s_state.graph));
    uint16_t n = t->length;
    if (n > GRAPH_POINTS) {
      n = GRAPH_POINTS;
    }
    memcpy(s_state.graph, t->value->data, n);
  }

  s_state.version = STATE_VERSION;
  persist_write_data(PERSIST_KEY_STATE, &s_state, sizeof(s_state));
  apply_theme();
  update_glucose_ui();
  maybe_alert(prev_mgdl);
}

// --- Window --------------------------------------------------------------

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  update_time();
  update_info_text();
  // Redraw glucose dimming/graph position once data crosses staleness
  layer_mark_dirty(s_graph_layer);
  layer_mark_dirty(s_trend_layer);
}

static TextLayer *make_text_layer(GRect frame, const char *font_key,
                                  GTextAlignment align) {
  TextLayer *layer = text_layer_create(frame);
  text_layer_set_background_color(layer, GColorClear);
  text_layer_set_text_color(layer, GColorWhite);
  text_layer_set_font(layer, fonts_get_system_font(font_key));
  text_layer_set_text_alignment(layer, align);
  return layer;
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  const int w = bounds.size.w;

  const int y_time = PBL_IF_ROUND_ELSE(4, -6);
  const int y_date = PBL_IF_ROUND_ELSE(50, 38);
  const int y_gluc = PBL_IF_ROUND_ELSE(68, 56);
  const int y_info = PBL_IF_ROUND_ELSE(110, 98);
  const int y_graph = PBL_IF_ROUND_ELSE(130, 118);
  const int graph_inset = PBL_IF_ROUND_ELSE(26, 2);

  s_time_layer = make_text_layer(GRect(0, y_time, w, 46),
                                 FONT_KEY_BITHAM_42_BOLD, GTextAlignmentCenter);
  s_date_layer = make_text_layer(GRect(0, y_date, w, 20), FONT_KEY_GOTHIC_18,
                                 GTextAlignmentCenter);
  s_glucose_layer =
      make_text_layer(GRect(0, y_gluc, w / 2 + 30, 40),
                      FONT_KEY_BITHAM_34_MEDIUM_NUMBERS, GTextAlignmentRight);
  s_trend_layer = layer_create(GRect(w / 2 + 34, y_gluc + 6, 30, 30));
  layer_set_update_proc(s_trend_layer, trend_update_proc);
  s_info_layer = make_text_layer(GRect(0, y_info, w, 20), FONT_KEY_GOTHIC_18,
                                 GTextAlignmentCenter);
  s_graph_layer = layer_create(GRect(graph_inset, y_graph, w - graph_inset * 2,
                                     bounds.size.h - y_graph - 2));
  layer_set_update_proc(s_graph_layer, graph_update_proc);

  layer_add_child(root, text_layer_get_layer(s_time_layer));
  layer_add_child(root, text_layer_get_layer(s_date_layer));
  layer_add_child(root, text_layer_get_layer(s_glucose_layer));
  layer_add_child(root, s_trend_layer);
  layer_add_child(root, text_layer_get_layer(s_info_layer));
  layer_add_child(root, s_graph_layer);

  apply_theme();
  update_time();
  update_glucose_ui();
}

static void window_unload(Window *window) {
  text_layer_destroy(s_time_layer);
  text_layer_destroy(s_date_layer);
  text_layer_destroy(s_glucose_layer);
  text_layer_destroy(s_info_layer);
  layer_destroy(s_trend_layer);
  layer_destroy(s_graph_layer);
}

static void load_state(void) {
  // Sensible defaults until the phone sends real settings
  memset(&s_state, 0, sizeof(s_state));
  s_state.units_mmol = 1;
  s_state.low_mgdl = 72;   // 4.0 mmol/L
  s_state.high_mgdl = 180; // 10.0 mmol/L
  s_state.trend = 0;

  if (persist_exists(PERSIST_KEY_STATE)) {
    State stored;
    int read = persist_read_data(PERSIST_KEY_STATE, &stored, sizeof(stored));
    if (read == (int)sizeof(stored) && stored.version == STATE_VERSION) {
      s_state = stored;
    }
  }
}

static void init(void) {
  load_state();

  s_window = window_create();
  window_set_background_color(s_window, theme_bg());
  window_set_window_handlers(s_window, (WindowHandlers){
                                           .load = window_load,
                                           .unload = window_unload,
                                       });
  window_stack_push(s_window, true);

  tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);

  app_message_register_inbox_received(inbox_received_handler);
  app_message_open(512, 64);
}

static void deinit(void) {
  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
