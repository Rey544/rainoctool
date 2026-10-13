(function(root, factory) {
    const api = factory(typeof module === "object" ? require("./region-core") : root.OCMapCore);
    if (typeof module === "object") module.exports = api; else root.OCMapRenderer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(C) {
    "use strict";
    const ink = "#000000", air = "#ffffff";
    const hintColors = Object.fromEntries(Object.keys(C.materials).map(k => [ k, "#ffff00" ]));
    const category = s => s.material === "water" ? "water" : s.material === "draft" ? "draft" : "geometry";
    function coalescedShapes(shapes) {
        const out = [];
        let group = [], key = null;
        const near = (a, b) => Math.abs(a - b) < 1e-8;
        const join = (a, b) => {
            if (near(a.y, b.y) && near(a.h, b.h) && (near(a.x + a.w, b.x) || near(b.x + b.w, a.x))) return {
                x: Math.min(a.x, b.x),
                y: a.y,
                w: a.w + b.w,
                h: a.h
            };
            if (near(a.x, b.x) && near(a.w, b.w) && (near(a.y + a.h, b.y) || near(b.y + b.h, a.y))) return {
                x: a.x,
                y: Math.min(a.y, b.y),
                w: a.w,
                h: a.h + b.h
            };
            return null;
        };
        const sweep = vertical => {
            group.sort((a, b) => vertical ? a.clip.x - b.clip.x || a.clip.w - b.clip.w || a.clip.y - b.clip.y : a.clip.y - b.clip.y || a.clip.h - b.clip.h || a.clip.x - b.clip.x);
            const merged = [];
            for (const s of group) {
                const last = merged.at(-1), clip = last && join(last.clip, s.clip);
                if (clip) merged[merged.length - 1] = {
                    ...last,
                    clip: clip
                }; else merged.push(s);
            }
            group = merged;
        };
        const flush = () => {
            if (group.length > 1) {
                let count;
                do {
                    count = group.length;
                    sweep(false);
                    sweep(true);
                } while (group.length < count);
            }
            out.push(...group);
            group = [];
        };
        for (const s of shapes) {
            if (!s.clip) {
                flush();
                key = null;
                out.push(s);
                continue;
            }
            const {id: id, clip: clip, ...drawing} = s;
            drawing.roomId = drawing.roomId || null;
            const next = JSON.stringify(drawing, (k, v) => typeof v === "number" ? Math.round(v * 1e9) / 1e9 : v);
            if (next !== key) {
                flush();
                key = next;
            }
            group.push(s);
        }
        flush();
        return out;
    }
    function path(c, s) {
        c.beginPath();
        if (s.points) {
            c.moveTo(s.points[0].x, s.points[0].y);
            for (const p of s.points.slice(1)) c.lineTo(p.x, p.y);
            if (s.type === "polygon") c.closePath();
        } else if (s.type === "ellipse") c.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2); else c.rect(s.x, s.y, s.w, s.h);
    }
    function clipRect(c, b) {
        const m = c.getTransform?.();
        if (m && m.a > 0 && m.d > 0 && Math.abs(m.b) + Math.abs(m.c) < 1e-5) {
            const x = Math.round(b.x * m.a + m.e), y = Math.round(b.y * m.d + m.f), right = Math.round((b.x + b.w) * m.a + m.e), bottom = Math.round((b.y + b.h) * m.d + m.f);
            c.rect((x - m.e) / m.a, (y - m.f) / m.d, (right - x) / m.a, (bottom - y) / m.d);
        } else c.rect(b.x, b.y, b.w, b.h);
    }
    function clipShape(c, r, s) {
        if (s.roomId) {
            const rm = r.rooms.find(v => v.id === s.roomId);
            if (rm) {
                const box = !s.shelterFixed && C.shelterEditableBounds(rm) || rm;
                c.beginPath();
                clipRect(c, box);
                c.clip();
            }
        }
        if (s.clip) {
            c.beginPath();
            clipRect(c, s.clip);
            c.clip();
        }
    }
    function beams(c, r, s) {
        let b = C.intersection(C.bounds(s), {
            x: 0,
            y: 0,
            w: r.w,
            h: r.h
        });
        if (s.roomId) {
            const rm = r.rooms.find(o => o.id === s.roomId);
            if (rm && b) b = C.intersection(b, rm);
        }
        if (s.type === "rect" && !s.points && b) b = C.intersection(b, s);
        if (!b) return;
        const left = Math.ceil(b.x - .5), top = Math.ceil(b.y - .5), right = Math.ceil(b.x + b.w - .5), bottom = Math.ceil(b.y + b.h - .5), horizontal = s.material === "beamH";
        c.beginPath();
        if (s.type === "rect" && !s.points) {
            if (horizontal) {
                for (let y = top; y < bottom; y++) c.rect(left, y + .4, right - left, .2);
            } else for (let x = left; x < right; x++) c.rect(x + .4, top, .2, bottom - top);
        } else for (let x = left; x < right; x++) for (let y = top; y < bottom; y++) if (C.hitShape(s, {
            x: x + .5,
            y: y + .5
        })) {
            if (horizontal) c.rect(x, y + .4, 1, .2); else c.rect(x + .4, y, .2, 1);
        }
        c.fill();
    }
    function rawGeometry(c, s) {
        const [geo, flags] = s.rawCell;
        for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) {
            if (geo === 1) c.fillRect(x, y, 1, 1); else if (geo >= 2 && geo <= 5) {
                const v = {
                    2: [ [ 0, 1 ], [ 1, 0 ], [ 1, 1 ] ],
                    3: [ [ 0, 0 ], [ 0, 1 ], [ 1, 1 ] ],
                    4: [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ] ],
                    5: [ [ 0, 0 ], [ 1, 0 ], [ 0, 1 ] ]
                }[geo];
                c.beginPath();
                c.moveTo(x + v[0][0], y + v[0][1]);
                for (const p of v.slice(1)) c.lineTo(x + p[0], y + p[1]);
                c.closePath();
                c.fill();
            } else if (geo === 6) c.fillRect(x, y, 1, .5); else if (geo === 7) {
                c.save();
                c.globalAlpha *= .5;
                c.fillRect(x, y, 1, 1);
                c.restore();
            } else if (geo === 9) {
                c.lineWidth = .1;
                c.strokeRect(x + .05, y + .05, .9, .9);
            }
            if (geo !== 1) {
                if (flags.includes(1)) c.fillRect(x, y + .4, 1, .2);
                if (flags.includes(2)) c.fillRect(x + .4, y, .2, 1);
                if (flags.includes(5)) c.fillRect(x + .4, y + .4, .2, .2);
            }
        }
    }
    function shape(c, r, s, {hint: hint = false} = {}) {
        c.save();
        const mat = s.material, isBeam = !s.erase && (mat === "beamH" || mat === "beamV");
        clipShape(c, r, isBeam && !s.rawCell ? {
            ...s,
            clip: null
        } : s);
        c.fillStyle = hint ? hintColors[mat] || "#888888" : ink;
        c.strokeStyle = c.fillStyle;
        c.lineWidth = s.width || 1;
        c.lineCap = "butt";
        c.lineJoin = "miter";
        if (hint) c.globalAlpha = .65;
        if (s.rawCell && !s.erase && !hint) {
            rawGeometry(c, s);
            c.restore();
            return;
        }
        if (isBeam) {
            beams(c, r, s);
            c.restore();
            return;
        }
        if (s.erase || mat === "air" || mat === "crawl") {
            c.globalCompositeOperation = hint ? "source-over" : "destination-out";
            if (!hint) c.globalAlpha = 1;
        }
        path(c, s);
        if (mat.startsWith("slope") && !s.erase && !hint) {
            const b = C.intersection(C.bounds(s), {
                x: 0,
                y: 0,
                w: r.w,
                h: r.h
            });
            if (b && b.w * b.h < 3e5) {
                for (let x = Math.floor(b.x); x < b.x + b.w; x++) for (let y = Math.floor(b.y); y < b.y + b.h; y++) {
                    if (!C.hitShape(s, {
                        x: x + .5,
                        y: y + .5
                    })) continue;
                    const v = {
                        slopeRU: [ [ 0, 1 ], [ 1, 0 ], [ 1, 1 ] ],
                        slopeLU: [ [ 0, 0 ], [ 0, 1 ], [ 1, 1 ] ],
                        slopeRD: [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ] ],
                        slopeLD: [ [ 0, 0 ], [ 1, 0 ], [ 0, 1 ] ]
                    }[mat];
                    c.beginPath();
                    c.moveTo(x + v[0][0], y + v[0][1]);
                    for (const p of v.slice(1)) c.lineTo(x + p[0], y + p[1]);
                    c.closePath();
                    c.fill();
                }
            }
        } else if (s.points && s.type !== "polygon") {
            if (s.points.every(p => p.x === s.points[0].x && p.y === s.points[0].y)) {
                c.beginPath();
                c.arc(s.points[0].x, s.points[0].y, (s.width || 1) / 2, 0, Math.PI * 2);
                c.fill();
            } else c.stroke();
        } else c.fill();
        c.restore();
    }
    function water(c, r, s, z) {
        c.save();
        clipShape(c, r, s);
        path(c, s);
        if (s.points && s.type !== "polygon") {
            c.strokeStyle = ink;
            c.lineWidth = Math.min(s.width || 1, 1);
            c.stroke();
        } else {
            c.clip();
            const b = C.bounds(s);
            c.strokeStyle = ink;
            c.lineWidth = Math.max(.2, .7 / z);
            c.beginPath();
            for (let y = Math.ceil(b.y); y < b.y + b.h; y += 3) {
                c.moveTo(b.x, y);
                c.lineTo(b.x + b.w, y);
            }
            c.stroke();
        }
        c.restore();
    }
    function create(createCanvas) {
        const buffer = createCanvas(1, 1), composite = createCanvas(1, 1);
        return function paint(c, r, z, {workSurface: workSurface = false, beforeTerrain: beforeTerrain = null, activeShape: activeShape = null, activeShapes: activeShapes = null, backgrounds: backgrounds = z >= 2, rasterBounds: rasterBounds = null, rasterScale: rasterScale = null} = {}) {
            r = {
                ...r,
                shapes: coalescedShapes(r.shapes)
            };
            c.save();
            c.beginPath();
            c.rect(0, 0, r.w, r.h);
            c.clip();
            c.imageSmoothingEnabled = false;
            const area = rasterBounds || {
                x: 0,
                y: 0,
                w: r.w,
                h: r.h
            }, budgetScale = Math.sqrt(16e6 / (area.w * area.h)), scale = rasterScale || Math.max(.05, Math.min(Math.max(1, Math.ceil(z)), budgetScale));
            buffer.width = composite.width = Math.max(1, Math.ceil(area.w * scale));
            buffer.height = composite.height = Math.max(1, Math.ceil(area.h * scale));
            const bc = buffer.getContext("2d"), cc = composite.getContext("2d");
            for (const l of r.layers) {
                if (!l.visible) continue;
                cc.setTransform(1, 0, 0, 1, 0, 0);
                cc.clearRect(0, 0, composite.width, composite.height);
                cc.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale);
                cc.imageSmoothingEnabled = false;
                for (const rm of r.rooms) if (rm.layer === l.id && C.roomVisible(r, rm)) {
                    cc.fillStyle = rm.background || air;
                    cc.fillRect(rm.x, rm.y, rm.w, rm.h);
                }
                if (beforeTerrain) beforeTerrain(cc, l.id);
                if (backgrounds) for (const level of [ 2, 1 ]) for (const rm of r.rooms) {
                    if (rm.layer !== l.id || !C.roomVisible(r, rm) || !C.roomPaintLayers(rm)[level].visible) continue;
                    const strokes = r.shapes.filter(s => s.roomId === rm.id && s.decoration === level && s.visible !== false);
                    if (!strokes.length) continue;
                    bc.setTransform(1, 0, 0, 1, 0, 0);
                    bc.clearRect(0, 0, buffer.width, buffer.height);
                    bc.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale);
                    for (const s of strokes) shape(bc, r, s);
                    cc.save();
                    cc.globalAlpha = C.roomPaintLayers(rm)[level].opacity;
                    cc.drawImage(buffer, 0, 0, buffer.width, buffer.height, area.x, area.y, buffer.width / scale, buffer.height / scale);
                    cc.restore();
                }
                for (const cat of [ "draft", "geometry" ]) {
                    if (r.categories[cat]?.visible === false) continue;
                    for (const depth of cat === "geometry" ? backgrounds ? [ 2, 1, 0 ] : [ 0 ] : [ null ]) {
                        bc.setTransform(1, 0, 0, 1, 0, 0);
                        bc.clearRect(0, 0, buffer.width, buffer.height);
                        bc.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale);
                        for (const s of r.shapes) if (!s.decoration && C.paintLayerVisible(r, s) && C.roomVisible(r, s) && s.layer === l.id && (s.eraseAll || category(s) === cat && (depth === null || (s.depth || 0) === depth))) shape(bc, r, s);
                        cc.save();
                        cc.globalAlpha = depth === null ? 1 : [ 1, .35, .15 ][depth];
                        cc.drawImage(buffer, 0, 0, buffer.width, buffer.height, area.x, area.y, buffer.width / scale, buffer.height / scale);
                        cc.restore();
                    }
                }
                if (r.categories.water?.visible !== false) {
                    bc.setTransform(1, 0, 0, 1, 0, 0);
                    bc.clearRect(0, 0, buffer.width, buffer.height);
                    bc.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale);
                    for (const s of r.shapes) if (!s.decoration && C.paintLayerVisible(r, s) && C.roomVisible(r, s) && s.layer === l.id && (s.material === "water" || s.eraseAll)) {
                        if (s.erase || s.eraseAll) shape(bc, r, s); else water(bc, r, s, z);
                    }
                    cc.drawImage(buffer, 0, 0, buffer.width, buffer.height, area.x, area.y, buffer.width / scale, buffer.height / scale);
                }
                if (r.categories.geometry?.visible !== false) for (const rm of r.rooms) if (rm.layer === l.id && C.roomVisible(r, rm) && C.roomPaintLayers(rm)[0].visible) for (const s of C.shelterFixedShapes(rm)) {
                    cc.save();
                    cc.fillStyle = s.material === "air" || s.rawCell?.[0] === 7 ? rm.background || air : ink;
                    cc.fillRect(s.x, s.y, s.w, s.h);
                    if (s.rawCell?.[0] === 7) {
                        cc.fillStyle = ink;
                        rawGeometry(cc, s);
                    }
                    cc.restore();
                }
                const faded = r.rooms.filter(rm => rm.layer === l.id && C.roomVisible(r, rm) && C.opacity(rm) < 1);
                if (faded.length) {
                    bc.setTransform(1, 0, 0, 1, 0, 0);
                    bc.clearRect(0, 0, buffer.width, buffer.height);
                    bc.save();
                    bc.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale);
                    bc.fillStyle = "#000000";
                    for (const rm of faded) {
                        bc.globalAlpha = 1 - C.opacity(rm);
                        bc.fillRect(rm.x, rm.y, rm.w, rm.h);
                    }
                    bc.restore();
                    cc.save();
                    cc.globalCompositeOperation = "destination-out";
                    cc.drawImage(buffer, 0, 0, buffer.width, buffer.height, area.x, area.y, buffer.width / scale, buffer.height / scale);
                    cc.restore();
                }
                c.save();
                c.globalAlpha *= C.opacity(l);
                c.drawImage(composite, 0, 0, composite.width, composite.height, area.x, area.y, composite.width / scale, composite.height / scale);
                c.restore();
            }
            for (const stroke of activeShapes || (activeShape ? [ activeShape ] : [])) shape(c, r, stroke, {
                hint: true
            });
            c.restore();
        };
    }
    function createCached(createCanvas, {maxPixels: maxPixels = 8e6} = {}) {
        const paint = create(createCanvas), entries = new Map;
        let pixels = 0, renders = 0, hits = 0;
        const drop = key => {
            const e = entries.get(key);
            if (e) {
                pixels -= e.pixels;
                e.canvas.width = e.canvas.height = 1;
                entries.delete(key);
            }
        };
        function cached(c, r, z, options = {}, source = r, variant = "") {
            const backgrounds = options.backgrounds ?? z >= 2, m = c.getTransform?.(), effective = Math.max(z, m ? Math.hypot(m.a, m.b) : z), scale = effective >= 1 ? Math.ceil(effective) : 2 ** Math.ceil(Math.log2(Math.max(.01, effective))), tileSize = Math.max(1, Math.floor(512 / scale));
            let view = {
                x: 0,
                y: 0,
                w: r.w,
                h: r.h
            };
            if (m && m.a > 0 && m.d > 0 && Math.abs(m.b) + Math.abs(m.c) < 1e-5 && c.canvas) {
                view = C.intersection(view, {
                    x: -m.e / m.a,
                    y: -m.f / m.d,
                    w: c.canvas.width / m.a,
                    h: c.canvas.height / m.d
                });
                if (!view) return;
            }
            for (const [key, e] of entries) if (e.region === r.id && (e.source !== source || e.scale !== scale || e.variant !== variant || e.backgrounds !== backgrounds)) drop(key);
            const prefix = r.id + ":" + variant + ":" + backgrounds + ":" + scale + ":";
            for (let ty = Math.floor(view.y / tileSize); ty < Math.ceil((view.y + view.h) / tileSize); ty++) for (let tx = Math.floor(view.x / tileSize); tx < Math.ceil((view.x + view.w) / tileSize); tx++) {
                const box = {
                    x: tx * tileSize,
                    y: ty * tileSize,
                    w: Math.min(tileSize, r.w - tx * tileSize),
                    h: Math.min(tileSize, r.h - ty * tileSize)
                }, key = prefix + tx + ":" + ty;
                let e = entries.get(key);
                if (!e) {
                    const width = Math.max(1, Math.ceil(box.w * scale)), height = Math.max(1, Math.ceil(box.h * scale)), cost = width * height;
                    while (pixels + cost > maxPixels && entries.size) drop(entries.keys().next().value);
                    const raster = createCanvas(width, height), rc = raster.getContext("2d");
                    rc.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
                    rc.imageSmoothingEnabled = false;
                    const tileRegion = {
                        ...r,
                        shapes: r.shapes.filter(s => C.intersection(C.bounds(s), box)),
                        rooms: r.rooms
                    };
                    paint(rc, tileRegion, z, {
                        ...options,
                        backgrounds: backgrounds,
                        rasterBounds: box,
                        rasterScale: scale,
                        activeShape: null,
                        activeShapes: null
                    });
                    e = {
                        region: r.id,
                        source: source,
                        scale: scale,
                        variant: variant,
                        backgrounds: backgrounds,
                        box: box,
                        canvas: raster,
                        pixels: cost
                    };
                    entries.set(key, e);
                    pixels += cost;
                    renders++;
                } else {
                    hits++;
                    entries.delete(key);
                    entries.set(key, e);
                }
                c.save();
                c.imageSmoothingEnabled = false;
                if (m && m.a > 0 && m.d > 0 && Math.abs(m.b) + Math.abs(m.c) < 1e-5) {
                    const x = Math.round(box.x * m.a + m.e), y = Math.round(box.y * m.d + m.f), right = Math.round((box.x + box.w) * m.a + m.e), bottom = Math.round((box.y + box.h) * m.d + m.f);
                    c.setTransform(1, 0, 0, 1, 0, 0);
                    c.drawImage(e.canvas, 0, 0, box.w * scale, box.h * scale, x, y, right - x, bottom - y);
                } else c.drawImage(e.canvas, 0, 0, box.w * scale, box.h * scale, box.x, box.y, box.w, box.h);
                c.restore();
            }
            for (const stroke of options.activeShapes || (options.activeShape ? [ options.activeShape ] : [])) shape(c, r, stroke, {
                hint: true
            });
        }
        cached.clear = () => {
            for (const key of [ ...entries.keys() ]) drop(key);
        };
        cached.stats = () => ({
            pixels: pixels,
            entries: entries.size,
            renders: renders,
            hits: hits
        });
        return cached;
    }
    function symbolPainter(createCanvas) {
        let masks = new WeakMap;
        const paint = (c, img, x, y, size, z) => {
            const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
            if (!iw || !ih) return;
            let mask = masks.get(img);
            if (!mask) {
                mask = createCanvas(iw, ih);
                const mc = mask.getContext("2d");
                mc.drawImage(img, 0, 0);
                mc.globalCompositeOperation = "source-in";
                mc.fillStyle = "#000000";
                mc.fillRect(0, 0, iw, ih);
                masks.set(img, mask);
            }
            const scale = Math.min(size / iw, size / ih), ww = iw * scale, hh = ih * scale, px = x - ww / 2, py = y - hh / 2, d = .65 / z;
            c.save();
            c.imageSmoothingEnabled = false;
            for (const [dx, dy] of [ [ -d, 0 ], [ d, 0 ], [ 0, -d ], [ 0, d ] ]) c.drawImage(mask, px + dx, py + dy, ww, hh);
            c.drawImage(img, px, py, ww, hh);
            c.restore();
        };
        paint.clear = () => masks = new WeakMap;
        return paint;
    }
    return {
        create: create,
        createCached: createCached,
        symbolPainter: symbolPainter,
        shape: shape,
        hintColors: hintColors,
        ink: ink,
        air: air
    };
});
