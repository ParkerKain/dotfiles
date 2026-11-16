import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, ScrollHandle } from "gpui-base";
import { appHome, checking, closeOverlay, exec, props, readTextFile, setShared, shared, theme } from "herdr";

const CURATOR = "https://music.apple.com/us/curator/lofi-girl/1568752863";
const CONFIG = "music.config";

function config(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.presets)) return null;
  return {version: 1, connected: value.connected === true, presets: value.presets.filter(p =>
    p && typeof p.key === "string" && typeof p.label === "string").map(p => ({
      key: p.key, label: p.label.slice(0, 100), title: String(p.title || p.label).slice(0, 200),
      url: typeof p.url === "string" && /^https:\/\/music\.apple\.com\//.test(p.url) ? p.url : null,
      id: /^[A-Fa-f0-9]{16}$/.test(p.id || "") ? p.id : null
    }))};
}

export default class Music extends View {
  init(_props, cx) {
    this.busy = false;
    this.reading = false;
    this.closed = false;
    this.generation = 0;
    this.error = "";
    this.note = "";
    this.state = null;
    this.ready = false;
    this.target = null;
    this.view = "player";
    this.playlists = [];
    this.selection = 0;
    this.requested = null;
    this.pendingChecks = 0;
    this.reconcile = false;
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.filter = InputState.new({placeholder: "Filter library playlists"});
    this.filter.on("change", (_e, cx) => { this.selection = 0; cx.notify(); });
    this.filter.on("submit", (_e, cx) => this.linkSelected(cx));
    if (checking()) return;
    this.handle.focus();
    cx.spawn(async cx => {
      try {
        if (!config(shared(CONFIG))) {
          const defaults = JSON.parse(await readTextFile(`${appHome()}/mods/music/presets.json`));
          setShared(CONFIG, {version: 1, connected: false, presets: defaults});
        }
        this.ready = true;
        if (this.settings().connected) this.refresh(cx);
      } catch (_) { this.error = "Could not load Music presets. Check the mod installation."; }
      cx.notify();
    });
    cx.timer.every(5000, cx => {
      if (this.ready && this.settings().connected && !this.error && !this.reconcile) this.refresh(cx);
    });
  }

  close() { this.closed = true; this.generation++; }
  settings() { return config(shared(CONFIG)) || {version: 1, connected: false, presets: []}; }
  save(update) { setShared(CONFIG, {...this.settings(), ...update}); }
  updateState(state) {
    this.state = state;
    setShared("music.playback", {playback: state?.playback || "stopped", at: Date.now()});
  }

  async request(action, value) {
    let result;
    try {
      result = await exec("/usr/bin/python3", [`${appHome()}/mods/music/music-control.py`, JSON.stringify({action, value})], {timeout: 28000});
    } catch (_) { throw {code: "bridge_error", message: "Music control did not finish. Refresh before retrying."}; }
    let reply;
    try { reply = JSON.parse(result.stdout); } catch (_) { throw {code: "bridge_error", message: "Music control could not finish. Open Music, then retry connection."}; }
    if (!reply.ok) throw reply.error;
    return reply;
  }

  failed(error) {
    this.error = error?.message || String(error);
    if (error?.code === "permission_denied") this.save({connected: false});
    if (["timeout", "busy", "bridge_error"].includes(error?.code)) this.reconcile = true;
  }

  refresh(cx) {
    if (checking() || this.closed || this.busy || this.reading || !this.settings().connected) return;
    this.reading = true;
    const generation = ++this.generation;
    cx.spawn(async cx => {
      try {
        const reply = await this.request("status");
        if (this.closed || generation !== this.generation) return;
        this.updateState(reply.state);
        this.error = "";
        this.reconcile = false;
        if (this.requested) {
          const confirmed = this.state?.playback === "playing" && this.state?.playlist?.id === this.requested.id;
          if (confirmed) { this.note = `Playing ${this.requested.label}`; this.requested = null; }
          else if (this.pendingChecks <= 0) {
            this.note = this.state?.playback === "playing" ? "Music is playing. Requested playlist could not be confirmed." : "Playback has not started. Open Music to check sign-in, subscription and library sync.";
            this.requested = null;
          } else { this.pendingChecks--; cx.timer.after(1500, cx => this.refresh(cx)); }
        }
      } catch (error) { if (!this.closed && generation === this.generation) this.failed(error); }
      finally { this.reading = false; if (!this.closed) cx.notify(); }
    });
  }

  act(action, value, cx, preset = null) {
    if (checking() || this.closed || this.busy || this.reading || (this.reconcile && action !== "connect")) return;
    if (action !== "connect" && !this.settings().connected) return;
    this.busy = true;
    this.error = "";
    this.note = "";
    this.generation++;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const reply = await this.request(action, value);
        if (this.closed) return;
        if (action === "connect") { this.save({connected: true}); this.reconcile = false; }
        if (reply.state) this.updateState(reply.state);
        if (preset) {
          this.view = "player";
          this.requested = preset;
          this.pendingChecks = 5;
          this.note = `Starting ${preset.label}…`;
        }
        if (action === "connect") this.note = "Connected to Music controls. Sign in inside Music, then use Change playlist to add your music.";
      } catch (error) { if (!this.closed) this.failed(error); }
      finally {
        this.busy = false;
        if (!this.closed) { cx.notify(); if (this.requested) this.refresh(cx); }
      }
    });
  }

  openMusic(url, cx) {
    if (checking()) return;
    if (url && !/^https:\/\/music\.apple\.com\//.test(url)) return;
    cx.spawn(async cx => {
      try {
        const reply = await exec("/usr/bin/open", ["-a", "/System/Applications/Music.app", ...(url ? [url] : [])], {timeout: 10000});
        if (reply.code) throw Error("Could not open Music.");
      } catch (error) { this.failed(error); if (!this.closed) cx.notify(); }
    });
  }

  choose(preset, cx) {
    if (checking() || this.busy || this.reading || !this.settings().connected || this.reconcile) return;
    this.target = preset;
    this.selection = 0;
    this.playlists = [];
    this.filter.set_value("");
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const reply = await this.request("list-playlists");
        if (!this.closed) {
          this.playlists = reply.playlists || [];
          this.note = this.playlists.length ? "Choose the playlist you added in Music." : "No library playlists found. Sign into Music and add a playlist, then Refresh.";
          this.filter.focus();
        }
      } catch (error) { if (!this.closed) this.failed(error); }
      finally { this.busy = false; if (!this.closed) cx.notify(); }
    });
  }

  visible() {
    const query = this.filter.value().trim().toLowerCase();
    return this.playlists.filter(p => p.name.toLowerCase().includes(query));
  }

  linkSelected(cx) {
    if (this.busy || !this.target) return;
    const row = this.visible()[this.selection];
    if (!row) return;
    const settings = this.settings();
    const exists = settings.presets.some(p => p.key === this.target.key);
    const linked = {...this.target, id: row.id, title: row.name};
    if (!exists) linked.label = row.name;
    this.save({presets: exists ? settings.presets.map(p => p.key === linked.key ? linked : p) : [...settings.presets, linked]});
    this.target = null;
    this.note = "Playlist linked. Select Play when you want to listen.";
    this.handle.focus();
    cx.notify();
  }

  changePreset(preset, direction, cx) {
    if (this.busy) return;
    const presets = this.settings().presets;
    const index = presets.findIndex(p => p.key === preset.key);
    if (direction === null) presets.splice(index, 1);
    else if (index + direction >= 0 && index + direction < presets.length)
      [presets[index], presets[index + direction]] = [presets[index + direction], presets[index]];
    this.save({presets});
    cx.notify();
  }

  render() {
    const t = theme(), settings = this.settings(), state = this.state;
    const working = this.busy || this.reading;
    const disabled = working || !settings.connected || this.reconcile;
    const player = !this.target && this.view === "player";
    const playing = state?.playback === "playing";
    const stopped = !state?.running || state?.playback === "stopped";
    const status = !state ? "Loading Music" : playing ? "Playing" : stopped ? "Stopped" : "Paused";
    const button = (id, label, fn, off = false, primary = false) => div().id(id).px(12).py(8).rounded(7)
      .bg(primary ? t.selected : t.raised).text_size(12).text_color(off ? t.dim : primary ? t.accent : t.foreground)
      .cursor_pointer().hover(s => s.bg(off ? t.raised : t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { if (!off) fn(cx); }).child(label);
    const text = (value, muted = false) => div().text_size(12).text_color(muted ? t.muted : t.foreground).child(value);
    const row = (...children) => h_flex().gap(7).items_center().children(children);
    const back = cx => { this.target = null; this.view = "player"; this.note = ""; this.handle.focus(); cx.notify(); };
    const list = this.visible();
    return v_flex().id("music-root").track_focus(this.handle).size_full().p(16).gap(12).bg(t.popover).text_color(t.foreground)
      .on_key_down((event, cx) => {
        if (event.key === "escape") {
          if (this.target) { this.target = null; this.handle.focus(); cx.notify(); }
          else if (this.view !== "player") back(cx);
          else closeOverlay(props().overlay);
          cx.stop_propagation();
        }
        if (this.target && ["up", "down"].includes(event.key)) {
          this.selection = Math.max(0, Math.min(list.length - 1, this.selection + (event.key === "up" ? -1 : 1)));
          this.scroll.scroll_to_item(this.selection); cx.notify(); cx.stop_propagation();
        }
      })
      .child(row(svg("mods/music/music.svg").size(17).text_color(t.accent),
        div().flex_1().text_size(16).child(this.target ? `Link ${this.target.label}` : player ? "Music" : "Change playlist"),
        button("music-close", "Close", () => closeOverlay(props().overlay))))
      .when(!settings.connected, el => el
        .child(text("Sign into Music with your Apple Music subscription."))
        .child(text("Connect lets Herdr control playback.", true))
        .child(row(button("music-open-setup", "Open Music", cx => this.openMusic(null, cx)),
          button("music-connect", "Connect to Music", cx => this.act("connect", null, cx), working, true))))
      .when(settings.connected && player, el => el
        .child(v_flex().gap(8).p(16).rounded(10).bg(t.surface)
          .child(row(svg(`mods/music/${playing ? "playing" : stopped ? "music" : "paused"}.svg`).size(18).text_color(playing ? t.accent : t.muted),
            div().text_size(11).text_color(playing ? t.accent : t.muted).child(status)))
          .child(div().text_size(21).child(state?.track?.name || "Choose something to listen to"))
          .child(text(state?.track?.artist || "Your Apple Music library", true))
          .when(Boolean(state?.playlist?.name), card => card.child(text(state.playlist.name, true))))
        .child(h_flex().justify_center().gap(8)
          .child(button("music-previous", "Previous", cx => this.act("previous", null, cx), disabled || !state?.track))
          .child(button("music-play", playing ? "Pause" : "Play", cx => {
            if (!playing && !state?.track) { this.view = "playlists"; this.note = "Choose a playlist to start listening."; cx.notify(); }
            else this.act(playing ? "pause" : "play", null, cx);
          }, disabled, true))
          .child(button("music-next", "Skip", cx => this.act("next", null, cx), disabled || !state?.track)))
        .child(h_flex().items_center().justify_between()
          .child(text(`Volume ${state?.volume ?? "?"}%`))
          .child(row(button("music-volume-down", "-", cx => this.act("set-volume", Math.max(0, (state?.volume ?? 0) - 5), cx), disabled || !state?.running),
            button("music-volume-up", "+", cx => this.act("set-volume", Math.min(100, (state?.volume ?? 0) + 5), cx), disabled || !state?.running))))
        .child(h_flex().items_center().justify_between()
          .child(button("music-stop", "Stop music", cx => this.act("stop", null, cx), disabled || stopped))
          .child(button("music-shuffle", state?.shuffle ? "Shuffle on" : "Shuffle off", cx => this.act("set-shuffle", !state?.shuffle, cx), disabled || !state?.running)))
        .child(div().flex_1().min_h(0))
        .child(row(button("music-change-playlist", "Change playlist", cx => { this.view = "playlists"; this.note = ""; cx.notify(); }, working),
          button("music-refresh", "Refresh", cx => this.refresh(cx), working))))
      .when(Boolean(this.error), el => el.child(text(this.error)).child(row(
        button("music-retry", "Retry connection", cx => this.act("connect", null, cx), working),
        button("music-open-error", "Open Music", cx => this.openMusic(null, cx)))))
      .when(Boolean(this.note), el => el.child(text(this.note, true)))
      .when(Boolean(this.target), el => el
        .child(row(div().flex_1().child(Input.new(this.filter)), button("music-reload-library", "Refresh", cx => this.choose(this.target, cx), working)))
        .child(div().id("music-library").flex_1().min_h(0).overflow_y_scroll().track_scroll(this.scroll).children(list.map((p, i) =>
          div().id(`music-library-${p.id}`).p(8).rounded(4).bg(i === this.selection ? t.selected : t.popover).text_size(12)
            .child(`${p.name} · ${p.id.slice(-4)}`).on_click((_e, cx) => { this.selection = i; this.linkSelected(cx); }))))
        .child(row(button("music-link-back", "Back", cx => { this.target = null; this.handle.focus(); cx.notify(); }),
          button("music-link-selected", "Link selected", cx => this.linkSelected(cx), working || !list.length, true))))
      .when(!this.target && !player, el => el
        .child(text("Choose a playlist to replace Music's current queue.", true))
        .child(div().id("music-presets").flex_1().min_h(0).overflow_y_scroll().children(settings.presets.map(p =>
          v_flex().id(`music-preset-${p.key}`).gap(5).py(7)
            .child(row(div().flex_1().text_size(13).child(p.label),
              button(`music-start-${p.key}`, "Play", cx => this.act("play-playlist", p.id, cx, p), disabled || !p.id, true),
              button(`music-link-${p.key}`, p.id ? "Relink" : "Link", cx => this.choose(p, cx), disabled)))
            .child(row(...(p.url ? [button(`music-url-${p.key}`, "Open in Music", cx => this.openMusic(p.url, cx))] : []),
              button(`music-up-${p.key}`, "↑", cx => this.changePreset(p, -1, cx), working),
              button(`music-down-${p.key}`, "↓", cx => this.changePreset(p, 1, cx), working),
              button(`music-remove-${p.key}`, "Remove", cx => this.changePreset(p, null, cx), working))))))
        .child(row(button("music-add", "Add playlist", cx => this.choose({key: `custom-${Date.now()}`, label: "playlist"}, cx), disabled),
          button("music-curator", "Browse Lofi Girl", cx => this.openMusic(CURATOR, cx))))
        .child(button("music-back-player", "Back to player", back)));
  }
}
