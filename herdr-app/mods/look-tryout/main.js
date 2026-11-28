// look-tryout: steps through candidate themes, terminal fonts, UI fonts and wallpapers, applies
// each one live to the whole window, and records a yes or no for each. Esc puts the original look
// back. Enter keeps what's showing, and writes it to settings.base.json so a relink keeps it.
//
// In the Frosted layout a theme also re-tints the glass (frost --relayout --theme), and the
// Wallpaper round swaps the image behind it (frost <image> --theme). Elsewhere that round is off,
// because switching layouts would close this window.
//
// Opened from the palette (mod.open) it arrives as a dimmed dialog, which would hide the look
// being judged, so it reopens itself as an undimmed, draggable window and closes the dialog.
import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  appHome, checking, closeOverlay, exec, fonts, openOverlay, props, readTextFile, run,
  layouts, nextCommand, setShared, settings, shared, theme, themes, writeTextFile,
} from "herdr";

const THEMES = [
  ["jade-temple", "Balanced. Green-black ground, ivory text, true jade accent."],
  ["emerald-night", "Cool and punchy. Blue-black ground, vivid emerald, electric syntax."],
  ["celadon", "Soft porcelain. Low saturation, pale celadon accent, pastel syntax."],
  ["malachite", "High contrast. Near-black ground, bright text, malachite and gold."],
  ["jade-brass", "Warm. Olive-espresso ground, jade with brass and copper."],
  ["everforest-dark", "Existing theme, for comparison. Muted forest green."],
  ["terafox", "Existing theme, for comparison. Teal-green Nightfox variant."],
];

const CODE_FONTS = [
  ["JetBrains Mono", "Your current terminal font. Tall, plain, ligatures."],
  ["Geist Mono", "Vercel's mono. Clean and geometric, a little wide."],
  ["Monaspace Neon", "GitHub's neo-grotesque mono. Texture healing evens spacing."],
  ["Monaspace Argon", "Monaspace's humanist cut. Softer and friendlier."],
  ["Monaspace Xenon", "Monaspace's slab serif. Typewriter feel."],
  ["Monaspace Krypton", "Monaspace's mechanical cut. Technical and squared off."],
  ["Monaspace Radon", "Monaspace's handwritten cut. Loose and informal."],
  ["CommitMono", "Neutral and quiet, designed to disappear."],
  ["Maple Mono", "Rounded corners, cursive italics, warm."],
  ["IBM Plex Mono", "IBM's corporate mono. Slab details, very legible."],
  ["Fira Code", "Mozilla's mono with the classic ligature set."],
  ["Victor Mono", "Narrow and light, with a script italic."],
  ["Cascadia Code", "Microsoft's terminal font. Friendly, ligatures."],
  ["Iosevka Nerd Font Mono", "Narrow and dense. Your Ghostty font."],
  ["Hack", "Workhorse based on Bitstream Vera. No frills."],
  ["Source Code Pro", "Adobe's mono. Light and open."],
  ["Inconsolata", "Compact humanist mono, Consolas-like."],
  ["Intel One Mono", "Built for low-vision legibility. Big distinct glyphs."],
  ["Martian Mono", "Wide, geometric, a bit techno."],
  ["0xProto", "Highly distinct glyphs, no ambiguous characters."],
  ["Lilex", "IBM Plex-like with ligatures."],
  ["Atkinson Hyperlegible Mono", "Braille Institute's legibility-first mono."],
  ["Zed Mono", "Zed editor's Iosevka build. Narrow and tidy."],
  ["Mona Sans Mono", "GitHub's Mona Sans in mono form."],
];

const UI_FONTS = [
  ["Iosevka Nerd Font", "Your current UI font. Narrow, technical."],
  ["Geist", "Vercel's sans. Crisp and modern (Herdr's default)."],
  ["Inter", "The standard UI sans. Neutral and very readable."],
  ["IBM Plex Sans", "IBM's sans. A touch of character."],
  ["Iosevka Aile", "Iosevka's quasi-proportional cut. Matches Iosevka terminals."],
  ["Mona Sans", "GitHub's sans. Geometric and friendly."],
  ["Hubot Sans", "GitHub's display sans. Squarish, techy."],
  ["Geist Mono", "A mono UI, for a fully terminal look."],
  ["IBM Plex Mono", "A mono UI with slab details."],
];

// Wallpapers: the generated jade set (herdr-app/wallpapers/jade.py), then the green ones already
// in the collection. Thumbnails and paths come from the Wallpaper picker's index (frost --thumbs).
const WALLPAPER_NOTES = {
  "jade aurora": "Generated. Jade curtains of light over a dark ground.",
  "emerald mesh": "Generated. Smooth emerald-to-teal mesh gradient.",
  "malachite bands": "Generated. Cut malachite banding.",
  "jade topo": "Generated. Jade contour lines on near-black.",
  "misty ridges": "Generated. Layered green ridges with mist.",
  "celadon glaze": "Generated. Crackled celadon glaze.",
  "deep forest light": "Generated. Sun shafts through a dark canopy.",
  "a green mountains with pink and blue sky": "From your digital set. Green hills, pastel sky.",
  "rousseau waterfall": "From your art set. Rousseau, The Waterfall.",
  "rousseau the dream": "From your art set. Rousseau, The Dream.",
  "vallotton evening andelys": "From your art set. Vallotton, evening at Les Andelys.",
};

const ROUNDS = [
  { key: "theme", title: "Themes" },
  { key: "font", title: "Code font" },
  { key: "ui_font", title: "UI font" },
  { key: "wallpaper", title: "Wallpaper" },
];

const CODE = [
  [["kw", "def "], ["fn", "jade_score"], ["fg", "(items: "], ["ty", "list"], ["fg", "[Item]) -> "], ["ty", "float"], ["fg", ":"]],
  [["cm", "    # 0O il1| {} => != -> ~ ;"]],
  [["fg", "    total = "], ["fn", "sum"], ["fg", "(i.weight "], ["kw", "for "], ["fg", "i "], ["kw", "in "], ["fg", "items)"]],
  [["kw", "    return "], ["fg", "total / "], ["num", "3.14"], ["kw", " if "], ["fg", "items "], ["kw", "else "], ["str", "\"empty\""]],
];
// Which ANSI color each token kind takes, as most terminal themes map syntax.
const TOKEN_ANSI = { kw: 5, fn: 4, ty: 6, str: 2, num: 3, cm: 8 };

const KEYS = {
  y: "yes", n: "no", right: "next", l: "next", j: "next", down: "next",
  left: "prev", h: "prev", k: "prev", up: "prev", tab: "next-round", "shift-tab": "prev-round",
  b: "blur", space: "preview", enter: "keep", escape: "restore", q: "restore",
};

export default class LookTryout extends View {
  init(_props, cx) {
    if (!props()?.window && !checking()) {
      // Already open (its heartbeat is fresh): focus that window instead of replacing it, which
      // would start a restore under the new copy while it records the tryout look as the original.
      const open = shared("look-tryout.open");
      if (typeof open === "number" && Date.now() - open < 45000) run("look-tryout.focus");
      else openOverlay({ mod: "look-tryout", props: { window: true }, kind: "window", key: "look-tryout", width: 500, height: 460 });
      closeOverlay(props().overlay);
      this.bounce = true;
      return;
    }
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.layout = shared("layout");
    this.frosted = this.layout === "Frosted";
    const have = new Set(fonts());
    const themeNames = new Set(themes().map(t => t.name));
    this.lists = {
      theme: THEMES.filter(([n]) => themeNames.has(n)),
      font: CODE_FONTS.filter(([n]) => have.has(n)),
      ui_font: UI_FONTS.filter(([n]) => have.has(n)),
      wallpaper: [],
    };
    this.thumbs = {};
    // settings() names the shown look's values (font_family, theme_dark). The fonts are re-read from
    // settings.json below, since that's the file the tryout writes and restores.
    const s = settings();
    this.original = { theme: s.theme_dark ?? s.theme, font: s.font_family, ui_font: s.ui_font_family, wallpaper: null };
    this.current = { ...this.original };
    this.blur = 0;
    this.originalBlur = 0;
    this.glassTheme = null; // the theme Frosted's glass was tinted with when the tryout opened
    this.round = 0;
    this.pos = { theme: 0, font: 0, ui_font: 0, wallpaper: 0 };
    this.verdicts = { theme: {}, font: {}, ui_font: {}, wallpaper: {} };
    this.done = false; // kept or restored: close() has nothing left to do
    this.busy = 0;
    this.status = "";
    this.queue = Promise.resolve();
    this.dataDir = `${appHome()}/data/look-tryout`;
    if (checking()) return;
    setShared("look-tryout.open", Date.now());
    cx.timer.every(20000, () => { if (!this.done) setShared("look-tryout.open", Date.now()); });
    // The same actions as the keys, as `look-tryout.<action>` commands (keys.json or herdr-app do).
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        this.command(c, cx);
      }
    });
    cx.spawn(async cx => {
      try {
        // settings.json links into dotfiles on the Mac. helper.py writes the real file in place.
        const real = async p => (await exec("readlink", ["-f", p])).stdout.trim();
        this.settingsPath = (await real(`${appHome()}/settings.json`)) || `${appHome()}/settings.json`;
        const file = JSON.parse((await readTextFile(this.settingsPath)) || "{}");
        for (const k of ["font", "ui_font"]) if (file[k]) this.original[k] = this.current[k] = file[k];
        // frost and settings.base.json sit two folders above this mod's real folder (herdr-app/mods/look-tryout).
        this.modDir = await real(`${appHome()}/mods/look-tryout`);
        const herdrApp = this.modDir ? this.modDir.replace(/\/mods\/look-tryout$/, "") : null;
        this.frost = herdrApp ? `${herdrApp}/frost` : null;
        this.basePath = herdrApp ? `${herdrApp}/settings.base.json` : null;

        const thumbs = `${appHome()}/mods/wallpaper-thumbs`;
        const index = JSON.parse((await readTextFile(`${thumbs}/index.json`)) || "[]");
        const picks = index.filter(w => w.group === "jade").concat(index.filter(w => w.group !== "jade" && WALLPAPER_NOTES[w.name]));
        this.lists.wallpaper = picks.map(w => [w.name, WALLPAPER_NOTES[w.name] ?? "", w.path]);
        for (const w of picks) this.thumbs[w.name] = w.thumb;
        const cur = JSON.parse((await readTextFile(`${thumbs}/current.json`)) || "null");
        if (cur) {
          this.blur = this.originalBlur = cur.blur ?? 0;
          this.glassTheme = cur.theme ?? null;
          const at = index.find(w => w.path === cur.path);
          this.original.wallpaper = this.current.wallpaper = at ? at.name : null;
          this.originalWallpaperPath = cur.path;
        }

        await exec("mkdir", ["-p", this.dataDir]);
        const saved = JSON.parse((await readTextFile(`${this.dataDir}/verdicts.json`)) || "null");
        if (saved?.verdicts) for (const k of Object.keys(this.verdicts)) this.verdicts[k] = { ...saved.verdicts[k] };
        // Start each round at its first undecided candidate.
        for (const { key } of ROUNDS) this.pos[key] = Math.max(0, this.lists[key].findIndex(([n]) => !this.verdicts[key][n]));
        this.show(cx);
      } catch (e) {
        this.status = `Could not start: ${e?.message ?? e}`;
        cx.notify();
      }
    });
  }

  get key() { return ROUNDS[this.round].key; }
  get item() { return this.lists[this.key][this.pos[this.key]]; }
  get wallpaperOff() { return this.key === "wallpaper" && !this.frosted; }

  // Applies the shown candidate of the current round to the window. A wallpaper takes seconds to
  // render, so entering that round (Tab, or finishing UI fonts) only shows its thumbnail. Browsing,
  // voting or Space renders it.
  show(cx, render = false) {
    const k = this.key, item = this.item;
    const wait = k === "wallpaper" && !render;
    if (item && !wait && !this.wallpaperOff && this.current[k] !== item[0]) this.apply(k, item, cx);
    cx.notify();
  }

  apply(k, item, cx) {
    const name = item[0];
    this.current[k] = name;
    if (k === "theme") {
      run("app.theme", { name });
      if (this.frosted) this.enqueue(cx, () => this.frostRun(["--relayout", "--theme", name]), "theme");
    } else if (k === "wallpaper" && !list.length) {
      body = div().text_size(12).text_color(t.muted)
        .child("No wallpaper thumbnails yet. Run ~/dotfiles/herdr-app/wallpapers/jade.py, then ~/dotfiles/herdr-app/frost --thumbs.");
    } else if (k === "wallpaper") {
      this.enqueue(cx, () => this.frostWallpaper(item[2], this.blur, this.current.theme), "wallpaper");
    } else {
      this.enqueue(cx, () => this.helper("patch", this.settingsPath, JSON.stringify({ [k]: name })));
    }
  }

  // Everything that writes runs one job at a time. A job tagged with a slot is skipped when a newer
  // job for the same slot is already waiting, so arrowing fast only renders the last wallpaper.
  // Once the tryout is kept or restored, jobs still waiting are dropped, so none lands after the restore.
  enqueue(cx, job, slot) {
    const ticket = slot ? (this[`ticket_${slot}`] = (this[`ticket_${slot}`] ?? 0) + 1) : 0;
    this.busy++;
    cx.notify();
    const p = this.queue.then(async () => {
      if (this.done || (slot && ticket !== this[`ticket_${slot}`])) return;
      await job();
    }).catch(e => { this.status = String(e?.message ?? e).split("\n").pop(); });
    this.queue = p;
    cx.spawn(async cx => { await p; this.busy--; cx.notify(); });
    return p;
  }

  async frostRun(args) {
    if (!this.frost) throw new Error("frost not found next to this mod");
    const r = await exec(this.frost, args, { timeout: 120000 });
    if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || `frost exited ${r.code}`);
  }

  frostWallpaper(path, blur, themeName) {
    return this.frostRun([path, "--blur", String(blur), "--theme", themeName || "none"]);
  }

  async helper(...args) {
    if (!this.modDir) throw new Error("look-tryout's folder wasn't found");
    const r = await exec("python3", [`${this.modDir}/helper.py`, ...args], { timeout: 180000 });
    if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || `helper.py exited ${r.code}`);
  }

  saveVerdicts(cx) {
    const text = JSON.stringify({ updated: new Date().toISOString(), verdicts: this.verdicts }, null, 2) + "\n";
    const path = `${this.dataDir}/verdicts.json`;
    // Its own chain: a verdict must land even when the tryout ends right after it.
    this.verdictWrites = (this.verdictWrites ?? Promise.resolve())
      .then(async () => writeTextFile(path, text, await readTextFile(path)))
      .catch(e => { this.status = `Could not save verdicts: ${e?.message ?? e}`; cx.notify(); });
  }

  move(by, cx) {
    const list = this.lists[this.key];
    if (!list.length) return;
    this.pos[this.key] = (this.pos[this.key] + by + list.length) % list.length;
    this.status = "";
    this.show(cx, true);
  }

  setRound(i, cx) {
    this.round = (i + ROUNDS.length) % ROUNDS.length;
    this.status = "";
    if (this.key === "font" || this.key === "ui_font") this.refreshFonts();
    this.show(cx);
  }

  // Herdr reads the machine's fonts at start and again on a look change, so fonts installed while
  // it ran appear after the Themes round has applied one. Re-read the list on entering a font round.
  refreshFonts() {
    const have = new Set(fonts());
    for (const [k, all] of [["font", CODE_FONTS], ["ui_font", UI_FONTS]]) {
      const shown = this.lists[k][this.pos[k]]?.[0];
      this.lists[k] = all.filter(([n]) => have.has(n));
      const at = this.lists[k].findIndex(([n]) => n === shown);
      this.pos[k] = at >= 0 ? at : Math.max(0, this.lists[k].findIndex(([n]) => !this.verdicts[k][n]));
    }
  }

  vote(v, cx) {
    const item = this.item;
    if (!item || this.wallpaperOff) return;
    this.verdicts[this.key][item[0]] = v;
    this.saveVerdicts(cx);
    const list = this.lists[this.key];
    const next = list.findIndex(([n], i) => i > this.pos[this.key] && !this.verdicts[this.key][n]);
    const left = next >= 0 ? next : list.findIndex(([n]) => !this.verdicts[this.key][n]);
    if (left >= 0) { this.pos[this.key] = left; this.show(cx, true); return; }
    // Round finished: move on to the next round with anything undecided.
    const finished = ROUNDS[this.round].title;
    const r = ROUNDS.findIndex(({ key }, i) => i > this.round && !(key === "wallpaper" && !this.frosted)
      && this.lists[key].some(([n]) => !this.verdicts[key][n]));
    if (r >= 0) { this.setRound(r, cx); this.status = `${finished} done.`; return; }
    this.status = "All rounds done. Enter keeps this look, Esc restores yours.";
    cx.notify();
  }

  toggleBlur(cx) {
    if (!this.frosted) return;
    this.blur = this.blur ? 0 : 90;
    const item = this.key === "wallpaper" ? this.item : null;
    const path = item ? item[2] : this.currentWallpaperPath();
    if (item) this.current.wallpaper = item[0];
    if (path) this.enqueue(cx, () => this.frostWallpaper(path, this.blur, this.current.theme), "wallpaper");
    cx.notify();
  }

  currentWallpaperPath() {
    return this.lists.wallpaper.find(([n]) => n === this.current.wallpaper)?.[2] ?? this.originalWallpaperPath;
  }

  // Keep hands everything to helper.py: fonts into settings.json and settings.base.json (which
  // link.py merges back in), the theme into each of Parker's layouts (app.theme only sets the shown
  // one), and a fresh Frosted render, since the theme's background is baked into the blurred image.
  keep(cx) {
    this.done = true;
    const c = this.current;
    const wallpaper = this.currentWallpaperPath();
    const job = {
      settings: this.settingsPath, base: this.basePath, theme: c.theme,
      fonts: { font: c.font, ui_font: c.ui_font },
      layouts: ["Parker", "Frosted", "Meeting", "Demo"].filter(l => layouts().includes(l)),
      frost: this.frost && wallpaper && layouts().includes("Frosted")
        ? [this.frost, wallpaper, "--blur", String(this.blur), "--theme", c.theme] : null,
    };
    this.status = "Keeping this look…";
    cx.notify();
    // Visiting the other layouts closes this window, so the helper runs on after it goes.
    this.queue.catch(() => {}).then(() => {
      exec("python3", [`${this.modDir}/helper.py`, "keep", JSON.stringify(job)], { timeout: 600000 });
      closeOverlay(props().overlay);
    });
  }

  // Puts back whatever the tryout changed. One restore.py process does the writes, because a closing
  // window's own tasks are cancelled after 250 ms while a process it started keeps running.
  restore() {
    const o = this.original, c = this.current;
    const theme = o.theme && c.theme !== o.theme ? o.theme : null;
    // app.theme acts on the shown layout. After a layout switch, helper.py waits for ours instead.
    const here = shared("layout") === this.layout;
    if (theme && here) run("app.theme", { name: theme });
    const fonts = {};
    for (const k of ["font", "ui_font"]) if (o[k] && c[k] !== o[k]) fonts[k] = o[k];
    let frost = null;
    if (this.frosted && this.frost) {
      const glass = this.glassTheme ?? "none";
      if ((c.wallpaper !== o.wallpaper || this.blur !== this.originalBlur) && this.originalWallpaperPath) {
        frost = [this.frost, this.originalWallpaperPath, "--blur", String(this.originalBlur), "--theme", glass];
      } else if (c.theme !== o.theme) {
        frost = [this.frost, "--relayout", "--theme", glass];
      }
    }
    if ((!theme || here) && !frost && !Object.keys(fonts).length) return Promise.resolve();
    const job = JSON.stringify({ settings: this.settingsPath, fonts, theme: here ? null : theme, frost, layout: this.layout });
    return this.helper("restore", job).catch(e => { this.status = `Restore failed: ${e?.message ?? e}`; });
  }

  // Esc waits for the job already running to land, then restores. Waiting jobs are dropped.
  quit(cx) {
    this.done = true;
    this.status = "Restoring your look…";
    cx.notify();
    this.queue.catch(() => {}).then(() => this.restore()).then(() => this.leave());
  }

  leave() {
    setShared("look-tryout.open", 0);
    closeOverlay(props().overlay);
  }

  // The window can also go without Esc (Herdr's close, a layout switch). Put the look back then too.
  async close() {
    if (this.bounce || checking()) return;
    setShared("look-tryout.open", 0);
    if (this.done) return;
    this.done = true;
    await this.restore();
  }

  command(c, cx) {
    const actions = {
      yes: () => this.vote("yes", cx), no: () => this.vote("no", cx),
      next: () => this.move(1, cx), prev: () => this.move(-1, cx),
      "next-round": () => this.setRound(this.round + 1, cx), "prev-round": () => this.setRound(this.round - 1, cx),
      blur: () => this.toggleBlur(cx), keep: () => this.keep(cx), restore: () => this.quit(cx),
      focus: () => this.handle.focus(),
      preview: () => this.show(cx, true),
    };
    actions[c]?.();
  }

  render() {
    const t = theme();
    if (this.bounce) return div().size_full().bg(t.popover);
    const k = this.key, list = this.lists[k], item = this.item, at = this.pos[k];
    const v = item ? this.verdicts[k][item[0]] : null;
    const yes = t.done ?? t.ansi2, no = t.blocked ?? t.ansi1;
    const chip = (s, on, color) => div().px(7).py(1).rounded(5).text_size(11).border_1()
      .border_color(on ? color : t.border).text_color(on ? color : t.muted).child(s);
    const key = s => div().px(5).rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(t.muted).child(s);
    const stop = el => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());

    const tabs = h_flex().gap(2).children(ROUNDS.map((r, i) => {
      const n = this.lists[r.key].length, decided = this.lists[r.key].filter(([x]) => this.verdicts[r.key][x]).length;
      return stop(h_flex().id(`round-${i}`).gap(4).items_center().px(6).py(3).rounded(6).cursor_pointer()
        .bg(i === this.round ? t.selected : "#00000000").hover(s => s.bg(t.hover))
        .text_size(11.5).text_color(i === this.round ? t.foreground : t.muted)
        .on_click((_e, cx) => this.setRound(i, cx))
        .child(r.title).child(div().text_size(10).text_color(t.dim).child(`${decided}/${n}`)));
    }));

    // One dot per candidate: filled green yes, red no, hollow undecided, ring on the current one.
    const dots = h_flex().gap(4).flex_wrap().children(list.map(([n], i) => {
      const d = this.verdicts[k][n];
      return stop(div().id(`dot-${i}`).w(10).h(10).rounded(5).cursor_pointer()
        .border_1().border_color(i === at ? t.foreground : d === "yes" ? yes : d === "no" ? no : t.dim)
        .bg(d === "yes" ? yes : d === "no" ? no : "#00000000")
        .on_click((_e, cx) => { this.pos[k] = i; this.show(cx, true); }));
    }));

    const codeFont = k === "font" && item ? item[0] : (this.current.font || "JetBrains Mono");
    const code = v_flex().gap(1).p(10).rounded(8).bg(t.background).border_1().border_color(t.border)
      .font_family(codeFont).text_size(12.5)
      .children(CODE.map((line, i) => h_flex().id(`code-${i}`).children(line.map(([kind, s]) =>
        div().text_color(kind === "fg" ? t.foreground : t[`ansi${TOKEN_ANSI[kind]}`]).child(s.replace(/ /g, " "))))));

    const swatches = h_flex().gap(3).children([...Array(16).keys()].map(i =>
      div().w(16).h(16).rounded(3).bg(t[`ansi${i}`]).border_1().border_color(t.border)))
      .child(div().w(8))
      .child(div().w(16).h(16).rounded(3).bg(t.accent));

    let body;
    if (k === "wallpaper" && !this.frosted) {
      body = div().text_size(12).text_color(t.muted)
        .child("Wallpapers show behind the Frosted layout. Switch to it (Settings > Look or Cmd+Shift+L), then open Look tryout again.");
    } else if (k === "wallpaper" && !list.length) {
      body = div().text_size(12).text_color(t.muted)
        .child("No wallpaper thumbnails yet. Run ~/dotfiles/herdr-app/wallpapers/jade.py, then ~/dotfiles/herdr-app/frost --thumbs.");
    } else if (k === "wallpaper") {
      body = v_flex().gap(8)
        .when(!!(item && this.thumbs[item[0]]), el => el.child(image(this.thumbs[item[0]]).w(300).h(188).rounded(8)))
        .child(h_flex().gap(6).items_center().text_size(11).text_color(t.muted)
          .when(!!item && this.current.wallpaper !== item[0], el => el.child(key("space")).child("show it ·"))
          .child(key("b")).child(this.blur ? "Blurred (frosted)" : "Sharp")
          .child(div().text_color(t.dim).child(`· glass tinted by ${this.current.theme ?? "the current theme"}`)));
    } else {
      body = v_flex().gap(10)
        .when(k === "theme", el => el.child(swatches))
        .when(k === "ui_font" && !!item, el => el.child(v_flex().gap(4).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border)
          .font_family(item[0])
          .child(div().text_size(15).font_semibold().child("Raya Day One deck review"))
          .child(div().text_size(12.5).text_color(t.muted).child("3 agents working · 2 need you · Tasks, Calendar, Artifacts"))))
        .child(code);
    }

    const allDone = ROUNDS.every(({ key: rk }) => (rk === "wallpaper" && !this.frosted) || this.lists[rk].every(([n]) => this.verdicts[rk][n]));
    const liked = ROUNDS.map(r => [r.title, this.lists[r.key].filter(([n]) => this.verdicts[r.key][n] === "yes").map(([n]) => n)])
      .filter(([, names]) => names.length);
    const footerNote = this.status
      ? div().text_size(11.5).text_color(t.accent).child(this.status)
      : this.busy ? div().text_size(11.5).text_color(t.working ?? t.muted).child("Applying…")
      : allDone && liked.length ? div().text_size(11.5).text_color(t.muted).child(liked.map(([r, n]) => `${r}: ${n.join(", ")}`).join(" · "))
      : null;

    return v_flex().id("look-tryout").track_focus(this.handle).size_full().bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const action = KEYS[e.keystroke];
        if (!action) return;
        this.command(action, cx);
        cx.stop_propagation();
      })
      .child(h_flex().items_center().justify_between().px(12).py(8).border_b(1).border_color(t.border)
        .child(div().text_size(13).font_semibold().text_color(t.accent).child("Look tryout"))
        .child(tabs))
      .child(v_flex().flex_1().min_h(0).gap(10).px(14).py(12)
        .child(h_flex().items_center().justify_between()
          .child(h_flex().items_center().gap(8).min_w(0)
            .child(div().text_size(17).font_semibold().truncate().child(item ? item[0] : "No candidates installed"))
            .child(div().text_size(11).text_color(t.dim).child(item ? `${at + 1} of ${list.length}` : "")))
          .child(h_flex().gap(5).child(chip("yes", v === "yes", yes)).child(chip("no", v === "no", no))))
        .child(div().text_size(12).text_color(t.muted).child(item ? item[1] : ""))
        .child(body)
        .child(dots)
        .when(!!footerNote, el => el.child(footerNote)))
      .child(h_flex().items_center().gap(5).px(12).py(7).border_t(1).border_color(t.border).text_size(10.5).text_color(t.dim)
        .child(key("y")).child("yes").child(key("n")).child("no")
        .child(key("←→")).child("browse").child(key("tab")).child("round")
        .child(key("↵")).child("keep").child(key("esc")).child("restore"));
  }
}
