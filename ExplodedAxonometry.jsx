#target illustrator
/*
  ExplodedAxonometry.jsx  (v3)
  Makes an "exploded" axonometric view of the selected artwork, showing how the
  design is built up from layers.

  - Every selected path, compound path or group = ONE layer (groups are never broken up).
  - Layer order comes from the real stacking order (back -> front).
  - The result is a new group "Exploded view" next to the original; the original is untouched.
  - Each layer is tilted as one whole object (holes included); stroke widths are
    written back afterwards, so they never change. Colours stay the same.
  - Gradient angles follow the tilt.

  HOW IT STAYS SAFE
  Illustrator remembers objects by their position ("5th item on this layer"), so adding
  anything to a layer can make old references point at the wrong object. This script
  therefore never keeps a reference across such a change:
    1. Each selected object gets a temporary name tag in its Note field.
    2. Copies are made on a separate temporary layer, so your layer never changes.
    3. Only items found on that temporary layer are ever edited.
    4. At the end the finished group is moved next to your art, the temporary layer
       is deleted and all Notes are restored.
*/

(function () {

    // ------------------------------------------------------------------
    // Things you can tweak by hand (everything else is in the pop-up)
    // ------------------------------------------------------------------
    var SCRIPT_NAME   = "Exploded Axonometry";
    var MARGIN_FACTOR = 0.15;       // space between original and result (x artwork width)

    var DEFAULTS = {
        tilt: 30,          // degrees
        plane: 1,          // 0 slope down-right, 1 slope up-right, 2 flat
        spreadMode: 0,     // 0 natural, 1 natural reversed, 2 custom angle
        customAngle: 45,   // degrees, 0 = right, 90 = up
        gapPct: 10,        // % of the artwork's larger side
        reverse: false
    };

    // Temporary markers (all removed again at the end)
    var TAG_SRC  = "__AXO_SRC_";     // + number + "__"  marks a selected object
    var TAG_DONE = "__AXO_DONE__";   // marks a path that has already been tilted
    var TAG_GRAD = "__AXO_GRAD__";   // marks a compound path whose gradient is done
    var TAG_COPY = "__AXO_COPY_";    // + number + "__"  marks a copy on the temp layer
    var TMP_NAME = "__AXO_TEMP_LAYER__";
    var REMAKE_NAME = "__AXO_REMAKE__";   // group holding a released compound path (re-made later)
    var SKIP_NAME   = "__AXO_SKIP__";     // compound path that could not be released

    // ------------------------------------------------------------------
    // Small helpers
    // ------------------------------------------------------------------
    function num(str, fallback) {
        var v = parseFloat(String(str).replace(",", "."));   // accepts decimal comma too
        return isNaN(v) ? fallback : v;
    }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function getNote(obj) {
        try { var n = obj.note; return (n === undefined || n === null) ? "" : String(n); }
        catch (e) { return ""; }
    }
    function copyIndex(note) {          // "__AXO_COPY_3__" -> 3, otherwise -1
        if (note.indexOf(TAG_COPY) !== 0) return -1;
        var v = parseInt(note.substr(TAG_COPY.length), 10);
        return isNaN(v) ? -1 : v;
    }
    function srcIndex(note) {           // "__AXO_SRC_7__" -> 7, otherwise -1
        if (note.indexOf(TAG_SRC) !== 0) return -1;
        var v = parseInt(note.substr(TAG_SRC.length), 10);
        return isNaN(v) ? -1 : v;
    }

    // ------------------------------------------------------------------
    // Remember last-used settings between runs
    // ------------------------------------------------------------------
    function settingsFile() {
        return new File(Folder.userData + "/ExplodedAxonometry_settings.txt");
    }
    function loadSettings() {
        var s = {}, k;
        for (k in DEFAULTS) { s[k] = DEFAULTS[k]; }
        try {
            var f = settingsFile();
            if (f.exists && f.open("r")) {
                var text = f.read();
                f.close();
                var lines = text.split("\n");
                for (var i = 0; i < lines.length; i++) {
                    var p = lines[i].split("=");
                    if (p.length < 2) continue;
                    var key = p[0].replace(/\s/g, "");
                    var val = p[1].replace(/\s/g, "");
                    if (!(key in DEFAULTS)) continue;
                    if (typeof DEFAULTS[key] === "boolean") s[key] = (val === "true");
                    else s[key] = num(val, DEFAULTS[key]);
                }
            }
        } catch (e) {}
        return s;
    }
    function saveSettings(s) {
        try {
            var f = settingsFile();
            if (f.open("w")) {
                var out = [];
                for (var k in s) { out.push(k + "=" + s[k]); }
                f.write(out.join("\n"));
                f.close();
            }
        } catch (e) {}
    }

    // ------------------------------------------------------------------
    // Projection helpers (shared by the pictograms and the real drawing)
    // Maths coordinates: x to the right, y UP.
    // ------------------------------------------------------------------
    function planeAxes(plane, tiltDeg) {
        var th = clamp(tiltDeg, 5, 80) * Math.PI / 180;
        var c = Math.cos(th), sn = Math.sin(th);
        if (plane === 0) return { u: [c, -sn], v: [0, 1], n: [-c, -sn] };   // slope down-right
        if (plane === 1) return { u: [c, sn], v: [0, 1], n: [c, -sn] };     // slope up-right
        return { u: [c, sn], v: [-c, sn], n: [0, 1] };                      // flat
    }
    function spreadDir(ax, mode, customDeg) {
        if (mode === 0) return [ax.n[0], ax.n[1]];
        if (mode === 1) return [-ax.n[0], -ax.n[1]];
        var ca = customDeg * Math.PI / 180;
        return [Math.cos(ca), Math.sin(ca)];
    }

    // ------------------------------------------------------------------
    // Pictogram tiles
    // Plain old JavaScript on purpose (Illustrator's script engine).
    // ------------------------------------------------------------------
    var TILE_W = 140, TILE_H = 112, LABEL_H = 28;
    var C_TILE     = [0.27, 0.27, 0.27, 1];
    var C_TILE_ON  = [0.18, 0.18, 0.18, 1];
    var C_EDGE     = [0.45, 0.45, 0.45, 1];
    var C_ACCENT   = [1.00, 0.60, 0.20, 1];
    var C_TEXT     = [0.93, 0.93, 0.93, 1];
    var C_LINE     = [0.12, 0.12, 0.12, 1];
    var C_BACK     = [0.50, 0.50, 0.50, 1];
    var C_MID      = [0.68, 0.68, 0.68, 1];
    var C_SHEET    = [0.85, 0.85, 0.85, 1];
    var C_FRONT    = [1.00, 0.72, 0.45, 1];
    var C_LETTER   = [0.20, 0.20, 0.20, 1];

    // one sheet as 4 corners (maths coords), centred on (ox, oy)
    function sheetPts(ax, ox, oy) {
        var A = 1.6, B = 1, cs = [[-A, B], [A, B], [A, -B], [-A, -B]], out = [], i;
        for (i = 0; i < 4; i++) {
            out.push([ox + cs[i][0] * ax.u[0] + cs[i][1] * ax.v[0],
                      oy + cs[i][0] * ax.u[1] + cs[i][1] * ax.v[1]]);
        }
        return out;
    }

    // A lopsided letter R drawn on a sheet, so the distortion is easy to read.
    // Strokes in the sheet's own coordinates (u to the right, v up).
    var LETTER_R = [
        [[-0.45, -0.7], [-0.45, 0.7]],                                            // stem
        [[-0.45, 0.7], [0.15, 0.7], [0.38, 0.6], [0.47, 0.35], [0.38, 0.1],
         [0.15, 0], [-0.45, 0]],                                                  // bowl
        [[-0.05, 0], [0.47, -0.7]]                                                // leg
    ];
    function letterLines(ax, ox, oy) {
        var out = [], i, j;
        for (i = 0; i < LETTER_R.length; i++) {
            var line = [];
            for (j = 0; j < LETTER_R[i].length; j++) {
                var u = LETTER_R[i][j][0], v = LETTER_R[i][j][1];
                line.push([ox + u * ax.u[0] + v * ax.v[0], oy + u * ax.u[1] + v * ax.v[1]]);
            }
            out.push(line);
        }
        return out;
    }

    // shapes: [{ pts: [[x,y],...], fill: colour, lines: [[[x,y],...],...], lineW: n }, ...]
    // drawn back to front; "lines" (optional) are open strokes drawn on top of that shape
    function drawTile(btn, shapes, label, on, font) {
        var g = btn.graphics;
        var w = btn.size[0], h = btn.size[1], i, j;

        var bgCol = C_TILE;
        if (on) bgCol = C_TILE_ON;
        g.newPath();
        g.rectPath(0, 0, w, h);
        g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, bgCol));

        var edgeCol = C_EDGE, edgeW = 1;
        if (on) { edgeCol = C_ACCENT; edgeW = 3; }
        g.newPath();
        g.rectPath(1, 1, w - 2, h - 2);
        g.strokePath(g.newPen(g.PenType.SOLID_COLOR, edgeCol, edgeW));

        // fit all shapes into the icon area
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (i = 0; i < shapes.length; i++) {
            for (j = 0; j < shapes[i].pts.length; j++) {
                var p = shapes[i].pts[j];
                if (p[0] < minX) minX = p[0];
                if (p[0] > maxX) maxX = p[0];
                if (p[1] < minY) minY = p[1];
                if (p[1] > maxY) maxY = p[1];
            }
        }
        var bx = 12, by = 10, bw = w - 24, bh = h - LABEL_H - 16;
        var spanX = Math.max(maxX - minX, 0.001), spanY = Math.max(maxY - minY, 0.001);
        var sc = Math.min(bw / spanX, bh / spanY);
        var offX = bx + (bw - spanX * sc) / 2, offY = by + (bh - spanY * sc) / 2;

        var linePen = g.newPen(g.PenType.SOLID_COLOR, C_LINE, 1);
        for (i = 0; i < shapes.length; i++) {
            var pts = shapes[i].pts;
            g.newPath();
            for (j = 0; j < pts.length; j++) {
                var sx = offX + (pts[j][0] - minX) * sc;
                var sy = offY + (maxY - pts[j][1]) * sc;     // flip: screen y points down
                if (j === 0) g.moveTo(sx, sy);
                else g.lineTo(sx, sy);
            }
            g.closePath();
            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, shapes[i].fill));
            g.strokePath(linePen);

            if (shapes[i].lines) {
                var lw = shapes[i].lineW;
                if (!lw) lw = 3;
                var letterPen = g.newPen(g.PenType.SOLID_COLOR, C_LETTER, lw);
                for (var m = 0; m < shapes[i].lines.length; m++) {
                    var ln = shapes[i].lines[m];
                    g.newPath();
                    for (j = 0; j < ln.length; j++) {
                        var lx = offX + (ln[j][0] - minX) * sc;
                        var ly = offY + (maxY - ln[j][1]) * sc;
                        if (j === 0) g.moveTo(lx, ly);
                        else g.lineTo(lx, ly);
                    }
                    g.strokePath(letterPen);
                }
            }
        }

        // label
        var textPen = g.newPen(g.PenType.SOLID_COLOR, C_TEXT, 1);
        var tw = 0;
        try { tw = g.measureString(label, font)[0]; } catch (eM) { tw = label.length * 7; }
        g.drawString(label, textPen, Math.max(4, (w - tw) / 2), h - LABEL_H - 2, font);
    }

    function makeFont(style, size) {
        try { return ScriptUI.newFont("dialog", style, size); } catch (e) { return null; }
    }
    function setFont(ctrl, font) {
        if (!font) return;
        try { ctrl.graphics.font = font; } catch (e) {}
    }

    // ------------------------------------------------------------------
    // Settings pop-up
    // ------------------------------------------------------------------
    function showDialog(s) {
        var FONT = makeFont("REGULAR", 14), TILE_FONT = makeFont("REGULAR", 14);
        var DEG = "\u00B0";

        var plane = clamp(Math.round(s.plane), 0, 2);
        var mode = clamp(Math.round(s.spreadMode), 0, 2);

        var w = new Window("dialog", SCRIPT_NAME);
        w.orientation = "column";
        w.alignChildren = "fill";
        w.spacing = 12;
        w.margins = 16;

        function label(parent, text) {
            var t = parent.add("statictext", undefined, text);
            setFont(t, FONT);
            return t;
        }
        function numberField(parent, value) {
            var e = parent.add("edittext", undefined, String(value));
            e.characters = 6;
            setFont(e, FONT);
            return e;
        }
        function panel(title) {
            var p = w.add("panel", undefined, title);
            p.orientation = "column";
            p.alignChildren = "left";
            p.margins = [14, 22, 14, 14];
            p.spacing = 10;
            setFont(p, FONT);
            return p;
        }
        function tileRow(parent) {
            var r = parent.add("group");
            r.orientation = "row";
            r.spacing = 10;
            return r;
        }
        function repaint(list) {
            for (var i = 0; i < list.length; i++) { list[i].hide(); list[i].show(); }   // hide + show = repaint
        }

        // ---- Projection ----
        var pp = panel("Projection");
        var r1 = pp.add("group");
        label(r1, "Tilt angle (X" + DEG + "):");
        var tiltE = numberField(r1, s.tilt);
        tiltE.helpTip = "30 = classic isometric look";

        label(pp, "Sheet plane:");
        var PLANE_NAMES = ["Slope down-right", "Slope up-right", "Flat"];
        var planeTiles = [], rp = tileRow(pp), i;
        for (i = 0; i < 3; i++) {
            var pb = rp.add("button", undefined, "");
            pb.preferredSize = [TILE_W, TILE_H];
            pb.axoIndex = i;
            pb.helpTip = PLANE_NAMES[i];
            pb.onDraw = function () {
                try {
                    var ax = planeAxes(this.axoIndex, num(tiltE.text, DEFAULTS.tilt));
                    drawTile(this, [{ pts: sheetPts(ax, 0, 0), fill: C_SHEET, lines: letterLines(ax, 0, 0), lineW: 4 }],
                             PLANE_NAMES[this.axoIndex], this.axoIndex === plane, TILE_FONT);
                } catch (eD) {}
            };
            pb.onClick = function () {
                plane = this.axoIndex;
                repaint(planeTiles);
                repaint(dirTiles);          // direction pictograms follow the plane
            };
            planeTiles.push(pb);
        }

        // ---- Spreading the layers apart ----
        var sp = panel("Spreading the layers apart");
        label(sp, "Direction:");
        var DIR_NAMES = ["Natural", "Natural reversed", "Custom"];
        var dirTiles = [], rd = tileRow(sp);
        for (i = 0; i < 3; i++) {
            var db = rd.add("button", undefined, "");
            db.preferredSize = [TILE_W, TILE_H];
            db.axoIndex = i;
            db.helpTip = DIR_NAMES[i] + " (orange = front layer)";
            db.onDraw = function () {
                try {
                    var ax = planeAxes(plane, num(tiltE.text, DEFAULTS.tilt));
                    var d = spreadDir(ax, this.axoIndex, num(customE.text, DEFAULTS.customAngle));
                    var fills = [C_BACK, C_MID, C_FRONT], shapes = [], k;
                    for (k = 0; k < 3; k++) {
                        var sh = { pts: sheetPts(ax, k * 1.1 * d[0], k * 1.1 * d[1]), fill: fills[k] };
                        if (k === 2) { sh.lines = letterLines(ax, k * 1.1 * d[0], k * 1.1 * d[1]); sh.lineW = 2; }
                        shapes.push(sh);
                    }
                    drawTile(this, shapes, DIR_NAMES[this.axoIndex], this.axoIndex === mode, TILE_FONT);
                } catch (eD2) {}
            };
            db.onClick = function () {
                mode = this.axoIndex;
                customE.enabled = (mode === 2);
                repaint(dirTiles);
            };
            dirTiles.push(db);
        }
        var legend = label(sp, "Orange sheet = front layer");

        var r4 = sp.add("group");
        label(r4, "Custom angle (X" + DEG + "):");
        var customE = numberField(r4, s.customAngle);
        customE.helpTip = "0 = right, 90 = up, 180 = left, 270 = down";
        customE.enabled = (mode === 2);

        var r5 = sp.add("group");
        label(r5, "Gap between layers (%):");
        var gapE = numberField(r5, s.gapPct);
        gapE.helpTip = "Percent of the artwork's larger side. 0 = stacked exactly.";

        var revChk = sp.add("checkbox", undefined, "Reverse layer order");
        revChk.helpTip = "Tick this if the layers come out upside-down";
        revChk.value = !!s.reverse;
        setFont(revChk, FONT);

        // live pictogram updates while typing
        tiltE.onChanging = function () { repaint(planeTiles); repaint(dirTiles); };
        customE.onChanging = function () { repaint(dirTiles); };

        var bg = w.add("group");
        bg.alignment = "right";
        var cb = bg.add("button", undefined, "Cancel", { name: "cancel" });
        var ob = bg.add("button", undefined, "Explode!", { name: "ok" });
        setFont(cb, FONT);
        setFont(ob, FONT);

        if (w.show() !== 1) return null;

        return {
            tilt: clamp(num(tiltE.text, DEFAULTS.tilt), 5, 80),
            plane: plane,
            spreadMode: mode,
            customAngle: num(customE.text, DEFAULTS.customAngle),
            gapPct: clamp(num(gapE.text, DEFAULTS.gapPct), 0, 1000),
            reverse: revChk.value
        };
    }

    // ------------------------------------------------------------------
    // Walking the document (front -> back), always with fresh references
    // ------------------------------------------------------------------
    // Calls cb(item, k) for every item carrying a source tag. Does not look inside
    // tagged items. skipTemp = true ignores the temporary layer.
    function walkTagged(container, cb) {
        var items = container.pageItems, len = items.length, i;
        for (i = 0; i < len; i++) {
            var it = items[i];
            var k = srcIndex(getNote(it));
            if (k >= 0) cb(it, k);
            else if (it.typename === "GroupItem") walkTagged(it, cb);
        }
        if (container.typename === "Layer") {
            for (i = 0; i < container.layers.length; i++) walkTagged(container.layers[i], cb);
        }
    }
    function walkDocTagged(doc, cb, skipTemp) {
        for (var l = 0; l < doc.layers.length; l++) {
            var lay = doc.layers[l];
            if (skipTemp && lay.name === TMP_NAME) continue;
            walkTagged(lay, cb);
        }
    }

    // Final safety net: puts every Note this script touched back the way it was.
    function cleanupNotes(doc, savedNotes, copyNotes) {
        function fix(obj) {
            try { if (obj.name === REMAKE_NAME || obj.name === SKIP_NAME) obj.name = ""; } catch (e0) {}
            var n = getNote(obj);
            if (n === "") return;
            var k = srcIndex(n), ci = copyIndex(n);
            if (k >= 0) { try { obj.note = (savedNotes[k] !== undefined) ? savedNotes[k] : ""; } catch (e1) {} }
            else if (ci >= 0) { try { obj.note = (copyNotes[ci] !== undefined) ? copyNotes[ci] : ""; } catch (e3) {} }
            else if (n === TAG_DONE || n === TAG_GRAD) { try { obj.note = ""; } catch (e2) {} }
        }
        function walk(container) {
            var items = container.pageItems, len = items.length, i, j;
            for (i = 0; i < len; i++) {
                var it = items[i];
                fix(it);
                if (it.typename === "GroupItem") walk(it);
                else if (it.typename === "CompoundPathItem") {
                    for (j = 0; j < it.pathItems.length; j++) fix(it.pathItems[j]);
                }
            }
            if (container.typename === "Layer") {
                for (i = 0; i < container.layers.length; i++) walk(container.layers[i]);
            }
        }
        try { for (var l = 0; l < doc.layers.length; l++) walk(doc.layers[l]); } catch (e) {}
    }

    // ------------------------------------------------------------------
    // Main
    // ------------------------------------------------------------------
    function main() {
        if (app.documents.length === 0) {
            alert("Open a document and select some artwork first.");
            return;
        }
        var doc = app.activeDocument;
        var sel = doc.selection;
        if (!sel || sel.length < 2) {
            alert("Select at least two objects (paths, compound paths or groups).");
            return;
        }

        // ---- Collect usable items (no changes to the document yet) ----
        var items = [], skipped = 0, i, k;
        for (i = 0; i < sel.length; i++) {
            var t = sel[i].typename;
            if (t === "PathItem" || t === "CompoundPathItem" || t === "GroupItem") items.push(sel[i]);
            else skipped++;
        }
        if (items.length < 2) {
            alert("I need at least two paths, compound paths or groups in the selection.");
            return;
        }

        var settings = showDialog(loadSettings());
        if (!settings) return;
        saveSettings(settings);

        // ---- Overall bounding box, read before anything changes ----
        var L = Infinity, T = -Infinity, R = -Infinity, B = Infinity;
        for (i = 0; i < items.length; i++) {
            var gb = items[i].geometricBounds;   // [left, top, right, bottom], y points up
            if (gb[0] < L) L = gb[0];
            if (gb[1] > T) T = gb[1];
            if (gb[2] > R) R = gb[2];
            if (gb[3] < B) B = gb[3];
        }
        var W = R - L, H = T - B;
        var cx = (L + R) / 2, cy = (T + B) / 2;

        // ---- Tag every selected object (editing a Note does not move anything) ----
        var savedNotes = [];
        for (i = 0; i < items.length; i++) {
            savedNotes[i] = getNote(items[i]);
            items[i].note = TAG_SRC + i + "__";
        }
        items = null; sel = null;   // these references are not used again

        var tmp = null, copyNotes = [];
        try {
            // ---- Real stacking order: walk the document front -> back ----
            var frontToBack = [];
            walkDocTagged(doc, function (it, kk) { frontToBack.push(kk); }, false);
            var order = frontToBack.slice(0).reverse();          // back -> front
            if (settings.reverse) order.reverse();
            var n = order.length;
            if (n < 2) {
                alert("Only " + n + " usable object(s) found - nothing to explode.");
                return;
            }
            // which layer of the document should receive the result (the front-most object's)
            var frontK = frontToBack[0];

            // ---- Projection maths ----
            var ax = planeAxes(settings.plane, settings.tilt);
            var uAxis = ax.u, vAxis = ax.v;
            var dir = spreadDir(ax, settings.spreadMode, settings.customAngle);
            var gap = settings.gapPct / 100 * Math.max(W, H);

            function rawProject(x, y, idx) {
                var u = x - cx, v = y - cy;
                return [cx + u * uAxis[0] + v * vAxis[0] + idx * gap * dir[0],
                        cy + u * uAxis[1] + v * vAxis[1] + idx * gap * dir[1]];
            }
            var corners = [[L, T], [R, T], [R, B], [L, B]];
            var minX = Infinity, minY = Infinity, maxY = -Infinity;
            for (i = 0; i < n; i++) {
                for (k = 0; k < 4; k++) {
                    var q = rawProject(corners[k][0], corners[k][1], i);
                    if (q[0] < minX) minX = q[0];
                    if (q[1] < minY) minY = q[1];
                    if (q[1] > maxY) maxY = q[1];
                }
            }
            var sx = (R + MARGIN_FACTOR * W) - minX;   // result sits to the right of the original
            var sy = cy - (minY + maxY) / 2;           // vertically centred on it
            function P(pt, idx) {
                var r = rawProject(pt[0], pt[1], idx);
                return [r[0] + sx, r[1] + sy];
            }

            // ---- Temporary layer: copies go here, your own layer never changes ----
            tmp = doc.layers.add();
            tmp.name = TMP_NAME;

            // Fresh references to the originals (taken AFTER the temp layer exists)
            var origByK = {};
            walkDocTagged(doc, function (it, kk) { origByK[kk] = it; }, true);
            var targetLayer = origByK[frontK].layer;

            // Duplicate back -> front; each new copy goes in front of the previous one
            for (i = 0; i < n; i++) {
                origByK[order[i]].duplicate(tmp, ElementPlacement.PLACEATBEGINNING);
            }

            // ---- Verify before touching anything ----
            var stillHome = 0;
            walkDocTagged(doc, function () { stillHome++; }, true);
            if (stillHome !== n || tmp.pageItems.length !== n) {
                alert(SCRIPT_NAME + ": copying did not go as expected (" + stillHome + " originals in place, " +
                      tmp.pageItems.length + " copies, expected " + n + ").\n\n" +
                      "Nothing was tilted. Please press Ctrl+Z and send me this message.");
                return;
            }

            // Originals: give their Notes back right away (references are still valid)
            for (i = 0; i < n; i++) {
                try { origByK[order[i]].note = savedNotes[order[i]]; } catch (eR) {}
            }

            // ---- Tilt the copies ----
            // Each copy is tilted as ONE object with Illustrator's own transform, so every
            // part inside it moves - including compound-path holes that Illustrator hides
            // from scripts (those were left behind before, sitting on top of the original).
            // Gradients get the same tilt. Stroke widths are written back afterwards,
            // so they never change.
            var unsupported = 0, gradFail = 0, lockFail = 0, noRelease = 0, remakeFail = 0, failed = [];
            var widthUnchecked = 0;

            // Tag every copy so it can always be found again
            // (on the temp layer, item [0] is the front copy and [n-1] the back copy)
            for (i = 0; i < n; i++) {
                copyNotes[i] = savedNotes[order[i]];
                tmp.pageItems[n - 1 - i].note = TAG_COPY + i + "__";
            }
            var copyByIdx = [];
            for (i = 0; i < tmp.pageItems.length; i++) {
                var ci = copyIndex(getNote(tmp.pageItems[i]));
                if (ci >= 0) copyByIdx[ci] = tmp.pageItems[i];
            }

            // The tilt itself (the same for every layer): x' = A*x + C*y,  y' = B*x + D*y
            var LA = uAxis[0], LB = uAxis[1], LC = vAxis[0], LD = vAxis[1];
            function lin(p) { return [LA * p[0] + LC * p[1], LB * p[0] + LD * p[1]]; }
            function near(a, b) { return Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05; }
            function makeMatrix(v) {
                var m = app.getIdentityMatrix();
                m.mValueA = v[0]; m.mValueB = v[1]; m.mValueC = v[2]; m.mValueD = v[3];
                m.mValueTX = 0; m.mValueTY = 0;
                return m;
            }
            function applyT(item, m) {
                // positions, fill patterns, gradients, stroke patterns; widths fixed afterwards
                item.transform(m, true, true, true, true, 100, Transformation.DOCUMENTORIGIN);
            }
            function readPts(pth) {
                var r = [], q;
                for (q = 0; q < pth.pathPoints.length; q++) r.push(pth.pathPoints[q].anchor);
                return r;
            }

            // ---- Calibrate on a tiny invisible test triangle ----
            // Illustrator's matrix and origin conventions differ between setups, so the
            // script checks which version moves the test points exactly where they belong.
            var CAND = [[LA, LB, LC, LD], [LA, LC, LB, LD], [LA, -LB, -LC, LD], [LA, -LC, -LB, LD]];
            var probePts = [[cx, cy], [cx + 100, cy], [cx, cy + 60]];
            var goodM = null, shift = null, sgnX = 1, sgnY = 1;
            for (k = 0; k < CAND.length && goodM === null; k++) {
                var probe = tmp.pathItems.add();
                probe.setEntirePath(probePts);
                probe.closed = true; probe.filled = false; probe.stroked = false;
                var mk = makeMatrix(CAND[k]);
                applyT(probe, mk);
                var got = readPts(probe);
                var g1 = [got[1][0] - got[0][0], got[1][1] - got[0][1]];
                var g2 = [got[2][0] - got[0][0], got[2][1] - got[0][1]];
                if (near(g1, lin([100, 0])) && near(g2, lin([0, 60]))) {
                    goodM = mk;
                    var exp0 = lin(probePts[0]);
                    shift = [got[0][0] - exp0[0], got[0][1] - exp0[1]];   // offset from Illustrator's origin
                    probe.translate(10, 10);                               // which way does "translate" go?
                    var moved = readPts(probe);
                    if (moved[0][0] < got[0][0]) sgnX = -1;
                    if (moved[0][1] < got[0][1]) sgnY = -1;
                }
                probe.remove();
            }
            if (goodM === null) {
                tmp.remove(); tmp = null;
                alert(SCRIPT_NAME + ": couldn't work out how this Illustrator version tilts objects.\n\n" +
                      "Nothing was changed. Please send me this message.");
                return;
            }

            // ---- Tilt every copy ----
            function collectPaths(it, out) {
                var t = it.typename, q;
                try { if (it.locked) it.locked = false; } catch (eL) { lockFail++; }
                if (t === "PathItem") {
                    out.push(it);
                } else if (t === "CompoundPathItem") {
                    var cnt = 0;
                    try { cnt = it.pathItems.length; } catch (eC) {}
                    if (cnt === 0) widthUnchecked++;
                    for (q = 0; q < cnt; q++) out.push(it.pathItems[q]);
                } else if (t === "GroupItem") {
                    for (q = 0; q < it.pageItems.length; q++) collectPaths(it.pageItems[q], out);
                }
            }
            for (i = 0; i < n; i++) {
                var copy = copyByIdx[i];
                if (!copy) { failed.push("layer " + (i + 1) + " of " + n + ": copy not found"); continue; }
                try {
                    var paths = [], widths = [], q2;
                    collectPaths(copy, paths);
                    for (q2 = 0; q2 < paths.length; q2++) {
                        var wv = null;
                        try { if (paths[q2].stroked) wv = paths[q2].strokeWidth; } catch (eW) {}
                        widths.push(wv);
                    }

                    applyT(copy, goodM);

                    // move it to its place in the exploded stack
                    var kx = cx - (LA * cx + LC * cy) + i * gap * dir[0] + sx;
                    var ky = cy - (LB * cx + LD * cy) + i * gap * dir[1] + sy;
                    copy.translate(sgnX * (kx - shift[0]), sgnY * (ky - shift[1]));

                    // stroke widths back to exactly what they were
                    for (q2 = 0; q2 < paths.length; q2++) {
                        if (widths[q2] === null) continue;
                        try {
                            if (Math.abs(paths[q2].strokeWidth - widths[q2]) > 0.0001) paths[q2].strokeWidth = widths[q2];
                        } catch (eS) {}
                    }
                } catch (eI) {
                    failed.push("layer " + (i + 1) + " of " + n + ": " + eI.message + " (line " + eI.line + ")");
                }
            }

            // ---- Copies get their normal Notes back ----
            for (i = 0; i < tmp.pageItems.length; i++) {
                var ci2 = copyIndex(getNote(tmp.pageItems[i]));
                if (ci2 >= 0) { try { tmp.pageItems[i].note = copyNotes[ci2]; } catch (eCN) {} }
            }

            // ---- Wrap everything into one group (stacking order kept) ----
            var wrap = tmp.groupItems.add();          // becomes tmp item [0]
            wrap.name = "Exploded view";
            while (tmp.pageItems.length > 1) {
                tmp.pageItems[1].move(tmp.pageItems[0], ElementPlacement.PLACEATEND);
            }

            // ---- Move the group next to your art, then remove the temp layer ----
            tmp.pageItems[0].move(targetLayer, ElementPlacement.PLACEATBEGINNING);
            doc.selection = null;
            try { targetLayer.pageItems[0].selected = true; } catch (eS) {}
            tmp.remove();
            tmp = null;
            app.redraw();

            // ---- Report problems (only if there were any) ----
            var notes = [];
            if (skipped > 0) notes.push(skipped + " selected object(s) of an unsupported type (text, image, ...) were ignored.");
            if (unsupported > 0) notes.push(unsupported + " object(s) inside groups (text, image, ...) could not be tilted and stayed flat.");
            if (gradFail > 0) notes.push(gradFail + " gradient(s) could not be adjusted.");
            if (lockFail > 0) notes.push(lockFail + " locked item(s) could not be unlocked.");
            if (widthUnchecked > 0) notes.push(widthUnchecked + " compound path(s) hide their parts from scripts: they are tilted correctly, but please check their stroke width.");
            if (noRelease > 0) notes.push(noRelease + " compound path(s) could not be opened up and stayed flat.");
            if (remakeFail > 0) notes.push(remakeFail + " compound path(s) were tilted but are now plain groups (they could not be re-made as compound paths).");
            if (failed.length > 0) notes.push("Problems:\n  " + failed.join("\n  "));
            if (notes.length > 0) alert(SCRIPT_NAME + ":\n\n" + notes.join("\n"));

        } finally {
            // Always: restore every Note, and remove the temp layer if it is empty
            cleanupNotes(doc, savedNotes, copyNotes);
            if (tmp) {
                try { if (tmp.pageItems.length === 0 && tmp.layers.length === 0) tmp.remove(); } catch (eT) {}
            }
        }
    }

    try {
        main();
    } catch (err) {
        alert(SCRIPT_NAME + " hit an error:\n\n" + err.message + "\n(line " + err.line + ")");
    }

})();
