(function(root, factory) {
    const api = factory();
    if (typeof module === "object") module.exports = api; else root.OCMapCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    "use strict";
    let serial = 0;
    const uid = () => "m" + Date.now().toString(36) + (++serial).toString(36) + Math.random().toString(36).slice(2, 7), clone = v => JSON.parse(JSON.stringify(v));
    const categories = {
        gate: "业力门",
        shelter: "庇护所",
        echo: "回响",
        shop: "拾荒者商店",
        toll: "收费站",
        creature: "生物刷新",
        pearl: "珍珠",
        token: "竞技场代币",
        broadcast: "广播",
        iterator: "迭代器 AI"
    };
    const materials = {
        draft: "自由剪影",
        solid: "实体墙",
        air: "空气 / 擦除",
        platform: "单向台阶",
        beamH: "横杆",
        beamV: "竖杆",
        slopeRU: "斜坡 ◢",
        slopeLU: "斜坡 ◣",
        slopeRD: "斜坡 ◥",
        slopeLD: "斜坡 ◤",
        crawl: "狭窄通道",
        shortcut: "捷径路径",
        water: "水体"
    };
    const portKinds = {
        exit: "跨房间通道井",
        internal: "同房间通道井",
        den: "生物巢穴",
        creature: "生物专用井",
        scavenger: "拾荒者井"
    };
    const portDirections = {
        auto: "自动",
        up: "朝上",
        down: "朝下",
        left: "朝左",
        right: "朝右"
    };
    function regionLabelColor(w, r) {
        return w.settings.regionLabelMode === "uniform" ? w.settings.regionLabelColor || "#ffffff" : r.labelColor || "#ffffff";
    }
    function regionRecordMatches(docs, r) {
        const normal = v => String(v || "").normalize("NFKC").toLowerCase().trim(), names = [ r.name, r.english ].map(normal).filter(s => s.length > 1), code = normal(r.code), token = code ? new RegExp("(^|[^a-z0-9_])" + code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^a-z0-9_])", "i") : null;
        return docs.filter(d => !d.archived).map(d => {
            const title = normal(d.title), region = normal(d.details?.region), body = normal([ d.content, d.details?.synopsis, d.details?.description, d.details?.comment ].filter(Boolean).join("\n"));
            let score = d.id === r.textDocId ? 100 : 0;
            if (names.includes(title) || title === code) score += 40;
            if (names.includes(region) || region === code) score += 30;
            if (names.some(s => title.includes(s))) score += 20;
            if (names.some(s => body.includes(s)) || token?.test(body)) score += 10;
            return {
                doc: d,
                score: score
            };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.doc);
    }
    function portPose(r, p) {
        if (![ "exit", "internal", "creature" ].includes(p.kind)) return {
            x: p.x,
            y: p.y,
            angle: 0,
            direction: "none",
            dx: 0,
            dy: 0
        };
        const vectors = {
            up: {
                dx: 0,
                dy: -1,
                angle: Math.PI
            },
            down: {
                dx: 0,
                dy: 1,
                angle: 0
            },
            left: {
                dx: -1,
                dy: 0,
                angle: Math.PI / 2
            },
            right: {
                dx: 1,
                dy: 0,
                angle: -Math.PI / 2
            }
        };
        let direction = Object.hasOwn(vectors, p.facing) ? p.facing : null;
        if (!direction) {
            const room = r.rooms.find(rm => rm.id === p.roomId), box = room || {
                x: 0,
                y: 0,
                w: r.w,
                h: r.h
            };
            const edges = [ [ "down", Math.abs(p.y - box.y) ], [ "up", Math.abs(box.y + box.h - p.y) ], [ "right", Math.abs(p.x - box.x) ], [ "left", Math.abs(box.x + box.w - p.x) ] ].sort((a, b) => a[1] - b[1]);
            const shapes = r.shapes.filter(s => s.layer === p.layer && !(s.depth > 0) && (!s.roomId || s.roomId === p.roomId));
            const solid = point => {
                if (!inside(point, box)) return true;
                for (let i = shapes.length - 1; i >= 0; i--) {
                    const s = shapes[i];
                    if (![ "solid", "draft", "air", "crawl", "slopeRU", "slopeLU", "slopeRD", "slopeLD" ].includes(s.material) || !hitShape(s, point)) continue;
                    return !s.erase && ![ "air", "crawl" ].includes(s.material);
                }
                return false;
            };
            const open = Object.keys(vectors).filter(key => {
                const v = vectors[key];
                return !solid({
                    x: p.x + v.dx,
                    y: p.y + v.dy
                });
            });
            direction = open.length === 1 ? open[0] : edges.find(([key]) => open.includes(key))?.[0] || edges[0][0];
        }
        const v = vectors[direction];
        return {
            x: p.x + v.dx * .75,
            y: p.y + v.dy * .75,
            direction: direction,
            ...v
        };
    }
    function workspace() {
        const s = {
            id: uid(),
            name: "默认地图",
            regions: [],
            placements: {}
        };
        return {
            format: "rw-oc-region",
            version: 1,
            scenes: [ s ],
            regions: [],
            gates: [],
            activeScene: s.id,
            settings: {
                favorites: brushFavorites(),
                backgroundHideBelow: 2,
                iconScale: 1,
                snapAlignment: true,
                undoVisible: true,
                undoLocked: true,
                canvasBackground: "#000000",
                showRegionBounds: false,
                grid: true,
                selectionColor: "#ffffff",
                showZoom: false,
                toolbarPosition: "bottom-right",
                presentationVersion: 5
            },
            exportSettings: {
                dependencies: []
            },
            presets: []
        };
    }
    const brushNames = {
        brush: "画笔",
        line: "直线",
        rect: "矩形",
        ellipse: "圆形",
        polygon: "多边形",
        fill: "油漆桶"
    };
    function brushFavorites(value = {}) {
        const fallback = [ {
            tool: "brush",
            width: 3
        }, {
            tool: "line",
            width: 1
        }, {
            tool: "rect",
            width: 1
        } ];
        return {
            brushes: fallback.map((d, i) => {
                const p = value?.brushes?.[i] || d, tool = Object.hasOwn(brushNames, p.tool) ? p.tool : d.tool, autoName = p.autoName === true || !p.name || /^笔刷\s*[123]$/.test(p.name);
                return {
                    name: autoName ? brushNames[tool] : String(p.name).slice(0, 32),
                    autoName: autoName,
                    tool: tool,
                    width: Math.max(.1, Math.min(100, Number(p.width) || d.width))
                };
            }),
            materials: [ "draft", "solid", "air" ].map((d, i) => Object.hasOwn(materials, value?.materials?.[i]) ? value.materials[i] : d),
            shortcuts: Object.fromEntries(Object.entries(value?.shortcuts || {}).filter(([k, v]) => /^(brush[123]|material[123]|nextBrush|nextMaterial|eraser)$/.test(k) && typeof v === "string" && v.length < 80))
        };
    }
    function shortcutChord(e) {
        if ([ "Control", "Shift", "Alt", "Meta" ].includes(e.key)) return "";
        const key = e.code || (/^\w$/.test(e.key || "") ? "Key" + e.key.toUpperCase() : e.key);
        return [ e.ctrlKey ? "Ctrl" : null, e.metaKey ? "Meta" : null, e.altKey ? "Alt" : null, e.shiftKey ? "Shift" : null, key ].filter(Boolean).join("+");
    }
    function backgroundsShown(settings, z) {
        const v = Number(settings?.backgroundHideBelow ?? 2);
        return v === 0 || z >= v;
    }
    function connectPorts(r, fromId, toId) {
        const a = r.ports.find(p => p.id === fromId), b = r.ports.find(p => p.id === toId);
        if (!a || !b) throw Error("通道井不存在。");
        if (a === b) throw Error("请选择另一个通道井。");
        for (const p of [ a, b ]) {
            const reason = lockReason(r, p, "ports");
            if (reason) throw Error(reason);
            if (p.kind === "den") throw Error("生物巢穴不建立房间连接。");
            if (!p.roomId) throw Error("请先把通道井放进房间。");
        }
        if ((a.kind === "internal" || b.kind === "internal") && a.roomId !== b.roomId) throw Error("同房间通道井的两端必须在同一房间。");
        if (r.links.some(l => l.a === a.id && l.b === b.id || l.a === b.id && l.b === a.id)) throw Error("这两个通道井已经连接。");
        const link = {
            id: uid(),
            a: a.id,
            b: b.id
        };
        r.links.push(link);
        r.categories.connections.visible = true;
        return link;
    }
    function shelterAtPort(r, p) {
        if (p.kind !== "exit" || r.rooms.find(rm => rm.id === p.roomId)?.roomType === "SHELTER") return null;
        for (const link of r.links) {
            const other = link.a === p.id ? link.b : link.b === p.id ? link.a : null;
            if (!other) continue;
            const target = r.ports.find(q => q.id === other), rm = r.rooms.find(rm => rm.id === target?.roomId);
            if (rm?.roomType === "SHELTER") return rm;
        }
        return null;
    }
    function connectShelter(r, host, shelter, position) {
        if (!host || !shelter || host.id === shelter.id || shelter.roomType !== "SHELTER") throw Error("请选择独立的庇护所房间。");
        for (const rm of [ host, shelter ]) {
            const reason = lockReason(r, rm, "rooms");
            if (reason) throw Error(reason);
        }
        if (r.categories.ports.locked) throw Error("通道井已锁定。");
        const p = position || {
            x: Math.floor(host.x + host.w / 2),
            y: Math.floor(host.y + host.h / 2)
        };
        if (!inside(p, host)) throw Error("入口需要位于当前房间内。");
        const ids = new Set(r.ports.filter(p => p.roomId === shelter.id && p.kind === "exit").map(p => p.id)), link = r.links.find(l => ids.has(l.a) || ids.has(l.b)), other = link && r.ports.find(p => p.id === (ids.has(link.a) ? link.b : link.a));
        if (other) {
            if (other.roomId !== host.id) throw Error("这个庇护所已有入口，请先断开原连接。");
            if (lockReason(r, other, "ports")) throw Error("原入口已锁定。");
            syncShelterPort(r, shelter);
            Object.assign(other, p);
            return other;
        }
        const endpoint = (rm, at) => ({
            id: uid(),
            kind: "exit",
            name: "庇护所入口",
            roomId: rm.id,
            layer: rm.layer,
            facing: "auto",
            ...at
        }), existing = r.ports.find(q => q.roomId === host.id && q.kind === "exit" && Math.hypot(q.x - p.x, q.y - p.y) < .75), a = existing || endpoint(host, p);
        let b = r.ports.find(q => ids.has(q.id));
        for (const port of [ existing, b ].filter(Boolean)) {
            const reason = lockReason(r, port, "ports");
            if (reason) throw Error(reason);
        }
        if (!existing) r.ports.push(a);
        if (!b) {
            b = endpoint(shelter, {
                x: shelter.x + 3.5,
                y: shelter.y + Math.floor(shelter.h / 2) + .5
            });
            r.ports.push(b);
        }
        syncShelterPort(r, shelter);
        b = r.ports.find(q => q.roomId === shelter.id && q.kind === "exit");
        connectPorts(r, a.id, b.id);
        r.categories.shelter.visible = true;
        return a;
    }
    function region(name = "未命名区域", english = "New Region", w = 280, h = 160) {
        return {
            id: uid(),
            name: name,
            english: english,
            code: regionInitials(english) || "RG",
            codeAuto: true,
            w: w,
            h: h,
            bg: "#000000",
            air: "#ffffff",
            color: "#000000",
            outline: "#000000",
            border: "#ffffff",
            layers: [ {
                id: uid(),
                name: "地表",
                visible: true,
                locked: false
            } ],
            shapes: [],
            rooms: [],
            markers: [],
            ports: [],
            links: [],
            refs: [],
            categories: Object.fromEntries([ "draft", "geometry", "water", "rooms", "roomNames", "cameras", "ports", "connections", "refs", ...Object.keys(categories) ].map(k => [ k, {
                visible: [ "draft", "geometry", "water", "refs", "shelter" ].includes(k),
                locked: false
            } ])),
            symmetry: {
                x: false,
                y: false,
                axisX: w / 2,
                axisY: h / 2,
                axisColor: "#ffffff",
                axisWidth: 2
            },
            geoDepth: 0
        };
    }
    function regionInitials(english) {
        return (String(english || "").replace(/['’]/g, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").match(/[A-Za-z0-9]+/g) || []).map(word => word[0]).join("").toUpperCase();
    }
    function setRegionCode(r, code) {
        code = String(code).trim().toUpperCase();
        if (!/^[A-Z0-9]+$/.test(code)) throw Error("区域简称只能包含英文字母和数字。");
        const old = r.code, next = r.rooms.map(rm => rm.name.startsWith(old + "_") ? code + rm.name.slice(old.length) : rm.name.startsWith("GATE_") ? rm.name.split("_").map((part, i) => i && part === old ? code : part).join("_") : rm.name);
        if (new Set(next).size !== next.length) throw Error("修改简称会导致房间重名。");
        r.rooms.forEach((rm, i) => rm.name = next[i]);
        r.code = code;
    }
    const roomHandles = [ "nw", "n", "ne", "e", "se", "s", "sw", "w" ];
    function roomHandlePoints(room) {
        return {
            nw: {
                x: room.x,
                y: room.y
            },
            n: {
                x: room.x + room.w / 2,
                y: room.y
            },
            ne: {
                x: room.x + room.w,
                y: room.y
            },
            e: {
                x: room.x + room.w,
                y: room.y + room.h / 2
            },
            se: {
                x: room.x + room.w,
                y: room.y + room.h
            },
            s: {
                x: room.x + room.w / 2,
                y: room.y + room.h
            },
            sw: {
                x: room.x,
                y: room.y + room.h
            },
            w: {
                x: room.x,
                y: room.y + room.h / 2
            }
        };
    }
    function hitRoomHandle(room, p, tolerance) {
        const points = roomHandlePoints(room);
        for (const k of [ "nw", "ne", "se", "sw" ]) if (Math.hypot(p.x - points[k].x, p.y - points[k].y) <= tolerance) return k;
        if (p.x >= room.x - tolerance && p.x <= room.x + room.w + tolerance) {
            if (Math.abs(p.y - room.y) <= tolerance) return "n";
            if (Math.abs(p.y - room.y - room.h) <= tolerance) return "s";
        }
        if (p.y >= room.y - tolerance && p.y <= room.y + room.h + tolerance) {
            if (Math.abs(p.x - room.x) <= tolerance) return "w";
            if (Math.abs(p.x - room.x - room.w) <= tolerance) return "e";
        }
        return null;
    }
    function roomResizeBox(r, room, handle, dx, dy) {
        if (!roomHandles.includes(handle)) throw Error("无效的房间控制点。");
        let left = room.x, top = room.y, right = room.x + room.w, bottom = room.y + room.h;
        dx = Math.round(dx);
        dy = Math.round(dy);
        if (handle.includes("w")) left = Math.max(0, Math.min(right - 1, left + dx));
        if (handle.includes("e")) right = Math.min(r.w, Math.max(left + 1, right + dx));
        if (handle.includes("n")) top = Math.max(0, Math.min(bottom - 1, top + dy));
        if (handle.includes("s")) bottom = Math.min(r.h, Math.max(top + 1, bottom + dy));
        return {
            x: left,
            y: top,
            w: right - left,
            h: bottom - top
        };
    }
    function resizeRoom(r, room, box) {
        if (room.locked || r.layers.find(l => l.id === room.layer)?.locked || r.categories.rooms?.locked) throw Error("房间或图层已锁定。");
        if (![ "x", "y", "w", "h" ].every(k => Number.isInteger(box[k])) || box.w < 1 || box.h < 1 || box.x < 0 || box.y < 0 || box.x + box.w > r.w || box.y + box.h > r.h) throw Error("房间超出区域范围。");
        if (r.rooms.some(other => other.id !== room.id && other.layer === room.layer && intersection(other, box))) throw Error("不能与同层房间重叠。");
        const pointUpdates = [], distance = (p, b) => Math.max(0, b.x - p.x, p.x - b.x - b.w, b.y - p.y, p.y - b.y - b.h);
        for (const [list, items] of [ [ "markers", r.markers ], [ "ports", r.ports ] ]) for (const o of items) {
            if (o.roomId !== room.id || isRoomMarker(o) || room.roomType === "SHELTER" && o.kind === "exit") continue;
            let point = {
                x: o.x,
                y: o.y
            };
            if (list === "ports" && distance(o, room) < 1e-6) {
                let anchored = false;
                for (const [axis, size] of [ [ "x", "w" ], [ "y", "h" ] ]) {
                    if (Math.abs(o[axis] - room[axis]) < 1e-6) {
                        point[axis] = box[axis];
                        anchored = true;
                    } else if (Math.abs(o[axis] - room[axis] - room[size]) < 1e-6) {
                        point[axis] = box[axis] + box[size];
                        anchored = true;
                    }
                }
                if (anchored) {
                    point.x = Math.max(box.x, Math.min(box.x + box.w, point.x));
                    point.y = Math.max(box.y, Math.min(box.y + box.h, point.y));
                }
            }
            if (distance(point, box) > distance(o, room) + 1e-6) throw Error("边界会越过房间里的" + (list === "ports" ? "通道井" : "标记") + "「" + (o.name || portKinds[o.kind] || categories[o.kind] || o.id) + "」，请先移动它再缩小边界。");
            if (point.x !== o.x || point.y !== o.y) {
                const reason = lockReason(r, o, list === "ports" ? "ports" : o.kind);
                if (reason) throw Error(reason + "；边界通道井需要随房间边缘移动。");
                pointUpdates.push([ o, point ]);
            }
        }
        if (room.roomType === "SHELTER" && !shelterEditableBounds({
            ...room,
            ...box
        })) throw Error("庇护所至少需要 14 × 7 格；门机构和围墙不能缩掉。");
        const previous = {
            x: room.x,
            y: room.y,
            w: room.w,
            h: room.h
        }, surface = room.water >= 0 ? room.y + room.h - room.water : null, coords = new Set, next = [];
        for (const camera of room.cameras) {
            const x = Math.max(0, Math.min(Math.max(0, box.w - 70), camera.x + room.x - box.x)), y = Math.max(0, Math.min(Math.max(0, box.h - 40), camera.y + room.y - box.y)), key = x + "," + y;
            if (!coords.has(key)) {
                coords.add(key);
                next.push({
                    ...camera,
                    x: x,
                    y: y
                });
            }
        }
        if (!next.length || box.w > room.w || box.h > room.h) for (const camera of cameras(box.w, box.h)) {
            const key = camera.x + "," + camera.y;
            if (!coords.has(key)) {
                coords.add(key);
                next.push(camera);
            }
        }
        if (room.roomType === "SHELTER") clipShelterEdits(r, r.shapes.filter(s => s.roomId === room.id).map(s => s.id));
        for (const [o, point] of pointUpdates) Object.assign(o, point);
        Object.assign(room, box, {
            cameras: next,
            water: surface === null ? -1 : Math.max(-1, Math.min(box.h, box.y + box.h - surface))
        });
        if (box.w > previous.w || box.h > previous.h) cutShapes(r, room);
        syncShelterPort(r, room);
        return room;
    }
    function snapTargets(r, {excludeId: excludeId = null, excludeContents: excludeContents = false, includeRegion: includeRegion = true, sceneId: sceneId = null, symmetry: symmetry = null, isDisplayed: isDisplayed = () => true} = {}) {
        const axes = {
            x: new Map,
            y: new Map
        }, add = (axis, value, lo, hi) => {
            if (![ value, lo, hi ].every(Number.isFinite)) return;
            const key = Math.round(value * 1e4) / 1e4, old = axes[axis].get(key);
            if (old) {
                old.lo = Math.min(old.lo, lo);
                old.hi = Math.max(old.hi, hi);
            } else axes[axis].set(key, {
                value: key,
                lo: lo,
                hi: hi
            });
        }, point = p => {
            add("x", p.x, p.y, p.y);
            add("y", p.y, p.x, p.x);
        }, box = b => {
            if (![ b.x, b.y, b.w, b.h ].every(Number.isFinite)) return;
            for (const x of [ b.x, b.x + b.w / 2, b.x + b.w ]) add("x", x, b.y, b.y + b.h);
            for (const y of [ b.y, b.y + b.h / 2, b.y + b.h ]) add("y", y, b.x, b.x + b.w);
        };
        const visible = o => isDisplayed(o) && o.id !== excludeId && !(excludeContents && o.roomId === excludeId) && roomVisible(r, o) && r.layers.find(l => l.id === o.layer)?.visible !== false && objectOpacity(r, o) > 0;
        if (includeRegion) box({
            x: 0,
            y: 0,
            w: r.w,
            h: r.h
        });
        for (const rm of r.rooms) {
            if (!visible(rm)) continue;
            box(rm);
            if (r.categories.cameras.visible) for (const camera of rm.cameras) box({
                x: rm.x + camera.x,
                y: rm.y + camera.y,
                w: 70,
                h: 40
            });
        }
        for (const s of r.shapes) {
            const cat = s.material === "draft" ? "draft" : s.material === "water" ? "water" : "geometry";
            if (!visible(s) || r.categories[cat].visible === false) continue;
            let b = intersection(bounds(s), {
                x: 0,
                y: 0,
                w: r.w,
                h: r.h
            });
            const rm = s.roomId ? r.rooms.find(o => o.id === s.roomId) : null;
            if (b && rm) b = intersection(b, rm);
            if (!b) continue;
            box(b);
            if (s.points) for (const p of s.points) if (p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h) point(p);
        }
        for (const list of [ "markers", "ports" ]) for (const o of r[list]) {
            const cat = list === "markers" ? o.kind : "ports";
            if (!(list === "ports" && r.detailsVisible === false) && visible(o) && r.categories[cat]?.visible !== false && (!sceneId || !o.sceneIds?.length || o.sceneIds.includes(sceneId))) point(o);
        }
        if (r.categories.refs.visible) for (const ref of r.refs) if (visible(ref) && opacity(ref) > 0) box(ref);
        if (symmetry?.y) add("x", symmetry.axisX, 0, r.h);
        if (symmetry?.x) add("y", symmetry.axisY, 0, r.w);
        return {
            x: [ ...axes.x.values() ],
            y: [ ...axes.y.values() ]
        };
    }
    function snapBox(box, targets, tolerance, {handle: handle = "move", valid: valid = () => true} = {}) {
        const move = handle === "move", candidates = axis => {
            const position = axis === "x" ? "x" : "y", size = axis === "x" ? "w" : "h", low = axis === "x" ? "w" : "n", high = axis === "x" ? "e" : "s";
            let anchors = move ? [ box[position], box[position] + box[size] / 2, box[position] + box[size] ] : handle.includes(low) ? [ box[position] ] : handle.includes(high) ? [ box[position] + box[size] ] : [];
            const found = new Map;
            for (const anchor of anchors) for (const target of targets[axis]) {
                const delta = target.value - anchor;
                if (Math.abs(delta) > tolerance || Math.abs(delta - Math.round(delta)) > 1e-6) continue;
                const d = Math.round(delta);
                if (!found.has(d)) found.set(d, {
                    delta: d,
                    target: target
                });
            }
            return [ ...found.values() ].sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta)).slice(0, 8).concat({
                delta: 0,
                target: null
            });
        };
        const pairs = [];
        for (const x of candidates("x")) for (const y of candidates("y")) pairs.push({
            x: x,
            y: y,
            matches: Number(!!x.target) + Number(!!y.target),
            cost: Math.abs(x.delta) + Math.abs(y.delta)
        });
        pairs.sort((a, b) => b.matches - a.matches || a.cost - b.cost);
        for (const p of pairs) {
            const next = {
                ...box
            };
            if (move) {
                next.x += p.x.delta;
                next.y += p.y.delta;
            } else {
                if (handle.includes("w")) {
                    next.x += p.x.delta;
                    next.w -= p.x.delta;
                } else if (handle.includes("e")) next.w += p.x.delta;
                if (handle.includes("n")) {
                    next.y += p.y.delta;
                    next.h -= p.y.delta;
                } else if (handle.includes("s")) next.h += p.y.delta;
            }
            if (!valid(next)) continue;
            const guides = [];
            for (const axis of [ "x", "y" ]) if (p[axis].target) {
                const other = axis === "x" ? "y" : "x", size = axis === "x" ? "h" : "w", target = p[axis].target;
                guides.push({
                    axis: axis,
                    value: target.value,
                    lo: Math.min(target.lo, next[other]),
                    hi: Math.max(target.hi, next[other] + next[size])
                });
            }
            return {
                box: next,
                guides: guides
            };
        }
        return {
            box: {
                ...box
            },
            guides: []
        };
    }
    function regionContentBounds(r) {
        const boxes = r.rooms.map(rm => ({
            x: rm.x,
            y: rm.y,
            w: rm.w,
            h: rm.h
        })), area = {
            x: 0,
            y: 0,
            w: r.w,
            h: r.h
        };
        for (const s of r.shapes) {
            let b = intersection(bounds(s), area);
            const rm = s.roomId ? r.rooms.find(o => o.id === s.roomId) : null;
            if (b && rm) b = intersection(b, rm);
            if (b) boxes.push(b);
        }
        for (const p of [ ...r.markers, ...r.ports ]) boxes.push({
            x: p.x,
            y: p.y,
            w: 0,
            h: 0
        });
        if (!boxes.length) return null;
        const x = Math.floor(Math.min(...boxes.map(b => b.x))), y = Math.floor(Math.min(...boxes.map(b => b.y))), right = Math.ceil(Math.max(...boxes.map(b => b.x + b.w))), bottom = Math.ceil(Math.max(...boxes.map(b => b.y + b.h)));
        return {
            x: x,
            y: y,
            w: right - x,
            h: bottom - y
        };
    }
    function regionResizeBox(r, handle, dx, dy) {
        if (!roomHandles.includes(handle)) throw Error("无效的区域控制点。");
        const content = regionContentBounds(r), minW = Math.min(20, r.w), minH = Math.min(20, r.h);
        let left = 0, top = 0, right = r.w, bottom = r.h;
        dx = Math.round(dx);
        dy = Math.round(dy);
        if (handle.includes("w")) left = Math.max(right - 4096, Math.min(dx, right - minW, content?.x ?? Infinity));
        if (handle.includes("e")) right = Math.min(4096, Math.max(r.w + dx, minW, content ? content.x + content.w : 0));
        if (handle.includes("n")) top = Math.max(bottom - 4096, Math.min(dy, bottom - minH, content?.y ?? Infinity));
        if (handle.includes("s")) bottom = Math.min(4096, Math.max(r.h + dy, minH, content ? content.y + content.h : 0));
        return {
            x: left,
            y: top,
            w: right - left,
            h: bottom - top
        };
    }
    function resizeRegion(workspace, r, box) {
        if (![ "x", "y", "w", "h" ].every(k => Number.isInteger(box[k])) || box.w < Math.min(20, r.w) || box.h < Math.min(20, r.h) || box.w > 4096 || box.h > 4096) throw Error("区域宽高需要 20–4096 的整数格。");
        const b = regionContentBounds(r);
        if (b && (b.x < box.x || b.y < box.y || b.x + b.w > box.x + box.w || b.y + b.h > box.y + box.h)) throw Error("新范围不能裁掉已有房间、草稿或标记。");
        if (box.x === 0 && box.y === 0 && r.w === box.w && r.h === box.h) return r;
        if (box.x || box.y) {
            for (const list of [ "rooms", "shapes", "markers", "ports", "refs" ]) for (const o of r[list]) shift(o, -box.x, -box.y);
            for (const scene of workspace.scenes) if (scene.regions.includes(r.id)) {
                const p = scene.placements[r.id] || {
                    x: 0,
                    y: 0
                };
                scene.placements[r.id] = {
                    x: p.x + box.x,
                    y: p.y + box.y
                };
            }
            r.origin = {
                x: (r.origin?.x || 0) + box.x,
                y: (r.origin?.y || 0) + box.y
            };
            if (r.symmetry?.centerCustom) {
                r.symmetry.axisX -= box.x;
                r.symmetry.axisY -= box.y;
            }
        }
        r.w = box.w;
        r.h = box.h;
        if (r.symmetry && !r.symmetry.centerCustom) {
            r.symmetry.axisX = r.w / 2;
            r.symmetry.axisY = r.h / 2;
        }
        return r;
    }
    function symmetryFor(r, room = null) {
        const base = r.symmetry || {}, box = room || {
            x: 0,
            y: 0,
            w: r.w,
            h: r.h
        }, center = room ? room.symmetryCenter : base.centerCustom ? {
            x: base.axisX,
            y: base.axisY
        } : null;
        return {
            ...base,
            axisColor: /^#[a-f0-9]{6}$/i.test(base.axisColor) ? base.axisColor : "#ffffff",
            axisWidth: Math.max(1, Math.min(8, Number(base.axisWidth) || 2)),
            axisX: box.x + (center ? Math.max(0, Math.min(box.w, center.x)) : box.w / 2),
            axisY: box.y + (center ? Math.max(0, Math.min(box.h, center.y)) : box.h / 2)
        };
    }
    function setSymmetryCenter(r, room, p) {
        const box = room || {
            x: 0,
            y: 0,
            w: r.w,
            h: r.h
        }, x = Math.max(0, Math.min(box.w, p.x - box.x)), y = Math.max(0, Math.min(box.h, p.y - box.y));
        if (room) room.symmetryCenter = {
            x: x,
            y: y
        }; else Object.assign(r.symmetry, {
            axisX: x,
            axisY: y,
            centerCustom: true
        });
    }
    function resetSymmetryCenter(r, room) {
        if (room) delete room.symmetryCenter; else {
            r.symmetry.centerCustom = false;
            r.symmetry.axisX = r.w / 2;
            r.symmetry.axisY = r.h / 2;
        }
    }
    function partitionRoom(r, box) {
        if (r.categories.rooms.locked || r.layers.find(l => l.id === box.layer)?.locked) throw Error("房间或图层已锁定。");
        const hits = r.rooms.filter(rm => rm.layer === box.layer && intersection(rm, box));
        if (!hits.length) return addRoom(r, box);
        if (hits.length > 1) throw Error("选框跨越多个房间，请调整边界。");
        let rm = hits[0];
        if (rm.locked) throw Error("房间已锁定。");
        if (box.x < rm.x || box.y < rm.y || box.x + box.w > rm.x + rm.w || box.y + box.h > rm.y + rm.h) throw Error("选框需要完整位于一个房间内，或位于空白处。");
        if (box.x > rm.x) rm = splitRoom(r, rm, true, box.x - rm.x);
        if (box.w < rm.w) {
            const id = rm.id;
            splitRoom(r, rm, true, box.w);
            rm = r.rooms.find(o => o.id === id);
        }
        if (box.y > rm.y) rm = splitRoom(r, rm, false, box.y - rm.y);
        if (box.h < rm.h) {
            const id = rm.id;
            splitRoom(r, rm, false, box.h);
            rm = r.rooms.find(o => o.id === id);
        }
        return rm;
    }
    function rect(a, b) {
        return {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            w: Math.max(1, Math.abs(a.x - b.x)),
            h: Math.max(1, Math.abs(a.y - b.y))
        };
    }
    function intersection(a, b) {
        const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), r = Math.min(a.x + a.w, b.x + b.w), d = Math.min(a.y + a.h, b.y + b.h);
        return r > x && d > y ? {
            x: x,
            y: y,
            w: r - x,
            h: d - y
        } : null;
    }
    function inside(p, r) {
        return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
    }
    function deleteRoom(w, r, id) {
        const rm = r.rooms.find(rm => rm.id === id);
        if (!rm) return;
        const reason = lockReason(r, rm, "rooms");
        if (reason) throw Error(reason);
        const owned = o => o.roomId === id || !o.roomId && o.layer === rm.layer && inside(o, rm) && (!o.w || o.x + o.w <= rm.x + rm.w) && (!o.h || o.y + o.h <= rm.y + rm.h), ports = new Set(r.ports.filter(owned).map(p => p.id)), markers = new Set(r.markers.filter(owned).map(m => m.id));
        r.shapes = r.shapes.flatMap(s => s.roomId === id ? [] : !s.roomId && s.layer === rm.layer && intersection(bounds(s), rm) ? subtract(bounds(s), rm).map(clip => ({
            ...clone(s),
            id: uid(),
            clip: clip
        })) : [ s ]);
        for (const key of [ "markers", "ports", "refs" ]) r[key] = r[key].filter(o => !owned(o));
        r.links = r.links.filter(l => !ports.has(l.a) && !ports.has(l.b));
        w.gates = w.gates.filter(g => ![ g.a, g.b ].some(side => side.region === r.id && markers.has(side.marker)));
        r.rooms = r.rooms.filter(o => o.id !== id);
    }
    function bounds(s) {
        if (s.clip) return s.clip;
        if (s.points) {
            const xs = s.points.map(p => p.x), ys = s.points.map(p => p.y), b = s.width / 2 || .5;
            return {
                x: Math.min(...xs) - b,
                y: Math.min(...ys) - b,
                w: Math.max(...xs) - Math.min(...xs) + 2 * b,
                h: Math.max(...ys) - Math.min(...ys) + 2 * b
            };
        }
        return s;
    }
    function subtract(a, b) {
        const i = intersection(a, b);
        if (!i) return [ a ];
        return [ {
            x: a.x,
            y: a.y,
            w: a.w,
            h: i.y - a.y
        }, {
            x: a.x,
            y: i.y + i.h,
            w: a.w,
            h: a.y + a.h - i.y - i.h
        }, {
            x: a.x,
            y: i.y,
            w: i.x - a.x,
            h: i.h
        }, {
            x: i.x + i.w,
            y: i.y,
            w: a.x + a.w - i.x - i.w,
            h: i.h
        } ].filter(r => r.w > 0 && r.h > 0);
    }
    function cutShapes(r, box, from = null) {
        const out = [];
        for (const s of r.shapes) {
            if ((s.roomId || null) !== from || s.layer !== box.layer) {
                out.push(s);
                continue;
            }
            const b = bounds(s), i = intersection(b, box);
            if (!i) {
                out.push(s);
                continue;
            }
            out.push(...subtract(b, box).map(clip => ({
                ...clone(s),
                id: uid(),
                clip: clip
            })), {
                ...clone(s),
                id: uid(),
                clip: i,
                roomId: box.id
            });
        }
        r.shapes = out;
    }
    function cameras(w, h) {
        const positions = (n, size, step) => {
            if (n <= size) return [ 0 ];
            let a = [];
            for (let i = 0; i < n - size; i += step) a.push(i);
            a.push(n - size);
            return [ ...new Set(a) ];
        };
        return positions(w, 70, 68).flatMap(x => positions(h, 40, 38).map(y => ({
            id: uid(),
            x: x,
            y: y
        })));
    }
    const paintLayerNames = [ "Geometry", "背景 · 淡色", "背景 · 更淡" ];
    function roomPaintLayers(rm) {
        return rm.paintLayers || [ 1, .35, .15 ].map(opacity => ({
            visible: true,
            locked: false,
            opacity: opacity
        }));
    }
    function paintLayerVisible(r, s) {
        const rm = s.roomId ? r.rooms.find(rm => rm.id === s.roomId) : null;
        return !rm || roomPaintLayers(rm)[s.decoration || 0]?.visible !== false;
    }
    function addRoom(r, box) {
        const b = {
            ...rect({
                x: box.x,
                y: box.y
            }, {
                x: box.x + box.w,
                y: box.y + box.h
            }),
            layer: box.layer
        };
        if (b.x < 0 || b.y < 0 || b.x + b.w > r.w || b.y + b.h > r.h) throw Error("房间超出了区域边界，请先扩展区域。");
        if (r.rooms.some(v => v.layer === b.layer && intersection(v, b))) throw Error("同一空间层级的房间不能重叠；请选择已有房间进行切分。");
        const room = {
            ...b,
            id: uid(),
            name: nextRoomName(r, "ROOM", box.layer),
            roomType: "ROOM",
            visible: true,
            locked: false,
            paintLayers: roomPaintLayers({}),
            water: -1,
            background: r.air || "#ffffff",
            cameras: cameras(b.w, b.h)
        };
        r.rooms.push(room);
        cutShapes(r, room);
        for (const o of [ ...r.markers, ...r.ports ]) if (!o.roomId && o.layer === room.layer && inside(o, room)) o.roomId = room.id;
        return room;
    }
    function shift(s, dx, dy) {
        if (s.x !== undefined) {
            s.x += dx;
            s.y += dy;
        }
        if (s.points) s.points.forEach(p => {
            p.x += dx;
            p.y += dy;
        });
        if (s.clip) {
            s.clip.x += dx;
            s.clip.y += dy;
        }
    }
    function moveRoom(r, room, dx, dy) {
        if (room.locked) throw Error("房间已锁定。");
        dx = Math.round(Math.max(-room.x, Math.min(dx, r.w - room.x - room.w)));
        dy = Math.round(Math.max(-room.y, Math.min(dy, r.h - room.y - room.h)));
        if (r.rooms.some(v => v.id !== room.id && v.layer === room.layer && intersection(v, {
            ...room,
            x: room.x + dx,
            y: room.y + dy
        }))) throw Error("当前位置与同层房间重叠。可先切换空间层级。");
        shift(room, dx, dy);
        for (const o of [ ...r.shapes, ...r.markers, ...r.ports, ...r.refs ]) if (o.roomId === room.id) shift(o, dx, dy);
    }
    function splitRoom(r, room, vertical, at) {
        if (room.roomType === "SHELTER") throw Error("固定庇护所不能切开；请新建独立庇护所或先改为普通房间。");
        const axis = vertical ? "x" : "y", size = vertical ? "w" : "h";
        at = Math.round(at);
        if (at <= 0 || at >= room[size]) throw Error("切分位置必须在房间内部。");
        const a = {
            ...clone(room),
            [size]: at,
            cameras: []
        }, b = {
            ...clone(room),
            id: uid(),
            name: nextRoomName(r, room.roomType || "ROOM", room.layer, room.gateTo),
            [axis]: room[axis] + at,
            [size]: room[size] - at,
            cameras: []
        };
        delete b.symmetryCenter;
        a.cameras = cameras(a.w, a.h);
        b.cameras = cameras(b.w, b.h);
        if (room.water >= 0) {
            const surface = room.y + room.h - room.water;
            for (const child of [ a, b ]) {
                const height = Math.max(0, Math.min(child.h, child.y + child.h - surface));
                child.water = height > 0 ? height : -1;
            }
        }
        cutShapes(r, b, room.id);
        r.rooms.splice(r.rooms.indexOf(room), 1, a, b);
        for (const o of [ ...r.markers, ...r.ports, ...r.refs ]) if (o.roomId === room.id && inside(o, b)) o.roomId = b.id;
        if (room.roomType === "SHELTER") organizeShelters(r);
        if (room.roomType === "GATE") organizeGates(r);
        return b;
    }
    function selectedRooms(r, ids) {
        const unique = [ ...new Set(ids) ], rooms = unique.map(id => r.rooms.find(rm => rm.id === id));
        if (!rooms.length || rooms.some(rm => !rm)) throw Error("请重新选择房间。");
        return rooms;
    }
    function selectRooms(r, lid, box) {
        return box ? r.rooms.filter(rm => rm.layer === lid && roomVisible(r, rm) && r.layers.find(l => l.id === rm.layer)?.visible !== false && intersection(rm, box)).map(rm => ({
            list: "rooms",
            id: rm.id
        })) : [];
    }
    function moveRooms(r, ids, dx, dy) {
        const rooms = selectedRooms(r, ids), set = new Set(ids);
        for (const rm of rooms) {
            const reason = lockReason(r, rm, "rooms");
            if (reason) throw Error(reason);
        }
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw Error("移动距离无效。");
        const box = selectionBounds(r, rooms.map(rm => ({
            list: "rooms",
            id: rm.id
        })));
        dx = Math.max(-box.x, Math.min(Math.round(dx), r.w - box.x - box.w));
        dy = Math.max(-box.y, Math.min(Math.round(dy), r.h - box.y - box.h));
        if (!dx && !dy) return {
            dx: 0,
            dy: 0
        };
        for (const rm of rooms) if (r.rooms.some(other => !set.has(other.id) && other.layer === rm.layer && intersection(other, {
            ...rm,
            x: rm.x + dx,
            y: rm.y + dy
        }))) throw Error("移动后会与未选中的同层房间重叠。");
        if (r.shapes.some(shape => !shape.roomId && rooms.some(rm => rm.layer === shape.layer && intersection(bounds(shape), rm)))) {
            const prepared = {
                ...r,
                shapes: r.shapes
            };
            for (const rm of rooms) cutShapes(prepared, rm);
            if (prepared.shapes.length > 3e4) throw Error("移动后的轮廓超过上限。");
            r.shapes = prepared.shapes;
        }
        for (const key of [ "markers", "ports", "refs" ]) for (const o of r[key]) if (!o.roomId) {
            const owner = rooms.find(rm => rm.layer === o.layer && inside(o, rm));
            if (owner) o.roomId = owner.id;
        }
        for (const rm of rooms) shift(rm, dx, dy);
        for (const key of [ "shapes", "markers", "ports", "refs" ]) for (const o of r[key]) if (set.has(o.roomId)) shift(o, dx, dy);
        return {
            dx: dx,
            dy: dy
        };
    }
    function roomMergePlan(r, ids) {
        const rooms = selectedRooms(r, ids);
        if (rooms.length < 2) throw Error("至少框选两个房间。");
        if (rooms.some(rm => rm.roomType === "GATE" || rm.roomType === "SHELTER")) throw Error("业力门和庇护所不能合并，请从选区中移除。");
        for (const rm of rooms) {
            const reason = lockReason(r, rm, "rooms");
            if (reason) throw Error(reason);
        }
        if (rooms.some(rm => rm.layer !== rooms[0].layer)) throw Error("只能合并同一空间层级的房间。");
        const set = new Set(ids), box = selectionBounds(r, rooms.map(rm => ({
            list: "rooms",
            id: rm.id
        })));
        if (r.rooms.some(rm => !set.has(rm.id) && rm.layer === rooms[0].layer && intersection(rm, box))) throw Error("合并范围包含未选中的房间，请一并选中或调整范围。");
        const surfaces = [ ...new Set(rooms.filter(rm => rm.water >= 0).map(rm => rm.y + rm.h - rm.water)) ];
        if (surfaces.length > 1) throw Error("房间水面高度不同，请先统一水面再合并。");
        return {
            rooms: rooms,
            box: box,
            water: surfaces.length ? Math.max(0, Math.min(box.h, box.y + box.h - surfaces[0])) : -1
        };
    }
    function mergeSelectedRooms(r, ids) {
        const {rooms: rooms, box: box, water: water} = roomMergePlan(r, ids), keep = rooms[0], set = new Set(ids), original = new Map(rooms.map(rm => [ rm.id, {
            ...rm
        } ]));
        r.shapes = r.shapes.filter(shape => {
            const owner = original.get(shape.roomId);
            if (!owner) return true;
            const clip = intersection(bounds(shape), owner);
            if (!clip) return false;
            shape.clip = clip;
            return true;
        });
        if (keep.symmetryCenter) keep.symmetryCenter = {
            x: keep.symmetryCenter.x + keep.x - box.x,
            y: keep.symmetryCenter.y + keep.y - box.y
        };
        Object.assign(keep, box, {
            water: water,
            cameras: cameras(box.w, box.h)
        });
        r.rooms = r.rooms.filter(rm => !set.has(rm.id) || rm.id === keep.id);
        for (const key of [ "shapes", "markers", "ports", "refs" ]) for (const o of r[key]) if (set.has(o.roomId)) o.roomId = keep.id;
        return keep;
    }
    function mergeRooms(r, a, b) {
        return mergeSelectedRooms(r, [ a?.id, b?.id ]);
    }
    function forkRegion(w, scene, id) {
        const source = w.regions.find(r => r.id === id), r = clone(source), ids = new Map;
        const remap = v => {
            if (!ids.has(v)) ids.set(v, uid());
            return ids.get(v);
        };
        r.id = remap(id);
        for (const list of [ "layers", "shapes", "rooms", "markers", "ports", "links", "refs" ]) for (const o of r[list]) {
            o.id = remap(o.id);
            for (const key of [ "roomId", "layer", "returnLayer", "a", "b" ]) if (o[key]) o[key] = remap(o[key]);
        }
        scene.regions = scene.regions.map(v => v === id ? r.id : v);
        if (scene.placements[id]) scene.placements[r.id] = clone(scene.placements[id]);
        w.regions.push(r);
        for (const g of [ ...w.gates ]) if (g.scenes.includes(scene.id) && (g.a.region === id || g.b.region === id)) {
            g.scenes = g.scenes.filter(x => x !== scene.id);
            const ng = {
                ...clone(g),
                id: uid(),
                scenes: [ scene.id ]
            };
            for (const side of [ "a", "b" ]) if (ng[side].region === id) {
                ng[side].region = r.id;
                if (ng[side].marker) ng[side].marker = remap(ng[side].marker);
            }
            w.gates.push(ng);
        }
        return r;
    }
    function mirrored(s, sym) {
        let items = [ clone(s) ];
        for (const axis of [ "x", "y" ]) if (sym[axis]) {
            items.push(...items.map(original => {
                const q = clone(original), coord = axis === "x" ? "y" : "x", size = axis === "x" ? "h" : "w", mid = axis === "x" ? sym.axisY : sym.axisX;
                if (q.points) q.points.forEach(p => p[coord] = 2 * mid - p[coord]); else q[coord] = 2 * mid - q[coord] - (q[size] || 0);
                if (q.clip) q.clip[coord] = 2 * mid - q.clip[coord] - q.clip[size];
                const slopes = axis === "x" ? {
                    slopeRU: "slopeRD",
                    slopeRD: "slopeRU",
                    slopeLU: "slopeLD",
                    slopeLD: "slopeLU"
                } : {
                    slopeRU: "slopeLU",
                    slopeLU: "slopeRU",
                    slopeRD: "slopeLD",
                    slopeLD: "slopeRD"
                };
                q.material = slopes[q.material] || q.material;
                return q;
            }));
        }
        return items.map(x => ({
            ...x,
            id: uid()
        }));
    }
    function hitShape(s, p) {
        if (!inside(p, bounds(s))) return false;
        if (s.type === "ellipse") return ((p.x - s.x - s.w / 2) / (s.w / 2)) ** 2 + ((p.y - s.y - s.h / 2) / (s.h / 2)) ** 2 <= 1;
        if (s.points) {
            if (s.type === "polygon") {
                let hit = false;
                for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i++) {
                    const a = s.points[i], b = s.points[j];
                    if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
                }
                return hit;
            }
            for (let i = 1; i < s.points.length; i++) {
                const a = s.points[i - 1], b = s.points[i], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
                if (Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= (s.width || 1) / 2) return true;
            }
            return s.points.length === 1 && Math.hypot(p.x - s.points[0].x, p.y - s.points[0].y) <= (s.width || 1) / 2;
        }
        return inside(p, s);
    }
    function raster(r, room, {unprotected: unprotected = false} = {}) {
        if (room.w * room.h > 3e5) throw Error("单房间超过 30 万格，请切分后导出。");
        const blank = () => [ 0, [] ], cells = Array.from({
            length: room.w
        }, () => Array.from({
            length: room.h
        }, () => [ blank(), blank(), blank() ])), types = {
            solid: 1,
            air: 0,
            crawl: 0,
            slopeRU: 2,
            slopeLU: 3,
            slopeRD: 4,
            slopeLD: 5,
            platform: 6
        };
        for (const level of [ 0, 1, 2 ]) {
            const background = level ? Array.from({
                length: room.w
            }, () => Array.from({
                length: room.h
            }, blank)) : null;
            for (const s of r.shapes) {
                if ((s.decoration || 0) !== level || s.material === "water" || s.layer !== room.layer || s.roomId && s.roomId !== room.id) continue;
                const b = intersection(bounds(s), room);
                if (!b) continue;
                for (let x = Math.max(0, Math.floor(b.x - room.x)); x < Math.min(room.w, Math.ceil(b.x + b.w - room.x)); x++) for (let y = Math.max(0, Math.floor(b.y - room.y)); y < Math.min(room.h, Math.ceil(b.y + b.h - room.y)); y++) if (hitShape(s, {
                    x: room.x + x + .5,
                    y: room.y + y + .5
                })) {
                    const d = level || (s.material === "draft" ? 2 : s.depth || 0);
                    if (s.rawCell) {
                        if (level) background[x][y] = clone(s.rawCell); else cells[x][y][d] = clone(s.rawCell);
                        continue;
                    }
                    if (s.eraseAll) {
                        if (level) background[x][y] = blank(); else cells[x][y] = [ blank(), blank(), blank() ];
                        continue;
                    }
                    const c = level ? background[x][y] : cells[x][y][d];
                    if (s.erase || s.material === "air") {
                        c[0] = 0;
                        c[1] = [];
                        continue;
                    }
                    if (s.material === "draft") {
                        c[0] = 1;
                        continue;
                    }
                    if (s.material in types) {
                        c[0] = types[s.material];
                        if (s.material === "crawl") c[1] = [];
                    } else {
                        const f = {
                            beamH: 1,
                            beamV: 2,
                            shortcut: 5
                        }[s.material];
                        if (f && !c[1].includes(f)) c[1].push(f);
                    }
                }
            }
            if (level) for (let x = 0; x < room.w; x++) for (let y = 0; y < room.h; y++) if (background[x][y][0] || background[x][y][1].length) cells[x][y][level] = background[x][y];
        }
        return room.roomType === "SHELTER" && !unprotected ? protectShelterGeometry(cells, room).geometry : cells;
    }
    function shelterLayout(rm) {
        const turn = {
            left: 0,
            up: 1,
            right: 2,
            down: 3
        }[rm.shelterFacing] || 0, w = turn % 2 ? rm.h : rm.w, h = turn % 2 ? rm.w : rm.h, position = Math.max(3, Math.min(h - 4, Number.isInteger(rm.shelterOffset) ? rm.shelterOffset : Math.floor(h / 2))), offset = turn >= 2 ? h - 1 - position : position;
        return {
            turn: turn,
            w: w,
            h: h,
            offset: offset,
            position: position
        };
    }
    function turnPoint(p, w, h, turn) {
        for (let i = 0; i < turn; i++) {
            p = {
                x: h - p.y,
                y: p.x
            };
            [w, h] = [ h, w ];
        }
        return p;
    }
    function turnBox(box, w, h, turn) {
        const p = turnPoint({
            x: box.x,
            y: box.y
        }, w, h, turn), q = turnPoint({
            x: box.x + box.w,
            y: box.y + box.h
        }, w, h, turn);
        return {
            x: Math.min(p.x, q.x),
            y: Math.min(p.y, q.y),
            w: Math.abs(q.x - p.x),
            h: Math.abs(q.y - p.y)
        };
    }
    function turnCell(cell, turn) {
        const out = clone(cell);
        for (let i = 0; i < turn; i++) {
            out[0] = {
                2: 3,
                3: 5,
                5: 4,
                4: 2
            }[out[0]] ?? out[0];
            out[1] = out[1].map(f => f === 1 ? 2 : f === 2 ? 1 : f);
        }
        return out;
    }
    function turnGeometry(geo, turn) {
        for (let i = 0; i < turn; i++) {
            const w = geo.length, h = geo[0].length, next = Array.from({
                length: h
            }, () => Array(w));
            for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) next[h - 1 - y][x] = geo[x][y].map(c => turnCell(c, 1));
            geo = next;
        }
        return geo;
    }
    function shelterEditableBounds(rm) {
        if (rm.roomType !== "SHELTER") return null;
        const {turn: turn, w: w, h: h} = shelterLayout(rm);
        if (w < 14 || h < 7) return null;
        const box = turnBox({
            x: 10,
            y: 1,
            w: w - 11,
            h: h - 2
        }, w, h, turn);
        return {
            ...box,
            x: rm.x + box.x,
            y: rm.y + box.y
        };
    }
    function shelterFixedShapes(rm) {
        if (!shelterEditableBounds(rm)) return [];
        const {turn: turn, w: w, h: h, offset: y} = shelterLayout(rm), base = {
            layer: rm.layer,
            roomId: rm.id,
            depth: 0,
            type: "rect",
            material: "solid",
            shelterFixed: true
        };
        return [ {
            x: 0,
            y: 0,
            w: 10,
            h: h
        }, {
            x: 10,
            y: 0,
            w: w - 10,
            h: 1
        }, {
            x: 10,
            y: h - 1,
            w: w - 10,
            h: 1
        }, {
            x: w - 1,
            y: 1,
            w: 1,
            h: h - 2
        }, {
            x: 4,
            y: y,
            w: 6,
            h: 1,
            material: "air"
        }, {
            x: 3,
            y: y,
            w: 1,
            h: 1,
            rawCell: [ 7, [ 4 ] ]
        }, {
            x: 2,
            y: y,
            w: 1,
            h: 1,
            rawCell: [ 1, [ 5 ] ]
        }, {
            x: 1,
            y: y,
            w: 1,
            h: 1,
            rawCell: [ 1, [ 6 ] ]
        } ].map(s => {
            const box = turnBox(s, w, h, turn);
            return {
                ...base,
                ...s,
                ...box,
                x: rm.x + box.x,
                y: rm.y + box.y
            };
        });
    }
    function protectShelterGeometry(source, {repairInterior: repairInterior = false, shelterFacing: shelterFacing = "left", shelterOffset: shelterOffset} = {}) {
        const layout = shelterLayout({
            w: source.length,
            h: source[0]?.length || 0,
            shelterFacing: shelterFacing,
            shelterOffset: shelterOffset
        }), {turn: turn, w: w, h: h, offset: y} = layout, geometry = turnGeometry(clone(source), (4 - turn) % 4);
        if (w < 14 || h < 7) return {
            geometry: clone(source),
            repairs: [],
            issues: [ {
                code: "SHELTER_SIZE",
                message: "庇护所沿入口方向至少需要 14 × 7 格（上下朝向为 7 × 14 格），以容纳固定门机构、封闭墙体和可编辑内室。"
            } ]
        };
        let changed = 0;
        for (let x = 0; x < w; x++) for (let yy = 0; yy < h; yy++) if (x < 10 || x === w - 1 || yy === 0 || yy === h - 1) {
            let c = [ 1, [] ];
            if (yy === y) {
                if (x === 1) c = [ 1, [ 6 ] ]; else if (x === 2) c = [ 1, [ 5 ] ]; else if (x === 3) c = [ 7, [ 4 ] ]; else if (x >= 4 && x < 10) c = [ 0, [] ];
            }
            if (JSON.stringify(c) !== JSON.stringify(geometry[x][yy][0])) changed++;
            geometry[x][yy][0] = c;
        }
        for (let x = 5; x <= 9; x++) for (let yy = y - 2; yy <= y + 2; yy++) {
            if (geometry[x][yy][1][0] !== 1 || geometry[x][yy][1][1].length) changed++;
            geometry[x][yy][1] = [ 1, [] ];
        }
        if (repairInterior && geometry[10][y][0][0] === 1) for (let x = 10; x <= 12; x++) for (let yy = y - 1; yy <= y + 1; yy++) {
            if (geometry[x][yy][0][0] || geometry[x][yy][0][1].length) changed++;
            geometry[x][yy][0] = [ 0, [] ];
        }
        const rotated = turnGeometry(geometry, turn), issues = shelterGeometryIssues(rotated);
        if (geometry[10][y][0][0] === 1) issues.push({
            code: "SHELTER_CHAMBER_BLOCKED",
            message: "内室紧接门机构的位置被实体墙堵住；请清空门与红框相接处，让门通向内室。"
        });
        return {
            geometry: rotated,
            issues: issues,
            repairs: changed ? [ {
                code: "SHELTER_FIXED_STRUCTURE",
                cells: changed,
                message: "已按固定庇护所预设校正门机构、入口和四周实体墙（" + changed + " 格）；只保留内室的可编辑地形。"
            } ] : []
        };
    }
    function configureShelter(r, rm, {shelterFacing: shelterFacing = rm.shelterFacing || "left", shelterOffset: shelterOffset} = {}) {
        const reason = lockReason(r, rm, "rooms");
        if (reason) throw Error(reason);
        if (rm.roomType !== "SHELTER") throw Error("请选择庇护所房间。");
        const old = shelterLayout(rm), turn = {
            left: 0,
            up: 1,
            right: 2,
            down: 3
        }[shelterFacing];
        if (turn === undefined) throw Error("无效的庇护所朝向。");
        const delta = (turn - old.turn + 4) % 4, ww = delta % 2 ? rm.h : rm.w, hh = delta % 2 ? rm.w : rm.h, box = {
            x: rm.x,
            y: rm.y,
            w: ww,
            h: hh
        };
        if (box.x + ww > r.w || box.y + hh > r.h) throw Error("旋转后超出区域，请先移动房间或扩大区域。");
        if (r.rooms.some(o => o.id !== rm.id && o.layer === rm.layer && intersection(o, box))) throw Error("旋转后与同层房间重叠，请先移动房间。");
        if (delta) {
            clipShelterEdits(r, r.shapes.filter(o => o.roomId === rm.id).map(o => o.id));
            for (const key of [ "shapes", "markers", "ports", "refs" ]) for (const o of r[key].filter(o => o.roomId === rm.id)) {
                const point = p => {
                    const q = turnPoint({
                        x: p.x - rm.x,
                        y: p.y - rm.y
                    }, rm.w, rm.h, delta);
                    return {
                        x: rm.x + q.x,
                        y: rm.y + q.y
                    };
                }, rect = b => {
                    const q = turnBox({
                        x: b.x - rm.x,
                        y: b.y - rm.y,
                        w: b.w,
                        h: b.h
                    }, rm.w, rm.h, delta);
                    return {
                        ...q,
                        x: rm.x + q.x,
                        y: rm.y + q.y
                    };
                };
                if (o.points) o.points = o.points.map(point); else if (key === "refs") {
                    const p = point({
                        x: o.x + o.w / 2,
                        y: o.y + o.h / 2
                    });
                    o.x = p.x - o.w / 2;
                    o.y = p.y - o.h / 2;
                    o.angle = (o.angle || 0) + delta * 90;
                } else if (o.w !== undefined && o.h !== undefined) Object.assign(o, rect(o)); else Object.assign(o, point(o));
                if (o.clip) o.clip = rect(o.clip);
                for (let i = 0; i < delta; i++) {
                    o.material = {
                        beamH: "beamV",
                        beamV: "beamH",
                        slopeRU: "slopeLU",
                        slopeLU: "slopeLD",
                        slopeLD: "slopeRD",
                        slopeRD: "slopeRU"
                    }[o.material] || o.material;
                    if (o.facing) o.facing = {
                        right: "down",
                        down: "left",
                        left: "up",
                        up: "right"
                    }[o.facing] || o.facing;
                }
                if (o.rawCell) o.rawCell = turnCell(o.rawCell, delta);
            }
            Object.assign(rm, box, {
                cameras: cameras(ww, hh)
            });
            delete rm.rainedSource;
            delete rm.rainedSize;
        }
        rm.shelterFacing = shelterFacing;
        if (shelterOffset !== undefined) rm.shelterOffset = shelterOffset; else if (delta) rm.shelterOffset = turn >= 2 ? old.h - 1 - old.offset : old.offset;
        rm.shelterOffset = shelterLayout(rm).position;
        syncShelterPort(r, rm);
        return rm;
    }
    function clipShelterEdits(r, ids) {
        const changed = new Set(ids);
        r.shapes = r.shapes.filter(s => {
            if (!changed.has(s.id)) return true;
            const rm = r.rooms.find(rm => rm.id === s.roomId);
            if (rm?.roomType !== "SHELTER") return true;
            const area = shelterEditableBounds(rm), clip = area && intersection(bounds(s), area);
            if (!clip) return false;
            s.clip = clip;
            return true;
        });
    }
    function syncShelterPort(r, rm) {
        if (rm.roomType !== "SHELTER" || !shelterEditableBounds(rm)) return;
        const ports = r.ports.filter(p => p.roomId === rm.id && p.kind === "exit"), keep = ports.find(p => r.links.some(l => l.a === p.id || l.b === p.id)) || ports[0], {turn: turn, w: w, h: h, offset: offset} = shelterLayout(rm), p = turnPoint({
            x: 3.5,
            y: offset + .5
        }, w, h, turn);
        if (!keep) return;
        if (ports.length > 1) {
            const duplicates = new Set(ports.filter(p => p !== keep).map(p => p.id));
            r.ports = r.ports.filter(p => !duplicates.has(p.id));
            const seen = new Set;
            r.links = r.links.filter(l => {
                if (duplicates.has(l.a)) l.a = keep.id;
                if (duplicates.has(l.b)) l.b = keep.id;
                const key = [ l.a, l.b ].sort().join("|");
                if (l.a === l.b || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }
        Object.assign(keep, {
            x: rm.x + p.x,
            y: rm.y + p.y,
            facing: [ "right", "down", "left", "up" ][turn]
        });
    }
    function shelterPresetData(options = {}) {
        const vertical = [ "up", "down" ].includes(options.shelterFacing), w = options.w || (vertical ? 9 : 20), h = options.h || (vertical ? 20 : 9), r = region("庇护所", "Shelter", w, h), rm = addRoom(r, {
            x: 0,
            y: 0,
            w: w,
            h: h,
            layer: r.layers[0].id
        });
        Object.assign(rm, {
            roomType: "SHELTER",
            shelterFacing: options.shelterFacing || "left",
            shelterOffset: options.shelterOffset
        });
        const data = parseRainedRoom(rainedText(r, rm));
        data.shelterOptions = {
            shelterFacing: rm.shelterFacing,
            shelterOffset: shelterLayout(rm).position
        };
        return data;
    }
    function shelterDoorTile(rm) {
        const {turn: turn, w: w, h: h, offset: offset} = shelterLayout(rm), p = turnPoint({
            x: 7.5,
            y: offset + .5
        }, w, h, turn);
        return {
            x: Math.floor(p.x),
            y: Math.floor(p.y),
            name: [ "shelter gate W", "shelter gate N", "shelter gate E", "shelter gate S" ][turn],
            index: [ 4, 1, 2, 3 ][turn]
        };
    }
    function lingoListItems(source) {
        const s = source.trim();
        if (s[0] !== "[" || s.at(-1) !== "]") throw Error("房间贴块数据格式无效。");
        const items = [];
        let start = 1, depth = 0, quoted = false;
        for (let i = 1; i < s.length - 1; i++) {
            const c = s[i];
            if (c === '"' && s[i - 1] !== "\\") quoted = !quoted;
            if (quoted) continue;
            if (c === "[" || c === "(") depth++; else if (c === "]" || c === ")") depth--; else if (c === "," && !depth) {
                items.push(s.slice(start, i).trim());
                start = i + 1;
            }
        }
        if (s.slice(start, -1).trim()) items.push(s.slice(start, -1).trim());
        return items;
    }
    function shelterTileLine(line, rm) {
        if (!shelterEditableBounds(rm)) return line;
        const match = /#tlMatrix\s*:\s*/i.exec(line);
        if (!match) throw Error("庇护所缺少贴块矩阵，无法补齐门机构。");
        const start = match.index + match[0].length;
        let end = start, depth = 0, quoted = false;
        for (;end < line.length; end++) {
            const c = line[end];
            if (c === '"' && line[end - 1] !== "\\") quoted = !quoted;
            if (quoted) continue;
            if (c === "[") depth++; else if (c === "]" && ! --depth) {
                end++;
                break;
            }
        }
        const matrix = lingoListItems(line.slice(start, end)).map(col => lingoListItems(col).map(lingoListItems));
        if (matrix.length !== rm.w || matrix.some(col => col.length !== rm.h || col.some(cell => cell.length !== 3))) throw Error("庇护所贴块尺寸与房间不一致。");
        const empty = '[#tp: "default", #data: 0]', oldHeads = new Set;
        for (let x = 0; x < rm.w; x++) for (let y = 0; y < rm.h; y++) for (let d = 0; d < 3; d++) if (/#tp\s*:\s*"tileHead"/i.test(matrix[x][y][d]) && /"shelter gate [NEWS]"/i.test(matrix[x][y][d])) {
            oldHeads.add([ x + 1, y + 1, d + 1 ].join(","));
            matrix[x][y][d] = empty;
        }
        for (const col of matrix) for (const cell of col) for (let d = 0; d < 3; d++) {
            const m = /#tp\s*:\s*"tileBody"\s*,\s*#data\s*:\s*\[\s*point\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*,\s*(\d+)\s*\]/i.exec(cell[d]);
            if (m && oldHeads.has(m.slice(1).map(Number).join(","))) cell[d] = empty;
        }
        const door = shelterDoorTile(rm);
        for (let x = door.x - 2; x <= door.x + 2; x++) for (let y = door.y - 2; y <= door.y + 2; y++) for (let d = 0; d < 2; d++) matrix[x][y][d] = x === door.x && y === door.y && d === 0 ? '[#tp: "tileHead", #data: [point(19, ' + door.index + '), "' + door.name + '"]]' : '[#tp: "tileBody", #data: [point(' + (door.x + 1) + ", " + (door.y + 1) + "), 1]]";
        const result = "[" + matrix.map(col => "[" + col.map(cell => "[" + cell.join(",") + "]").join(",") + "]").join(",") + "]";
        return line.slice(0, start) + result + line.slice(end);
    }
    function rainedText(r, room) {
        const geo = raster(r, room);
        if (room.rainedSource && room.rainedSize?.w === room.w && room.rainedSize?.h === room.h) {
            const lines = room.rainedSource.split(/\r\n|\r|\n/);
            lines[0] = JSON.stringify(geo);
            lines[6] = lines[6].replace(/#cameras\s*:\s*\[[^\]]*\]/, "#cameras: [" + room.cameras.map(c => "point(" + c.x * 20 + ", " + c.y * 20 + ")").join(",") + "]");
            lines[7] = lines[7].replace(/#waterLevel\s*:\s*-?\d+/, "#waterLevel: " + room.water);
            if (room.roomType === "SHELTER") lines[1] = shelterTileLine(lines[1], room);
            return lines.join("\r");
        }
        const tile = '[#tp: "default", #Data: 0]', tm = "[" + Array.from({
            length: room.w
        }, () => "[" + Array.from({
            length: room.h
        }, () => `[${tile},${tile},${tile}]`).join(",") + "]").join(",") + "]";
        const tileLine = `[#tlMatrix: ${tm}, #defaultMaterial: "Concrete", #workLayer: 1]`;
        return [ JSON.stringify(geo), room.roomType === "SHELTER" ? shelterTileLine(tileLine, room) : tileLine, "[#effects: []]", "[#lightAngle: 180, #flatness: 1]", "[#defaultTerrain: 0]", `[#size: point(${room.w}, ${room.h}), #extraTiles: [0,0,0,0], #tileSeed: 1, #light: 1]`, `[#cameras: [${(room.cameras.length ? room.cameras : [ {
            x: 0,
            y: 0
        } ]).map(c => `point(${c.x * 20}, ${c.y * 20})`).join(",")}]]`, `[#waterLevel: ${room.water ?? -1}, #waterInFront: 0]`, "[#props: []]" ].join("\r");
    }
    function roomShortcutInfo(geo) {
        const w = geo.length, h = geo[0]?.length || 0, dirs = [ [ -1, 0 ], [ 0, -1 ], [ 1, 0 ], [ 0, 1 ] ], within = ([x, y]) => x >= 0 && y >= 0 && x < w && y < h;
        const cell = ([x, y]) => geo[x]?.[h - 1 - y]?.[0], solid = p => cell(p)?.[0] === 1, add = (p, d) => [ p[0] + d[0], p[1] + d[1] ], same = (a, b) => a[0] === b[0] && a[1] === b[1];
        const path = p => within(p) && cell(p)[1].some(f => [ 4, 5, 6, 7, 19, 21 ].includes(f));
        const exits = [];
        function leadsOutside(start) {
            let p = start, last = start;
            const visited = new Set;
            for (let n = 0; n <= 1e3; n++) {
                const d = [ p[0] - last[0], p[1] - last[1] ], key = [ ...p, ...d ].join(",");
                if (visited.has(key)) return false;
                visited.add(key);
                let next = p;
                if ((d[0] || d[1]) && path(add(p, d))) next = add(p, d); else {
                    const turn = dirs.find(v => (v[0] !== -d[0] || v[1] !== -d[1]) && path(add(p, v)));
                    if (turn) next = add(p, turn);
                    if (same(next, last)) next = [ next[0] - d[0], next[1] - d[1] ];
                }
                if (same(next, p) || cell(next)?.[0] === 7) return false;
                const flags = cell(next)?.[1] || [];
                if (flags.includes(6)) return true;
                if (flags.some(f => [ 7, 19, 21 ].includes(f))) return false;
                last = p;
                p = next;
            }
            return false;
        }
        let exitNodes = 0;
        for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
            if (cell([ x, y ])?.[1]?.includes(6)) exitNodes++;
            if (cell([ x, y ])?.[0] === 7 && leadsOutside([ x, y ])) exits.push([ x, y ]);
        }
        return {
            exits: exits,
            exitNodes: exitNodes
        };
    }
    function shelterGeometryIssues(geo) {
        const w = geo.length, h = geo[0]?.length || 0, out = [], dirs = [ [ -1, 0 ], [ 0, -1 ], [ 1, 0 ], [ 0, 1 ] ], within = ([x, y]) => x >= 0 && y >= 0 && x < w && y < h;
        const cell = ([x, y]) => geo[x]?.[h - 1 - y]?.[0], solid = p => cell(p)?.[0] === 1, add = (p, d) => [ p[0] + d[0], p[1] + d[1] ];
        const {exits: exits} = roomShortcutInfo(geo);
        const issue = (code, at, message, details = {}) => out.push({
            code: code,
            at: at && {
                x: at[0],
                y: h - 1 - at[1]
            },
            message: message,
            ...details
        });
        if (!geo.some(col => col.some(c => c[0][0] === 1))) issue("SHELTER_NO_SOLID", null, "庇护所没有前景实体墙；自由剪影和背景层不能作为庇护所的围墙或地板。");
        if (geo.some((col, x) => col.some((c, y) => (x === 0 || y === 0 || x === w - 1 || y === h - 1) && c[0][0] !== 1))) issue("SHELTER_OPEN_BOUNDARY", null, "庇护所四周必须由实体墙完全封闭，不能用背景墙或自由剪影代替。");
        if (exits.length !== 1) issue("SHELTER_EXIT_COUNT", null, "普通庇护所需要一个完整的房间出口；地图上的入口标记不能代替实际捷径。", {
            count: exits.length
        });
        for (const start of exits) {
            const open = dirs.filter(d => !solid(add(start, d)));
            if (open.length !== 1) issue("SHELTER_ENTRANCE_DIRECTION", start, "庇护所入口需要三面实体墙和一个朝向室内的开口。");
            if (!open.length) continue;
            let p = start;
            const d = open[0];
            function walk(dir, stage) {
                for (let n = 0; n <= w + h; n++) {
                    const next = add(p, dir);
                    if (!within(next)) {
                        issue("SHELTER_UNBOUNDED_SEARCH", next, "庇护所缺少封闭实体墙或地板，游戏寻找出生位置时可能无限循环。", {
                            stage: stage,
                            direction: dir,
                            entrance: {
                                x: start[0],
                                y: h - 1 - start[1]
                            }
                        });
                        return false;
                    }
                    if (solid(next)) return true;
                    p = next;
                }
                return false;
            }
            if (!walk(d, "entry-ray")) continue;
            if (d[1] === 1 && !walk([ -1, 0 ], "left-ray")) continue;
            if (!walk([ 0, -1 ], "floor-ray")) continue;
        }
        return out;
    }
    function prepareShelterGeometry(source) {
        const geometry = clone(source), w = geometry.length, h = geometry[0]?.length || 0, before = shelterGeometryIssues(source), repairs = [];
        if (!before.length) return {
            geometry: geometry,
            issues: [],
            repairs: repairs
        };
        const empty = geometry.every(col => col.every(c => c[0][0] === 0 && !c[0][1].length));
        if (empty && w >= 10 && h >= 9) {
            const y = Math.floor(h / 2);
            geometry[1][y][0] = [ 1, [ 6 ] ];
            geometry[2][y][0] = [ 1, [ 5 ] ];
            geometry[3][y][0] = [ 7, [ 4 ] ];
            for (let x = 1; x <= 3; x++) for (const yy of [ y - 1, y + 1 ]) geometry[x][yy][0] = [ 1, [] ];
            repairs.push({
                code: "DEFAULT_SHELTER_ENTRANCE",
                message: "空白庇护所已补入默认入口；房间连接仍以连接清单为准。"
            });
        }
        const current = shelterGeometryIssues(geometry);
        if (empty || current.some(p => [ "SHELTER_UNBOUNDED_SEARCH", "SHELTER_OPEN_BOUNDARY" ].includes(p.code))) {
            let filled = 0;
            for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && geometry[x][y][0][0] === 0 && !geometry[x][y][0][1].length) {
                geometry[x][y][0] = [ 1, [] ];
                filled++;
            }
            if (filled) repairs.push({
                code: "SHELTER_BOUNDARY_WALLS",
                cells: filled,
                message: "已在房间四周空白边缘补齐 " + filled + " 格实体墙和地板。"
            });
        }
        const issues = shelterGeometryIssues(geometry);
        return {
            geometry: issues.length ? clone(source) : geometry,
            issues: issues,
            repairs: issues.length ? [] : repairs
        };
    }
    function roomConnectionIssues(r, {phase: phase = "export"} = {}) {
        const issues = [], paired = new Set, linked = new Set, owners = new Map;
        const key = (a, b) => [ a, b ].sort().join("|");
        for (const p of r.ports.filter(p => p.kind === "exit")) {
            let owner = r.rooms.find(rm => rm.id === p.roomId);
            if (!owner) {
                const near = r.rooms.filter(rm => p.x >= rm.x && p.x <= rm.x + rm.w && p.y >= rm.y && p.y <= rm.y + rm.h), same = near.filter(rm => rm.layer === p.layer);
                owner = same.length === 1 ? same[0] : near.length === 1 ? near[0] : null;
            }
            if (owner) owners.set(p.id, owner.id); else issues.push({
                code: "UNASSIGNED_ROOM_EXIT",
                message: (p.name || "跨房间通道井") + "：未能确定所属房间，请指定房间后再连接。"
            });
        }
        for (const link of r.links) {
            const a = owners.get(link.a), b = owners.get(link.b);
            if (a && b && a !== b) {
                paired.add(key(a, b));
                linked.add(a);
                linked.add(b);
            }
        }
        for (const rm of r.rooms) {
            let info;
            try {
                info = roomShortcutInfo(raster(r, rm));
            } catch (e) {
                issues.push({
                    code: "ROOM_GEOMETRY_CHECK",
                    room: rm.id,
                    message: rm.name + "：无法检查实际通道井。" + e.message
                });
                continue;
            }
            const planned = [ ...owners.values() ].filter(id => id === rm.id).length;
            if (phase === "edit") {
                if (!planned && !info.exits.length) issues.push({
                    code: "ROOM_NO_EXIT",
                    room: rm.id,
                    message: rm.name + "：尚未放置跨房间通道井，也没有完整的实际出口。请新建跨房间通道井并连接目标房间。"
                });
            } else if (!info.exits.length) issues.push({
                code: "ROOM_NO_PHYSICAL_EXIT",
                room: rm.id,
                message: rm.name + (planned ? "：已放置 " + planned + " 个跨房间通道井标记，但 Rained 地形中尚无完整的入口、捷径路径和出口节点。标记与连线保存在设计清单中，请在 Rained 完成实际捷径。" : "：没有完整的跨房间通道井。用于正常区域游玩时，至少需要一个通向房间外的实际出口；单独的图标、连线或生物巢穴不能代替。")
            }); else if (phase !== "edit" && info.exits.length !== info.exitNodes) issues.push({
                code: "ROOM_BROKEN_SHORTCUT",
                room: rm.id,
                message: rm.name + "：通道入口与房间出口节点不对应，请检查中间的捷径路径。"
            });
            if (!linked.has(rm.id)) issues.push({
                code: "ROOM_NO_DECLARED_LINK",
                room: rm.id,
                message: rm.name + "：没有登记到其他房间的跨房间连接；若要进入正常游玩区域，请设置两端通道井及双向目标。"
            });
        }
        for (let i = 0; i < r.rooms.length; i++) for (let j = i + 1; j < r.rooms.length; j++) {
            const a = r.rooms[i], b = r.rooms[j];
            if (a.layer !== b.layer || paired.has(key(a.id, b.id))) continue;
            const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            if (overlapY > 0 && (Math.abs(a.x + a.w - b.x) < .01 || Math.abs(b.x + b.w - a.x) < .01) || overlapX > 0 && (Math.abs(a.y + a.h - b.y) < .01 || Math.abs(b.y + b.h - a.y) < .01)) issues.push({
                code: "ADJACENT_ROOMS_UNLINKED",
                rooms: [ a.id, b.id ],
                message: a.name + " ↔ " + b.name + "：相邻边界不会自动连通，目前没有登记跨房间通道连接。若是同一个连续空间，请合并房间；否则补充两端通道井并连接。"
            });
        }
        return issues;
    }
    function roomGeometryIssues(r, rm) {
        try {
            const geo = raster(r, rm);
            if (rm.roomType === "SHELTER") return protectShelterGeometry(geo, rm).issues;
            const open = geo.filter(col => col[rm.h - 1][0][0] !== 1).length;
            return open ? [ {
                code: "ROOM_OPEN_BOTTOM",
                message: "房间底部有 " + open + " 格未用实体墙封闭；可能形成坠落或死亡区域。若这是有意设计，可以关闭此房间警告。"
            } ] : [];
        } catch (e) {
            return [ {
                code: "ROOM_GEOMETRY_CHECK",
                message: e.message
            } ];
        }
    }
    function roomWarnings(r, options) {
        return [ ...roomConnectionIssues(r, options), ...r.rooms.flatMap(rm => roomGeometryIssues(r, rm).map(p => ({
            ...p,
            room: rm.id,
            message: rm.name + "：" + p.message
        }))) ];
    }
    function roomWarningEnabled(settings, rm, phase = "edit") {
        const mode = settings?.roomWarningMode || "always";
        return mode !== "off" && (phase === "export" || mode === "always") && rm?.warningsDisabled !== true;
    }
    function renameGateMarker(w, rid, mid, value) {
        const r = w.regions.find(r => r.id === rid), marker = r?.markers.find(m => m.id === mid && m.kind === "gate");
        if (!marker) throw Error("业力门已不存在。");
        const name = String(value).trim();
        if (!name) throw Error("请填写业力门昵称。");
        const gates = w.gates.filter(g => g.a.marker === mid || g.b.marker === mid), targets = [ {
            r: r,
            m: marker
        } ];
        for (const g of gates) for (const side of [ g.a, g.b ]) {
            const rr = w.regions.find(r => r.id === side.region), m = rr?.markers.find(m => m.id === side.marker && m.kind === "gate");
            if (m) targets.push({
                r: rr,
                m: m
            });
        }
        for (const {r: r, m: m} of targets) {
            const reason = lockReason(r, m, "gate");
            if (reason) throw Error(reason);
        }
        for (const {m: m} of targets) m.name = name;
        for (const g of gates) g.name = name;
    }
    function saveGateConnection(w, sid, draft, id) {
        const scene = w.scenes.find(s => s.id === sid), existing = id ? w.gates.find(g => g.id === id) : null;
        if (id && !existing) throw Error("此连接已不存在。");
        const name = String(draft.name || "").trim();
        if (!name) throw Error("请填写业力门昵称。");
        if (draft.a.region === draft.b.region) throw Error("请选择两个不同区域。");
        const sameSides = existing && [ "a", "b" ].every(k => [ "region", "karma", "marker" ].every(f => String(existing[k][f] || "") === String(draft[k][f] || "")));
        const ends = [ "a", "b" ].map(k => {
            const side = draft[k], r = w.regions.find(r => r.id === side.region), m = r?.markers.find(m => m.id === side.marker && m.kind === "gate");
            if (!r || !scene.regions.includes(r.id)) throw Error("请选择当前地图中的区域。");
            if (!sameSides && !m) throw Error("请先放置并选择两侧业力门。");
            if (m) {
                const reason = lockReason(r, m, "gate");
                if (reason) throw Error(reason);
            }
            return {
                side: side,
                r: r,
                m: m
            };
        });
        const g = existing || {
            id: uid(),
            scenes: [ sid ]
        };
        Object.assign(g, {
            name: name,
            a: clone(draft.a),
            b: clone(draft.b)
        });
        for (const [index, {r: r, m: m}] of ends.entries()) {
            if (!m) continue;
            m.name = name;
            r.categories.gate.visible = true;
            if (!sameSides) {
                const target = ensureGateLayer(r);
                if (target.locked) throw Error("业力门层级已锁定。");
                const rm = ensureGateRoom(r, m, ends[1 - index].r.code);
                setRoomKind(w, r, rm, "GATE", ends[1 - index].r.code);
            }
        }
        if (!existing) w.gates.push(g);
        return g;
    }
    function exportWorkspace(w, sid, regionIds) {
        const source = w.scenes.find(s => s.id === sid);
        if (!source) throw Error("当前地图不存在。");
        const wanted = new Set(regionIds), ids = source.regions.filter(id => wanted.has(id));
        if (!ids.length) throw Error("请至少勾选一个区域。");
        const out = clone(w), selected = new Set(ids), scene = clone(source);
        scene.regions = ids;
        scene.groups = (scene.groups || []).map(g => ({
            ...g,
            regions: g.regions.filter(id => selected.has(id))
        }));
        scene.placements = Object.fromEntries(ids.map(id => [ id, clone(source.placements[id] || {
            x: 0,
            y: 0
        }) ]));
        out.scenes = [ scene ];
        out.activeScene = sid;
        out.regions = out.regions.filter(r => selected.has(r.id));
        for (const r of out.regions) {
            const omitted = new Set(r.markers.filter(m => m.kind === "gate" && m.sceneIds?.length && !m.sceneIds.includes(sid)).map(m => m.roomId));
            r.markers = r.markers.filter(m => !m.sceneIds?.length || m.sceneIds.includes(sid)).map(m => ({
                ...m,
                sceneIds: m.sceneIds?.length ? [ sid ] : []
            }));
            for (const rm of r.rooms) if (omitted.has(rm.id) && !r.markers.some(m => m.kind === "gate" && m.roomId === rm.id)) rm.gateMarkerOmitted = true;
        }
        out.gates = out.gates.filter(g => g.scenes.includes(sid) && selected.has(g.a.region) && selected.has(g.b.region)).map(g => ({
            ...g,
            scenes: [ sid ]
        }));
        return validate(out);
    }
    function rainedExportFiles(w) {
        const scene = w.scenes.find(s => s.id === w.activeScene), warnings = check(w, scene), files = {}, manifest = {
            format: "rw-oc-design-manifest",
            version: 1,
            scene: clone(scene),
            regions: clone(w.regions),
            roomTypes: w.regions.map(r => ({
                region: r.code,
                rooms: roomTypeManifest(r)
            })),
            gates: clone(w.gates),
            dependencies: exportDependencies(w, scene),
            warnings: warnings
        };
        let count = 0;
        manifest.shelterRepairs = [];
        manifest.connectionWarnings = w.regions.flatMap(roomConnectionIssues);
        manifest.roomWarnings = w.regions.flatMap(roomWarnings);
        for (const r of w.regions) for (const rm of r.rooms) {
            const safe = rm.name.replace(/[^a-z0-9_-]/gi, "_");
            if (files["rooms/" + safe + ".txt"]) throw Error("存在重名房间：" + safe);
            let text = rainedText(r, rm);
            if (rm.roomType === "SHELTER") {
                const lines = text.split("\r"), prepared = protectShelterGeometry(raster(r, rm, {
                    unprotected: true
                }), {
                    ...rm,
                    repairInterior: true
                });
                if (prepared.issues.length) throw Error(rm.name + "：庇护所类型异常，无法安全自动补齐。" + prepared.issues.map(p => p.message).join(" "));
                if (prepared.repairs.length) {
                    lines[0] = JSON.stringify(prepared.geometry);
                    text = lines.join("\r");
                    manifest.shelterRepairs.push({
                        room: rm.name,
                        repairs: prepared.repairs
                    });
                }
            }
            files["rooms/" + safe + ".txt"] = text;
            count++;
        }
        if (!count) throw Error("所选区域没有房间，请先切分房间。");
        for (const item of manifest.shelterRepairs) if (roomWarningEnabled(w.settings, w.regions.flatMap(r => r.rooms).find(rm => rm.name === item.room), "export")) warnings.push(item.room + "：" + item.repairs.map(p => p.message).join(" "));
        files["design-manifest.json"] = JSON.stringify(manifest, null, 2);
        files["README.txt"] = "Rainworld OC Collection · Rained 导出\n在 Rained 中打开 rooms/*.txt；这些是编辑工程，不是游戏运行房间。\n未经过实机导入验收。自由剪影导出为背景墙（第三几何深度），前景为空气；水体草稿、标记、通道井端点和区域连接保存在设计清单。\n请在 Rained / Dev Tools 完成水深、捷径网络、庇护所和业力门功能。\n显示、锁定和透明度不改变导出地形。淡色和更淡色背景分别导出到第二、第三深度，不产生前景碰撞。庇护所使用固定门机构和封闭围墙，内室可编辑。\n" + warnings.join("\n") + (manifest.shelterRepairs.length ? "\n\n导出副本已自动补齐庇护所；原始草稿未修改：\n" + manifest.shelterRepairs.map(o => o.room + "：" + o.repairs.map(p => p.message).join(" ")).join("\n") : "");
        return {
            files: files,
            count: count,
            repairs: manifest.shelterRepairs,
            connectionWarnings: manifest.connectionWarnings,
            roomWarnings: manifest.roomWarnings
        };
    }
    function exportDependencies(w, scene) {
        const deps = new Set(w.exportSettings?.dependencies || []);
        if (w.regions.some(r => scene.regions.includes(r.id) && r.cameraMode === "sbc")) deps.add("SBCameraScroll");
        if (w.gates.some(g => g.scenes.includes(scene.id) && [ g.a, g.b ].some(s => Number(s.karma) > 5))) deps.add("RegionKit ExtendedGates");
        return [ ...deps ];
    }
    function check(w, scene) {
        const out = [];
        if (w.settings?.roomWarningMode === "off") return out;
        if (exportDependencies(w, scene).includes("SBCameraScroll")) out.push("SBCameraScroll 已列入依赖声明，需在游戏中安装、启用并实测。");
        for (const id of scene.regions) {
            const r = w.regions.find(x => x.id === id);
            if (!r) continue;
            for (const problem of roomWarnings(r)) {
                const ids = problem.rooms || [ problem.room ];
                if (ids.some(id => roomWarningEnabled(w.settings, r.rooms.find(rm => rm.id === id), "export"))) out.push(problem.message);
            }
            if (!r.rooms.length) out.push(r.name + "：尚未切分房间。");
            if (r.shapes.some(s => s.material === "draft")) out.push(r.name + "：自由剪影将导出为第三深度的背景墙，前景保持空气。");
            if (r.shapes.some(s => s.material === "water")) out.push(r.name + "：水体草稿保留在项目；每个房间需单独填写导出水深。");
            if (r.ports.length) out.push(r.name + "：通道井与跨房间连线导出为连接清单；未自动生成可运行的捷径网络。");
            if (r.markers.length) out.push(r.name + "：标记导出为清单，游戏放置需 Dev Tools / 对应模组。");
            for (const room of r.rooms) {
                if (!roomWarningEnabled(w.settings, room, "export")) continue;
                if (room.rainedSource && (room.rainedSize?.w !== room.w || room.rainedSize?.h !== room.h)) out.push(room.name + "：导入后尺寸已改变，本次仅导出基础几何；原 Rained 材质、物件和效果需重新整理。");
                if (room.w < 70 || room.h < 40) out.push(room.name + "：尺寸小于 70×40 渲染框，需在 Rained 检查镜头覆盖。");
            }
        }
        if (w.gates.some(g => g.scenes.includes(scene.id) && [ g.a, g.b ].some(s => Number(s.karma) > 5))) out.push("业力 6–10 门需求：RegionKit ExtendedGates；需确认游戏端支持。");
        return out;
    }
    function validate(v) {
        if (!v || v.format !== "rw-oc-region" || v.version !== 1 || !Array.isArray(v.scenes) || !Array.isArray(v.regions) || !Array.isArray(v.gates) || !v.scenes.length) throw Error("这不是受支持的区域项目备份。");
        if (v.regions.length > 500 || v.scenes.length > 100) throw Error("项目规模超出支持上限。");
        const validId = x => typeof x === "string" && /^[a-z0-9_-]{1,160}$/i.test(x) && ![ "__proto__", "constructor", "prototype" ].includes(x), finite = x => typeof x === "number" && Number.isFinite(x), range = (x, a, b) => finite(x) && x >= a && x <= b, ids = new Set, scenes = new Set(v.scenes.map(s => s.id)), safe = clone(v);
        for (const r of safe.regions) {
            if (ids.has(r.id) || !validId(r.id) || !Number.isInteger(r.w) || !Number.isInteger(r.h) || !range(r.w, 1, 4096) || !range(r.h, 1, 4096)) throw Error("区域编号或尺寸无效。");
            ids.add(r.id);
            if (r.origin && (!Number.isSafeInteger(r.origin.x) || !Number.isSafeInteger(r.origin.y))) throw Error("区域原点无效。");
            for (const k of [ "layers", "shapes", "rooms", "markers", "ports", "links", "refs" ]) if (!Array.isArray(r[k])) throw Error("区域缺少 " + k);
            if (!r.layers.length || r.shapes.length > 3e4 || r.rooms.length > 1e3 || r.markers.length + r.ports.length > 2e4) throw Error("区域内容数量无效。");
            const layers = new Set(r.layers.map(o => o.id)), rooms = new Set(r.rooms.map(o => o.id)), ports = new Set(r.ports.map(o => o.id)), localIds = new Set;
            for (const key of [ "layers", "rooms", "shapes", "markers", "ports", "links", "refs" ]) for (const o of r[key]) {
                if (!validId(o.id) || localIds.has(o.id)) throw Error("对象编号重复或无效。");
                localIds.add(o.id);
                if (![ "layers", "links" ].includes(key) && !layers.has(o.layer)) throw Error("对象引用了不存在的空间层级。");
                if (o.roomId && !rooms.has(o.roomId)) throw Error("对象引用了不存在的房间。");
            }
            for (const o of [ ...r.layers, ...r.rooms ]) if (o.opacity !== undefined && !range(o.opacity, 0, 1)) throw Error("不透明度无效。");
            for (const k of [ "bg", "color", "outline", "border" ]) if (!/^#[a-f0-9]{6}$/i.test(r[k] || "")) throw Error("区域颜色格式无效。");
            for (const o of r.rooms) {
                if (o.paintLayers !== undefined && (!Array.isArray(o.paintLayers) || o.paintLayers.length !== 3 || o.paintLayers.some(p => !p || typeof p !== "object" || p.opacity !== undefined && !range(p.opacity, 0, 1)))) throw Error("房间绘制层无效。");
                o.paintLayers = roomPaintLayers(o).map((p, i) => ({
                    visible: p.visible !== false,
                    locked: p.locked === true,
                    opacity: p.opacity ?? [ 1, .35, .15 ][i]
                }));
                if (o.rainedSource !== undefined && (typeof o.rainedSource !== "string" || o.rainedSource.length > 40 * 1024 * 1024)) throw Error("Rained 来源数据无效。");
                if (!Number.isInteger(o.w) || !Number.isInteger(o.h) || !range(o.w, 1, r.w) || !range(o.h, 1, r.h) || !range(o.x, 0, r.w - o.w) || !range(o.y, 0, r.h - o.h) || !Array.isArray(o.cameras)) throw Error("房间尺寸或镜头无效。");
                for (const c of o.cameras) if (!range(c.x, 0, o.w) || !range(c.y, 0, o.h)) throw Error("镜头位置无效。");
                if (o.background !== undefined && !/^#[a-f0-9]{6}$/i.test(o.background)) throw Error("房间背景颜色无效。");
                if (!Number.isInteger(o.water) || !range(o.water, -1, o.h)) throw Error("水深无效。");
            }
            for (const o of r.shapes) {
                if (o.decoration !== undefined && (!Number.isInteger(o.decoration) || !range(o.decoration, 0, 2) || o.decoration && !o.roomId)) throw Error("背景绘制层无效。");
                if (!Object.hasOwn(materials, o.material) || ![ "rect", "ellipse", "polygon", "line" ].includes(o.type) || !range(o.depth ?? 0, 0, 2)) throw Error("绘制分类无效。");
                if (o.points) {
                    if (!Array.isArray(o.points) || !o.points.length || o.points.length > 5e4 || o.points.some(p => !finite(p.x) || !finite(p.y))) throw Error("笔画坐标无效。");
                } else if (!finite(o.x) || !finite(o.y) || !range(o.w, 0, 1e4) || !range(o.h, 0, 1e4)) throw Error("轮廓尺寸无效。");
                if (o.rawCell && (!Array.isArray(o.rawCell) || o.rawCell.length !== 2 || !Number.isInteger(o.rawCell[0]) || !range(o.rawCell[0], 0, 9) || !Array.isArray(o.rawCell[1]) || o.rawCell[1].length > 64 || o.rawCell[1].some(f => !Number.isInteger(f) || !range(f, 0, 255)))) throw Error("房间几何单元无效。");
                if (o.clip && (!finite(o.clip.x) || !finite(o.clip.y) || !range(o.clip.w, 0, 1e4) || !range(o.clip.h, 0, 1e4))) throw Error("裁切范围无效。");
            }
            for (const o of [ ...r.markers, ...r.ports ]) if (!range(o.x, 0, r.w) || !range(o.y, 0, r.h)) throw Error("标记坐标无效。");
            for (const o of r.markers) {
                if (!Object.hasOwn(categories, o.kind) || !Array.isArray(o.sceneIds) || o.sceneIds.some(id => !scenes.has(id))) throw Error("标记类型或时间线绑定无效。");
                if (o.icon && !/^data:image\/(png|jpeg|webp);base64,/.test(o.icon)) throw Error("图标必须是本机图片。");
            }
            for (const o of r.ports) if (!Object.hasOwn(portKinds, o.kind) || o.facing !== undefined && !Object.hasOwn(portDirections, o.facing)) throw Error("通道井类型或朝向无效。");
            for (const o of r.links) if (!ports.has(o.a) || !ports.has(o.b) || o.a === o.b) throw Error("连接端点无效。");
            for (const ref of r.refs) if (!/^data:image\/(png|jpeg|webp);base64,/.test(ref.src || "") || !finite(ref.x) || !finite(ref.y) || !range(ref.w, 1, 1e4) || !range(ref.h, 1, 1e4) || !range(ref.opacity, 0, 1) || !finite(ref.angle || 0)) throw Error("参考图格式或尺寸无效。");
            if (r.labelColor !== undefined && !/^#[a-f0-9]{6}$/i.test(r.labelColor)) throw Error("区域名称颜色无效。");
            if (r.textDocId !== undefined && (typeof r.textDocId !== "string" || r.textDocId.length > 160)) throw Error("区域文字绑定无效。");
            const defaults = region().categories;
            r.categories = Object.fromEntries(Object.keys(defaults).map(k => [ k, {
                visible: r.categories?.[k]?.visible ?? defaults[k].visible,
                locked: r.categories?.[k]?.locked === true
            } ]));
            if (!r.symmetry || !finite(r.symmetry.axisX) || !finite(r.symmetry.axisY)) r.symmetry = {
                x: false,
                y: false,
                axisX: r.w / 2,
                axisY: r.h / 2
            };
        }
        if (scenes.size !== safe.scenes.length) throw Error("地图编号重复。");
        for (const s of safe.scenes) {
            if (!validId(s.id) || !Array.isArray(s.regions) || s.regions.some(id => !ids.has(id)) || !s.placements || typeof s.placements !== "object") throw Error("地图引用无效。");
            for (const p of Object.values(s.placements)) if (!p || !finite(p.x) || !finite(p.y)) throw Error("世界布局坐标无效。");
            if (s.groups !== undefined) {
                if (!Array.isArray(s.groups) || s.groups.length > 500) throw Error("区域分组无效。");
                const groupIds = new Set, assigned = new Set;
                for (const g of s.groups) {
                    if (!g || !validId(g.id) || groupIds.has(g.id) || typeof g.name !== "string" || g.name.length > 200 || !Array.isArray(g.regions)) throw Error("区域分组无效。");
                    groupIds.add(g.id);
                    g.regions = g.regions.filter(id => s.regions.includes(id) && !assigned.has(id) && (assigned.add(id), 
                    true));
                }
            }
        }
        for (const g of safe.gates) if (!validId(g.id) || !Array.isArray(g.scenes) || g.scenes.some(id => !scenes.has(id)) || [ g.a, g.b ].some(side => !side || !ids.has(side.region) || ![ "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "locked" ].includes(String(side.karma)))) throw Error("业力门连接无效。");
        if (safe.settings?.presentationVersion !== 5) {
            for (const r of safe.regions) {
                for (const k of [ "rooms", "roomNames", "cameras", "ports", "connections", ...Object.keys(categories) ]) r.categories[k].visible = false;
                for (const m of r.markers) if (m.name === "鳄鱼刷新") {
                    m.name = "蝾螈";
                    m.creatureType = "Salamander";
                }
                if ([ "#101713", "#101b17", "#17251f", "#101815", "#0a100d" ].includes(r.bg)) r.bg = "#000000";
            }
            for (const ss of safe.scenes) if (ss.name === "主线") ss.name = "默认地图";
        }
        for (const r of safe.regions) {
            r.air ||= "#ffffff";
            for (const rm of r.rooms) {
                rm.roomType ||= rm.name.startsWith("GATE_") ? "GATE" : new RegExp("^" + r.code + "_S[0-9]+$").test(rm.name) ? "SHELTER" : "ROOM";
                rm.visible ??= true;
                rm.locked ??= false;
            }
        }
        safe.settings = {
            iconScale: 1,
            snapAlignment: true,
            undoVisible: true,
            undoLocked: true,
            canvasBackground: "#000000",
            selectionColor: "#ffffff",
            showRegionBounds: false,
            showZoom: false,
            toolbarPosition: "bottom-right",
            grid: true,
            ...safe.settings,
            presentationVersion: 5
        };
        safe.settings.regionLabelMode = safe.settings.regionLabelMode === "uniform" ? "uniform" : "color";
        if (!/^#[a-f0-9]{6}$/i.test(safe.settings.regionLabelColor || "")) safe.settings.regionLabelColor = "#ffffff";
        safe.settings.undoVisible = true;
        safe.settings.iconScale = finite(safe.settings.iconScale) ? Math.max(.25, Math.min(8, safe.settings.iconScale)) : 1;
        if (!/^#[a-f0-9]{6}$/i.test(safe.settings.canvasBackground)) safe.settings.canvasBackground = "#000000";
        const deps = Array.isArray(safe.exportSettings?.dependencies) ? safe.exportSettings.dependencies.filter(d => typeof d === "string" && d.length < 100) : [];
        if (safe.regions.some(r => r.cameraMode === "sbc")) deps.push("SBCameraScroll");
        safe.exportSettings = {
            dependencies: [ ...new Set(deps) ]
        };
        for (const r of safe.regions) {
            delete r.cameraMode;
            organizeShelters(r);
            organizeGates(r, safe);
            for (const rm of r.rooms) syncShelterPort(r, rm);
        }
        safe.settings.roomWarningMode = [ "always", "export", "off" ].includes(safe.settings.roomWarningMode) ? safe.settings.roomWarningMode : "always";
        safe.settings.favorites = brushFavorites(safe.settings.favorites);
        safe.settings.backgroundHideBelow = Number.isFinite(safe.settings.backgroundHideBelow) ? Math.max(0, Math.min(40, safe.settings.backgroundHideBelow)) : 2;
        safe.presets = Array.isArray(safe.presets) ? safe.presets : [];
        if (!scenes.has(safe.activeScene)) safe.activeScene = safe.scenes[0].id;
        return safe;
    }
    function categoryName(k) {
        return {
            rooms: "房间",
            draft: "自由剪影",
            geometry: "地形",
            water: "水体",
            refs: "参考图",
            ports: "通道井",
            connections: "连接虚线",
            roomNames: "房间名称",
            cameras: "镜头边界",
            ...categories
        }[k] || k;
    }
    function lockReason(r, o, category, lid) {
        const l = r.layers.find(l => l.id === (lid || o?.layer));
        if (l?.locked) return "图层“" + l.name + "”已锁定";
        const rm = o && (o.roomId ? r.rooms.find(rm => rm.id === o.roomId) : r.rooms.includes(o) ? o : null);
        if (rm?.locked) return "房间“" + rm.name + "”已锁定";
        if (rm && o?.decoration !== undefined && roomPaintLayers(rm)[o.decoration || 0]?.locked) return paintLayerNames[o.decoration || 0] + "已锁定";
        if (o?.locked) return "对象“" + (o.name || categoryName(category) || "所选对象") + "”已锁定";
        if (!o?.decoration && category && r.categories[category]?.locked) return categoryName(category) + "已锁定";
        return "";
    }
    function unlockRegion(r) {
        for (const o of [ ...r.layers, ...r.rooms, ...r.rooms.flatMap(roomPaintLayers), ...r.shapes, ...r.markers, ...r.ports, ...r.refs, ...Object.values(r.categories) ]) if (o.locked) o.locked = false;
    }
    function opacity(o) {
        return Math.max(0, Math.min(1, Number.isFinite(o?.opacity) ? o.opacity : 1));
    }
    function objectOpacity(r, o) {
        return opacity(r.layers.find(l => l.id === o.layer)) * opacity(o.roomId ? r.rooms.find(rm => rm.id === o.roomId) : r.rooms.includes(o) ? o : null);
    }
    function roomCopyPosition(r, source, lid = source.layer) {
        const candidates = [ {
            x: source.x + source.w + 4,
            y: source.y
        }, {
            x: source.x,
            y: source.y + source.h + 4
        }, {
            x: source.x - source.w - 4,
            y: source.y
        }, {
            x: source.x,
            y: source.y - source.h - 4
        }, {
            x: 0,
            y: 0
        } ];
        if (lid !== source.layer) candidates.unshift({
            x: source.x,
            y: source.y
        });
        for (const o of r.rooms.filter(o => o.layer === lid)) candidates.push({
            x: o.x + o.w,
            y: o.y
        }, {
            x: o.x,
            y: o.y + o.h
        }, {
            x: 0,
            y: o.y + o.h
        }, {
            x: o.x + o.w,
            y: 0
        });
        return candidates.find(p => p.x >= 0 && p.y >= 0 && p.x + source.w <= r.w && p.y + source.h <= r.h && !r.rooms.some(o => o.layer === lid && intersection(o, {
            ...p,
            w: source.w,
            h: source.h
        }))) || null;
    }
    function duplicateRoom(w, r, id, target) {
        const source = r.rooms.find(o => o.id === id), lid = source?.roomType === "SHELTER" ? ensureShelterLayer(r).id : source?.roomType === "GATE" ? ensureGateLayer(r).id : target.layer, layer = r.layers.find(l => l.id === lid);
        if (!source || !layer) throw Error("房间或图层不存在。");
        if (layer.locked) throw Error("目标图层已锁定。");
        const box = {
            x: target.x,
            y: target.y,
            w: source.w,
            h: source.h
        };
        if (!Number.isInteger(box.x) || !Number.isInteger(box.y) || box.x < 0 || box.y < 0 || box.x + box.w > r.w || box.y + box.h > r.h) throw Error("副本超出区域范围。");
        if (r.rooms.some(o => o.layer === lid && intersection(o, box))) throw Error("副本与同层房间重叠，请调整位置或选择其他层。");
        const kinds = [ "shapes", "markers", "ports", "refs" ], items = Object.fromEntries(kinds.map(k => [ k, r[k].filter(o => o.roomId === id) ]));
        if (r.rooms.length >= 1e3 || r.shapes.length + items.shapes.length > 3e4 || r.markers.length + r.ports.length + items.markers.length + items.ports.length > 2e4) throw Error("复制后内容超过区域上限。");
        const rm = {
            ...clone(source),
            ...box,
            id: uid(),
            layer: lid,
            locked: false,
            name: nextRoomName(r, source.roomType || "ROOM", lid, source.gateTo),
            cameras: source.cameras.map(c => ({
                ...c,
                id: uid()
            }))
        }, ids = new Map([ [ id, rm.id ] ]), dx = rm.x - source.x, dy = rm.y - source.y;
        r.rooms.push(rm);
        for (const k of kinds) for (const o of items[k]) ids.set(o.id, uid());
        for (const k of kinds) for (const o of items[k]) {
            const next = {
                ...clone(o),
                id: ids.get(o.id),
                roomId: rm.id,
                layer: lid
            };
            shift(next, dx, dy);
            r[k].push(next);
        }
        const ports = new Set(items.ports.map(o => o.id));
        for (const link of [ ...r.links ]) if (ports.has(link.a) || ports.has(link.b)) r.links.push({
            ...clone(link),
            id: uid(),
            a: ids.get(link.a) || link.a,
            b: ids.get(link.b) || link.b
        });
        const markers = new Set(items.markers.map(o => o.id));
        for (const gate of [ ...w.gates ]) if ([ "a", "b" ].some(s => gate[s].region === r.id && markers.has(gate[s].marker))) {
            const next = clone(gate);
            next.id = uid();
            next.name = gate.name + " · " + rm.name;
            for (const side of [ "a", "b" ]) if (next[side].region === r.id && markers.has(next[side].marker)) next[side].marker = ids.get(next[side].marker);
            w.gates.push(next);
        }
        return rm;
    }
    function isDedicatedLayer(l) {
        return l?.kind === "shelter" || l?.kind === "gate";
    }
    function isRoomMarker(o) {
        return o?.kind === "shelter" || o?.kind === "gate";
    }
    function gateLayer(r) {
        return r.layers.find(l => l.kind === "gate");
    }
    function ensureGateLayer(r) {
        let layer = gateLayer(r);
        if (!layer) {
            const duplicate = r.layers.find(l => l.name === "业力门层级");
            if (duplicate) duplicate.name = nextLayerName(r, "原业力门层级");
            layer = {
                id: uid(),
                name: "业力门层级",
                kind: "gate",
                visible: true,
                locked: false
            };
            r.layers.push(layer);
        }
        return layer;
    }
    function gateIcon(w, sid, marker) {
        if (w.settings?.gateKarmaIcons !== true) return "gate";
        const g = w.gates.find(g => g.scenes.includes(sid) && [ g.a, g.b ].some(s => s.marker === marker.id)), side = g && [ g.a, g.b ].find(s => s.marker === marker.id);
        return side ? side.karma === "locked" ? "gate-locked" : "karma-" + side.karma : "gate";
    }
    function ensureGateRoom(r, m, to = "") {
        let rm = r.rooms.find(rm => rm.id === m.roomId && rm.roomType === "GATE");
        const layer = ensureGateLayer(r);
        if (!rm) {
            if (r.rooms.length >= 1e3) throw Error("区域房间数量已达上限，请先整理房间。");
            const ww = Math.min(70, r.w), hh = Math.min(40, r.h), old = r.layers.find(l => l.id === m.layer);
            rm = addRoom(r, {
                x: Math.round(Math.max(0, Math.min(r.w - ww, m.x - ww / 2))),
                y: Math.round(Math.max(0, Math.min(r.h - hh, m.y - hh / 2))),
                w: ww,
                h: hh,
                layer: layer.id
            });
            rm.returnLayer = !isDedicatedLayer(old) ? old?.id : r.layers.find(l => !isDedicatedLayer(l))?.id;
            setRoomType(r, rm, "GATE", to);
            m.roomId = rm.id;
        }
        m.layer = layer.id;
        return rm;
    }
    function organizeGates(r, w) {
        const rooms = r.rooms.filter(rm => rm.roomType === "GATE"), markers = r.markers.filter(m => m.kind === "gate");
        if (!rooms.length && !markers.length) return;
        const layer = ensureGateLayer(r);
        for (const rm of rooms) {
            if (rm.layer !== layer.id) {
                const old = r.layers.find(l => l.id === rm.layer);
                if (!isDedicatedLayer(old)) rm.returnLayer = rm.layer;
                if (old?.locked) rm.locked = true;
                if (old?.visible === false) rm.visible = false;
                rm.opacity = opacity(rm) * opacity(old);
                transferRoomLayer(r, rm, layer.id);
            }
            if (!rm.gateMarkerOmitted && !r.markers.some(m => m.kind === "gate" && m.roomId === rm.id)) r.markers.push({
                id: uid(),
                kind: "gate",
                name: "业力门",
                roomTypeMarker: true,
                roomId: rm.id,
                layer: layer.id,
                x: Math.floor(rm.x + rm.w / 2),
                y: Math.floor(rm.y + rm.h / 2),
                sceneIds: [],
                color: "#cccccc"
            });
        }
        for (const m of markers) {
            const link = w?.gates.find(g => [ g.a, g.b ].some(s => s.region === r.id && s.marker === m.id)), other = link && [ link.a, link.b ].find(s => s.region !== r.id), to = w?.regions.find(rr => rr.id === other?.region)?.code || "";
            ensureGateRoom(r, m, to);
        }
        r.gateLayerVersion = 1;
    }
    function shelterLayer(r) {
        return r.layers.find(l => l.kind === "shelter");
    }
    function ensureShelterLayer(r) {
        let layer = shelterLayer(r);
        if (!layer) {
            const duplicate = r.layers.find(l => l.name === "庇护所层级");
            if (duplicate) duplicate.name = nextLayerName(r, "原庇护所层级");
            layer = {
                id: uid(),
                name: "庇护所层级",
                kind: "shelter",
                visible: true,
                locked: false
            };
            r.layers.push(layer);
        }
        return layer;
    }
    function transferRoomLayer(r, rm, lid) {
        rm.layer = lid;
        for (const o of [ ...r.shapes, ...r.markers, ...r.ports, ...r.refs ]) if (o.roomId === rm.id) o.layer = lid;
    }
    function organizeShelters(r) {
        const shelters = r.rooms.filter(rm => rm.roomType === "SHELTER"), markers = r.markers.filter(m => m.kind === "shelter");
        if (!shelters.length && !markers.length) return;
        const layer = ensureShelterLayer(r);
        for (const rm of shelters) {
            if (rm.layer !== layer.id) {
                rm.returnLayer = rm.layer;
                const old = r.layers.find(l => l.id === rm.layer);
                if (old?.locked) rm.locked = true;
                if (old?.visible === false) rm.visible = false;
                rm.opacity = opacity(rm) * opacity(old);
                transferRoomLayer(r, rm, layer.id);
            }
            if (!r.markers.some(m => m.kind === "shelter" && m.roomId === rm.id)) r.markers.push({
                id: uid(),
                kind: "shelter",
                name: "庇护所",
                roomTypeMarker: true,
                roomId: rm.id,
                layer: layer.id,
                x: Math.floor(rm.x + rm.w / 2),
                y: Math.floor(rm.y + rm.h / 2),
                sceneIds: [],
                color: "#cccccc"
            });
        }
        for (const m of markers) {
            let rm = r.rooms.find(rm => rm.id === m.roomId);
            if (rm?.roomType !== "SHELTER") {
                const ww = Math.min(70, r.w), hh = Math.min(40, r.h), oldLayer = m.layer;
                if (r.rooms.length >= 1e3) {
                    m.roomId = null;
                    m.layer = layer.id;
                    continue;
                }
                rm = addRoom(r, {
                    x: Math.round(Math.max(0, Math.min(r.w - ww, m.x - ww / 2))),
                    y: Math.round(Math.max(0, Math.min(r.h - hh, m.y - hh / 2))),
                    w: ww,
                    h: hh,
                    layer: layer.id
                });
                rm.returnLayer = oldLayer;
                setRoomType(r, rm, "SHELTER");
                m.roomId = rm.id;
            }
            m.layer = layer.id;
        }
        if (r.shelterLayerVersion !== 1) {
            r.categories.shelter.visible = true;
            r.shelterLayerVersion = 1;
        }
    }
    function setRoomKind(w, r, rm, type, to = "") {
        if (rm.locked || r.layers.find(l => l.id === rm.layer)?.locked) throw Error("房间或图层已锁定。");
        const oldLayer = r.layers.find(l => l.id === rm.layer), special = type === "SHELTER" || type === "GATE";
        if (special) {
            const target = type === "SHELTER" ? ensureShelterLayer(r) : ensureGateLayer(r);
            if (target.locked) throw Error(target.name + "已锁定。");
            if (rm.layer !== target.id) {
                if (!isDedicatedLayer(oldLayer)) rm.returnLayer = rm.layer;
                transferRoomLayer(r, rm, target.id);
            }
        } else if (isDedicatedLayer(oldLayer)) {
            const target = r.layers.find(l => l.id === rm.returnLayer && !isDedicatedLayer(l)) || r.layers.find(l => !isDedicatedLayer(l));
            if (!target || target.locked) throw Error("原图层已锁定或不存在。");
            if (r.rooms.some(o => o.id !== rm.id && o.layer === target.id && intersection(o, rm))) throw Error("原图层此处有房间，请先调整房间位置再修改类型。");
            transferRoomLayer(r, rm, target.id);
        }
        if (rm.roomType !== type || type === "GATE" && rm.gateTo !== to) setRoomType(r, rm, type, to);
        const kind = type === "SHELTER" ? "shelter" : type === "GATE" ? "gate" : type === "ITERATOR" ? "iterator" : null, removed = new Set(r.markers.filter(m => m.roomId === rm.id && ([ "shelter", "gate" ].includes(m.kind) || m.kind === "iterator" && m.roomTypeMarker) && m.kind !== kind).map(m => m.id));
        r.markers = r.markers.filter(m => !removed.has(m.id));
        w.gates = w.gates.filter(g => ![ "a", "b" ].some(s => g[s].region === r.id && removed.has(g[s].marker)));
        if (kind && !r.markers.some(m => m.roomId === rm.id && m.kind === kind)) r.markers.push({
            id: uid(),
            kind: kind,
            name: categories[kind],
            roomTypeMarker: true,
            roomId: rm.id,
            layer: rm.layer,
            x: Math.floor(rm.x + rm.w / 2),
            y: Math.floor(rm.y + rm.h / 2),
            sceneIds: [],
            color: "#cccccc"
        });
        syncShelterPort(r, rm);
        if (kind) r.categories[kind].visible = true;
        if (type === "SHELTER") r.shelterLayerVersion = 1;
        if (type === "GATE") r.gateLayerVersion = 1;
        return rm;
    }
    function iteratorRoomFrame(r, rm, preset) {
        const thickness = preset.walls === false ? 0 : preset.thickness ?? 2;
        if (!Number.isInteger(thickness) || thickness < 0 || thickness * 2 >= Math.min(rm.w, rm.h)) throw Error("墙体厚度必须小于房间短边的一半。");
        if (thickness && r.categories.geometry.locked) throw Error("地形已锁定；可点右下角“全部解锁”。");
        if (r.shapes.length + (thickness ? 4 : 0) > 3e4) throw Error("区域地形数量已达上限。");
        rm.preset = {
            kind: "iterator",
            thickness: thickness,
            walls: thickness > 0
        };
        if (thickness) {
            const t = thickness, rects = [ {
                x: rm.x,
                y: rm.y,
                w: rm.w,
                h: t
            }, {
                x: rm.x,
                y: rm.y + rm.h - t,
                w: rm.w,
                h: t
            }, {
                x: rm.x,
                y: rm.y + t,
                w: t,
                h: rm.h - 2 * t
            }, {
                x: rm.x + rm.w - t,
                y: rm.y + t,
                w: t,
                h: rm.h - 2 * t
            } ];
            for (const box of rects) r.shapes.push({
                id: uid(),
                type: "rect",
                material: "solid",
                depth: 0,
                roomId: rm.id,
                layer: rm.layer,
                ...box
            });
        }
        const marker = r.markers.find(m => m.roomId === rm.id && m.kind === "iterator");
        if (marker) {
            marker.name = String(preset.name || "迭代器演算室");
            if (preset.icon) marker.icon = preset.icon;
            if (preset.iteratorIcon) {
                marker.iteratorIcon = clone(preset.iteratorIcon);
                marker.iteratorDocId = preset.iteratorDocId || "";
                marker.iteratorColorMode = preset.iteratorColorMode || "white";
            }
        }
        return rm;
    }
    function roomTypeManifest(r) {
        return r.rooms.map(rm => ({
            name: rm.name,
            type: rm.roomType || "ROOM",
            worldTags: [ "SHELTER", "GATE" ].includes(rm.roomType) ? [ rm.roomType ] : [],
            gateTo: rm.gateTo || null
        }));
    }
    function nextLayerName(r, base = "新层") {
        let name = base, n = 2;
        while (r.layers.some(l => l.name === name)) name = base + " " + n++;
        return name;
    }
    function addLayer(r, name) {
        name = String(name || "").trim();
        if (!name) throw Error("请填写图层名称。");
        if (r.layers.some(l => l.name === name)) throw Error("图层名称已存在。");
        const layer = {
            id: uid(),
            name: name,
            visible: true,
            locked: false
        };
        r.layers.push(layer);
        return layer;
    }
    function duplicateLayer(w, r, sourceId, name) {
        const source = r.layers.find(l => l.id === sourceId);
        if (!source) throw Error("原图层不存在。");
        if (isDedicatedLayer(source)) {
            for (const rm of [ ...r.rooms.filter(o => o.layer === sourceId) ]) {
                const p = roomCopyPosition(r, rm);
                if (!p) throw Error("区域内没有空间放置房间副本，请先扩大区域。");
                duplicateRoom(w, r, rm.id, {
                    ...p,
                    layer: sourceId
                });
            }
            return source;
        }
        const kinds = [ "rooms", "shapes", "markers", "ports", "refs" ], original = Object.fromEntries(kinds.map(k => [ k, r[k].filter(o => o.layer === sourceId) ]));
        if (r.rooms.length + original.rooms.length > 1e3 || r.shapes.length + original.shapes.length > 3e4 || r.markers.length + r.ports.length + original.markers.length + original.ports.length > 2e4) throw Error("复制后内容超过区域上限。");
        const layer = addLayer(r, name || nextLayerName(r, source.name + " 副本")), ids = new Map([ [ sourceId, layer.id ] ]);
        layer.opacity = opacity(source);
        for (const k of kinds) for (const o of original[k]) ids.set(o.id, uid());
        for (const k of kinds) for (const o of original[k]) {
            const next = clone(o);
            next.id = ids.get(o.id);
            next.layer = layer.id;
            if (next.roomId && ids.has(next.roomId)) next.roomId = ids.get(next.roomId);
            if (k === "rooms") {
                next.name = nextRoomName(r, next.roomType || "ROOM", layer.id, next.gateTo);
                next.cameras = next.cameras.map(c => ({
                    ...c,
                    id: uid()
                }));
            }
            r[k].push(next);
        }
        const ports = new Set(original.ports.map(p => p.id));
        for (const link of [ ...r.links ]) if (ports.has(link.a) || ports.has(link.b)) r.links.push({
            ...clone(link),
            id: uid(),
            a: ids.get(link.a) || link.a,
            b: ids.get(link.b) || link.b
        });
        const markers = new Set(original.markers.map(m => m.id));
        for (const gate of [ ...w.gates ]) if ([ "a", "b" ].some(side => gate[side].region === r.id && markers.has(gate[side].marker))) {
            const next = clone(gate);
            next.id = uid();
            next.name = gate.name + " · " + layer.name;
            for (const side of [ "a", "b" ]) if (next[side].region === r.id && markers.has(next[side].marker)) next[side].marker = ids.get(next[side].marker);
            w.gates.push(next);
        }
        return layer;
    }
    function nextRoomName(r, type = "ROOM", lid = r.layers[0].id, gateTo = "") {
        if (type === "ITERATOR") {
            const prefix = r.code + "_AI";
            if (!r.rooms.some(rm => rm.name === prefix)) return prefix;
            let n = 2;
            while (r.rooms.some(rm => rm.name === prefix + String(n).padStart(2, "0"))) n++;
            return prefix + String(n).padStart(2, "0");
        }
        const prefix = type === "GATE" ? "GATE_" + r.code + "_" + (gateTo || "XX") : r.code + "_" + (type === "SHELTER" ? "S" : String.fromCharCode(65 + Math.max(0, r.layers.findIndex(l => l.id === lid)) % 26));
        if (type === "GATE" && !r.rooms.some(o => o.name === prefix)) return prefix;
        let n = 1;
        while (r.rooms.some(o => o.name === prefix + (type === "GATE" ? "_" : "") + String(n).padStart(2, "0"))) n++;
        return prefix + (type === "GATE" ? "_" : "") + String(n).padStart(2, "0");
    }
    function renameRoom(r, rm, name) {
        name = String(name).trim().toUpperCase();
        if (!/^[A-Z0-9]+_[A-Z0-9_]+$/.test(name) || !(name.startsWith(r.code + "_") || name.startsWith("GATE_"))) throw Error("房间名格式：" + r.code + "_A01 / " + r.code + "_S01 / GATE_" + r.code + "_区域代码");
        if (r.rooms.some(o => o.id !== rm.id && o.name === name)) throw Error("房间名称已存在。");
        rm.name = name;
    }
    function setRoomType(r, rm, type, gateTo = "") {
        if (![ "ROOM", "SHELTER", "GATE", "ITERATOR" ].includes(type)) throw Error("房间类型无效。");
        rm.name = nextRoomName(r, type, rm.layer, gateTo);
        rm.roomType = type;
        rm.gateTo = gateTo;
    }
    function roomVisible(r, o) {
        return o.visible !== false && (!o.roomId || r.rooms.find(rm => rm.id === o.roomId)?.visible !== false);
    }
    function roomLocked(r, o) {
        return o.locked === true || !!(o.roomId && r.rooms.find(rm => rm.id === o.roomId)?.locked);
    }
    function recordKind(d) {
        if (!d) return "text";
        const names = {
            "区域": "region",
            "珍珠": "pearl",
            "广播": "broadcast",
            "回响": "echo",
            "迭代器": "iterator",
            "角色": "character",
            "蛞蝓猫": "slugcat"
        };
        return names[d.category] || (d.details?.regionProfiles ? "region" : d.kind) || "text";
    }
    function docsOfKind(docs, kind) {
        return (docs || []).filter(d => d && !d.archived && recordKind(d) === kind);
    }
    function exactRecords(docs, kind, names) {
        const normal = v => String(v || "").normalize("NFKC").trim().toLowerCase(), terms = names.map(normal).filter(Boolean);
        return (docs || []).filter(d => d && !d.archived && (recordKind(d) === kind || kind === "region" && recordKind(d) === "text") && [ d.title, d.details?.english ].map(normal).some(n => n && terms.includes(n)));
    }
    function searchRecords(docs, query, kind) {
        const q = String(query || "").normalize("NFKC").trim().toLowerCase(), value = v => Array.isArray(v) ? v.map(value).join(" ") : v && typeof v === "object" ? Object.values(v).map(value).join(" ") : String(v || "");
        return (docs || []).filter(d => d && !d.archived && [ d.title, d.category, d.details?.english, d.details?.synopsis, d.details?.tags, d.details?.characterTags, d.details?.region, d.details?.regionProfiles, d.content ].map(value).join(" ").normalize("NFKC").toLowerCase().includes(q)).sort((a, b) => Number(recordKind(b) === kind) - Number(recordKind(a) === kind));
    }
    function bindRecord(marker, doc) {
        marker.docId = doc?.id || "";
        if (doc) {
            marker.bindingDismissed = false;
            marker.name = doc.title;
            marker.appearance = clone(doc.details?.appearance || {});
            marker.color = marker.appearance.baseColor || marker.color;
            marker.recordMode = "bound";
        }
    }
    function makeRegionRecord(kind, name, r) {
        const id = uid();
        return {
            id: id,
            title: name || categories[kind],
            kind: kind === "echo" ? "text" : kind,
            category: {
                pearl: "珍珠",
                broadcast: "广播",
                echo: "回响"
            }[kind],
            content: "",
            sourcePath: "",
            logicalPath: "regions/" + r.id + "/" + id + ".md",
            archived: false,
            details: {
                synopsis: "",
                tags: [],
                characterTags: [],
                region: r.code,
                ...kind === "pearl" ? {
                    reader: ""
                } : {
                    broadcastType: "即时广播",
                    sourceNode: ""
                }
            }
        };
    }
    function mergeLayers(r, from, to) {
        const a = r.layers.find(l => l.id === from), b = r.layers.find(l => l.id === to);
        if (!a || !b || a === b) throw Error("请选择另一个图层。");
        if (a.locked || b.locked) throw Error("请先解锁两个图层。");
        if (isDedicatedLayer(a) || isDedicatedLayer(b)) throw Error("庇护所与业力门保留各自的专用层。");
        const moving = r.rooms.filter(rm => rm.layer === from);
        if (moving.some(rm => rm.locked)) throw Error("请先解锁源图层中的房间。");
        if (moving.some(rm => r.rooms.some(other => other.layer === to && intersection(rm, other)))) throw Error("两层中有重叠房间，请先移动房间。");
        for (const key of [ "rooms", "shapes", "markers", "ports", "refs" ]) for (const o of r[key]) if (o.layer === from) o.layer = to;
        r.layers = r.layers.filter(l => l.id !== from);
        return b;
    }
    function roomFrameMergePlan(r, frame) {
        let box = {
            x: frame.x,
            y: frame.y,
            w: frame.w,
            h: frame.h
        }, hits = [];
        for (let i = 0; i <= r.rooms.length; i++) {
            const next = r.rooms.filter(rm => rm.layer === frame.layer && intersection(rm, box));
            if (next.length === hits.length) break;
            hits = next;
            const x = Math.min(box.x, ...hits.map(rm => rm.x)), y = Math.min(box.y, ...hits.map(rm => rm.y));
            box = {
                x: x,
                y: y,
                w: Math.max(box.x + box.w, ...hits.map(rm => rm.x + rm.w)) - x,
                h: Math.max(box.y + box.h, ...hits.map(rm => rm.y + rm.h)) - y
            };
        }
        return {
            box: {
                ...box,
                layer: frame.layer
            },
            hits: hits
        };
    }
    function mergeRoomFrame(r, frame) {
        const {box: box, hits: hits} = roomFrameMergePlan(r, frame);
        if (!hits.length) return addRoom(r, box);
        if (r.categories.rooms.locked || r.layers.find(l => l.id === frame.layer)?.locked || hits.some(rm => rm.locked)) throw Error("请先解锁需要合并的房间和图层。");
        if (hits.some(rm => [ "GATE", "SHELTER" ].includes(rm.roomType))) throw Error("庇护所和业力门有独立入口，请保留独立房间。");
        const surfaces = [ ...new Set(hits.filter(rm => rm.water >= 0).map(rm => rm.y + rm.h - rm.water)) ];
        if (surfaces.length > 1) throw Error("这些房间的水面高度不同，请先统一水面。");
        const keep = hits[0], ids = new Set(hits.map(rm => rm.id));
        Object.assign(keep, box, {
            cameras: cameras(box.w, box.h),
            water: surfaces.length ? Math.max(0, box.y + box.h - surfaces[0]) : -1
        });
        for (const key of [ "shapes", "markers", "ports", "refs" ]) for (const o of r[key]) if (ids.has(o.roomId)) o.roomId = keep.id;
        r.rooms = r.rooms.filter(rm => !ids.has(rm.id) || rm.id === keep.id);
        cutShapes(r, keep);
        return keep;
    }
    function fillRegion(r, p, options = {}) {
        const lid = options.layer || r.layers[0].id, layer = r.layers.find(l => l.id === lid), mat = options.material || "solid";
        if (!layer || layer.locked) throw Error("当前图层已锁定。");
        if (!Object.hasOwn(materials, mat)) throw Error("请选择填充内容。");
        if (options.decoration) options = {
            ...options,
            crossRooms: false
        };
        const owner = options.roomId ? r.rooms.find(rm => rm.id === options.roomId) : r.rooms.find(rm => rm.layer === lid && inside(p, rm)), boundsBox = options.crossRooms === false && owner ? owner : {
            x: 0,
            y: 0,
            w: r.w,
            h: r.h
        };
        if (owner && roomPaintLayers(owner)[options.decoration || 0]?.locked) throw Error(paintLayerNames[options.decoration || 0] + "已锁定");
        if (options.decoration && !owner) throw Error("请先选择要绘制背景的房间。");
        const left = Math.floor(boundsBox.x), top = Math.floor(boundsBox.y), width = Math.ceil(boundsBox.w), height = Math.ceil(boundsBox.h), size = width * height;
        if (size > 1e6) throw Error("填充范围超过 100 万格，请先进入房间再填充。");
        const ix = Math.floor(p.x) - left, iy = Math.floor(p.y) - top;
        if (ix < 0 || iy < 0 || ix >= width || iy >= height) return 0;
        const names = [ "air", ...Object.keys(materials).filter(m => m !== "air") ], codes = Object.fromEntries(names.map((m, i) => [ m, i ])), pixels = new Uint8Array(size), blocked = new Uint8Array(size), samples = options.antialias === false ? [ [ .5, .5 ] ] : [ [ .25, .25 ], [ .75, .25 ], [ .25, .75 ], [ .75, .75 ] ], threshold = Math.max(.01, .5 - (Number(options.tolerance) || 0) / 200);
        const layerIds = options.sampleAll ? r.layers.filter(l => l.visible !== false).map(l => l.id) : [ lid ];
        for (const l of layerIds) for (const shape of r.shapes) {
            if (shape.layer !== l || (shape.decoration || 0) !== (options.decoration || 0) || !roomVisible(r, shape) || !paintLayerVisible(r, shape)) continue;
            const category = shape.material === "draft" ? "draft" : shape.material === "water" ? "water" : "geometry";
            if (!options.decoration && r.categories[category]?.visible === false) continue;
            const b = intersection(bounds(shape), boundsBox);
            if (!b) continue;
            for (let y = Math.max(top, Math.floor(b.y)); y < Math.min(top + height, Math.ceil(b.y + b.h)); y++) for (let x = Math.max(left, Math.floor(b.x)); x < Math.min(left + width, Math.ceil(b.x + b.w)); x++) {
                const coverage = samples.filter(([sx, sy]) => hitShape(shape, {
                    x: x + sx,
                    y: y + sy
                })).length / samples.length;
                if (coverage < threshold) continue;
                pixels[(y - top) * width + x - left] = shape.erase || shape.material === "crawl" ? 0 : codes[shape.material];
            }
        }
        if (options.crossRooms === false && owner) blocked.fill(1);
        for (const rm of r.rooms.filter(rm => rm.layer === lid)) {
            const deny = rm.locked || roomPaintLayers(rm)[options.decoration || 0]?.locked || rm.visible === false || options.crossRooms === false && (!owner || rm.id !== owner.id);
            for (let y = Math.max(top, Math.floor(rm.y)); y < Math.min(top + height, Math.ceil(rm.y + rm.h)); y++) for (let x = Math.max(left, Math.floor(rm.x)); x < Math.min(left + width, Math.ceil(rm.x + rm.w)); x++) blocked[(y - top) * width + x - left] = deny || rm.roomType === "SHELTER" && (!shelterEditableBounds(rm) || !inside({
                x: x + .5,
                y: y + .5
            }, shelterEditableBounds(rm))) ? 1 : 0;
        }
        const start = iy * width + ix;
        if (blocked[start]) throw Error("目标房间已锁定、隐藏或超出编辑范围。");
        const target = pixels[start], mask = new Uint8Array(size), queue = new Int32Array(size);
        let head = 0, tail = 0;
        queue[tail++] = start;
        mask[start] = 1;
        const tunnels = new Map;
        if (options.crossRooms !== false) {
            const seed = port => {
                const rm = r.rooms.find(rm => rm.id === port.roomId);
                if (port.layer !== lid || !rm || rm.locked || rm.visible === false || port.kind === "den") return -1;
                let best = -1, dist = Infinity;
                for (let y = Math.max(top, Math.floor(port.y) - 2); y < Math.min(top + height, Math.floor(port.y) + 3); y++) for (let x = Math.max(left, Math.floor(port.x) - 2); x < Math.min(left + width, Math.floor(port.x) + 3); x++) {
                    const i = (y - top) * width + x - left, d = Math.hypot(x + .5 - port.x, y + .5 - port.y);
                    if (inside({
                        x: x + .5,
                        y: y + .5
                    }, rm) && !blocked[i] && pixels[i] === target && d < dist) {
                        dist = d;
                        best = i;
                    }
                }
                return best;
            };
            for (const link of r.links) {
                const a = r.ports.find(p => p.id === link.a), b = r.ports.find(p => p.id === link.b);
                if (!a || !b) continue;
                const ai = seed(a), bi = seed(b);
                if (ai < 0 || bi < 0) continue;
                for (const [i, j] of [ [ ai, bi ], [ bi, ai ] ]) {
                    if (!tunnels.has(i)) tunnels.set(i, []);
                    tunnels.get(i).push(j);
                }
            }
        }
        while (head < tail) {
            const i = queue[head++], x = i % width, y = Math.floor(i / width);
            for (const j of [ x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y > 0 ? i - width : -1, y + 1 < height ? i + width : -1, ...tunnels.get(i) || [] ]) if (j >= 0 && !mask[j] && !blocked[j] && pixels[j] === target) {
                mask[j] = 1;
                queue[tail++] = j;
            }
        }
        const expansion = Math.max(-4, Math.min(4, Math.round(options.expansion || 0)));
        for (let n = 0; n < Math.abs(expansion); n++) {
            const before = mask.slice();
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                const i = y * width + x;
                if (blocked[i]) continue;
                const near = [ x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y > 0 ? i - width : -1, y + 1 < height ? i + width : -1 ];
                if (expansion > 0 && near.some(j => j >= 0 && before[j])) mask[i] = 1; else if (expansion < 0 && before[i] && near.some(j => j < 0 || !before[j])) mask[i] = 0;
            }
        }
        const additions = [], rectangles = [];
        let count = 0, previous = new Map;
        for (let y = 0; y < height; y++) {
            const current = new Map;
            for (let x = 0; x < width; ) {
                if (!mask[y * width + x]) {
                    x++;
                    continue;
                }
                const begin = x;
                while (x < width && mask[y * width + x]) {
                    count++;
                    x++;
                }
                const key = begin + ":" + x;
                let box = previous.get(key);
                if (box) box.h++; else {
                    box = {
                        x: left + begin,
                        y: top + y,
                        w: x - begin,
                        h: 1
                    };
                    rectangles.push(box);
                }
                current.set(key, box);
            }
            previous = current;
        }
        for (const box of rectangles) {
            const base = {
                type: "rect",
                ...box,
                layer: lid,
                roomId: options.decoration ? owner.id : null,
                decoration: options.decoration || 0,
                depth: options.depth || 0
            };
            additions.push({
                ...base,
                id: uid(),
                material: "air",
                erase: true,
                eraseAll: true
            });
            if (mat !== "air") additions.push({
                ...base,
                id: uid(),
                material: mat
            });
        }
        if (!count) return 0;
        const cats = new Set(additions.map(s => s.material === "water" ? "water" : s.material === "draft" ? "draft" : "geometry"));
        for (const k of [ "draft", "geometry", "water" ]) if (!options.decoration && r.categories[k].locked && r.shapes.some(s => !s.decoration && s.layer === lid && (s.material === "draft" ? "draft" : s.material === "water" ? "water" : "geometry") === k && intersection(bounds(s), boundsBox))) throw Error(categoryName(k) + "已锁定，请先解锁再替换。");
        if (r.shapes.length + additions.length > 3e4) throw Error("填充产生的轮廓超过上限，请缩小范围。");
        r.shapes.push(...additions);
        for (const rm of r.rooms.filter(rm => rm.layer === lid)) cutShapes(r, rm);
        for (const k of cats) r.categories[k].visible = true;
        return count;
    }
    function selectContents(r, lid, box, roomId = null, options = {}) {
        if (!box) return [];
        const layers = new Set(options.layers || [ lid ]), scope = r.rooms.find(rm => rm.id === roomId);
        return [ "shapes", "markers", "ports", "refs" ].flatMap(list => r[list].filter(o => layers.has(o.layer) && (!roomId || o.roomId === roomId || !o.roomId && scope && (list === "shapes" || list === "refs" ? !!intersection(bounds(o), scope) : inside(o, scope))) && roomVisible(r, o) && (options.includeLocked || !o.locked) && (!options.filter || options.filter(o, list)) && (list === "shapes" || list === "refs" ? !!intersection(bounds(o), box) : inside(o, box))).map(o => ({
            list: list,
            id: o.id
        })));
    }
    function isolateSelection(r, lid, box, roomId = null, options = {}) {
        const refs = selectContents(r, lid, box, roomId, options), result = [];
        for (const ref of refs) {
            const o = r[ref.list].find(o => o.id === ref.id), reason = lockReason(r, o, ref.list === "shapes" ? o.material === "draft" ? "draft" : o.material === "water" ? "water" : "geometry" : ref.list === "markers" ? o.kind : ref.list);
            if (reason) continue;
            if (ref.list !== "shapes") {
                result.push(ref);
                continue;
            }
            const owner = r.rooms.find(rm => rm.id === o.roomId), b = owner ? intersection(bounds(o), owner) : bounds(o), clip = b && intersection(b, box);
            if (!clip) continue;
            const fragments = subtract(b, box).map(part => ({
                ...clone(o),
                id: uid(),
                clip: part
            }));
            o.clip = clip;
            r.shapes.splice(r.shapes.indexOf(o) + 1, 0, ...fragments);
            result.push(ref);
        }
        if (r.shapes.length > 3e4) throw Error("选区产生的轮廓超过上限。");
        return result;
    }
    function selectionBounds(r, refs) {
        const bs = refs.map(ref => r[ref.list]?.find(o => o.id === ref.id)).filter(Boolean).map(o => o.points || o.w !== undefined ? bounds(o) : {
            x: o.x,
            y: o.y,
            w: 0,
            h: 0
        });
        if (!bs.length) return null;
        const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y));
        return {
            x: x,
            y: y,
            w: Math.max(...bs.map(b => b.x + b.w)) - x,
            h: Math.max(...bs.map(b => b.y + b.h)) - y
        };
    }
    function transformSelection(r, refs, {dx: dx = 0, dy: dy = 0, flipX: flipX = false, flipY: flipY = false, crossRooms: crossRooms = true} = {}) {
        if (refs.some(ref => ref.list === "rooms")) {
            if (refs.some(ref => ref.list !== "rooms") || flipX || flipY) throw Error("房间组仅支持整体移动。");
            moveRooms(r, refs.map(ref => ref.id), dx, dy);
            return refs;
        }
        const box = selectionBounds(r, refs);
        if (!box) return;
        const updates = [];
        for (const ref of refs) {
            const o = r[ref.list]?.find(o => o.id === ref.id);
            if (!o) continue;
            const reason = lockReason(r, o, ref.list === "shapes" ? o.material === "draft" ? "draft" : o.material === "water" ? "water" : "geometry" : ref.list === "markers" ? o.kind : ref.list);
            if (reason) throw Error(reason);
            const next = clone(o), point = p => ({
                x: (flipX ? box.x * 2 + box.w - p.x : p.x) + dx,
                y: (flipY ? box.y * 2 + box.h - p.y : p.y) + dy
            });
            if (next.points) next.points = next.points.map(point); else {
                const p = point({
                    x: next.x + (flipX ? next.w || 0 : 0),
                    y: next.y + (flipY ? next.h || 0 : 0)
                });
                next.x = p.x;
                next.y = p.y;
            }
            if (next.clip) {
                const p = point({
                    x: next.clip.x + (flipX ? next.clip.w : 0),
                    y: next.clip.y + (flipY ? next.clip.h : 0)
                });
                next.clip = {
                    ...next.clip,
                    ...p
                };
            }
            if (flipX) {
                next.facing = {
                    left: "right",
                    right: "left"
                }[next.facing] || next.facing;
                next.material = {
                    slopeRU: "slopeLU",
                    slopeLU: "slopeRU",
                    slopeRD: "slopeLD",
                    slopeLD: "slopeRD"
                }[next.material] || next.material;
            }
            if (flipY) {
                next.facing = {
                    up: "down",
                    down: "up"
                }[next.facing] || next.facing;
                next.material = {
                    slopeRU: "slopeRD",
                    slopeRD: "slopeRU",
                    slopeLU: "slopeLD",
                    slopeLD: "slopeLU"
                }[next.material] || next.material;
            }
            if (ref.list === "refs") {
                if (flipX) {
                    next.flipX = !next.flipX;
                    next.angle = -(next.angle || 0);
                }
                if (flipY) {
                    next.flipY = !next.flipY;
                    next.angle = -(next.angle || 0);
                }
            }
            if (next.rawCell && (flipX || flipY)) {
                if (flipX) next.rawCell[0] = {
                    2: 3,
                    3: 2,
                    4: 5,
                    5: 4
                }[next.rawCell[0]] ?? next.rawCell[0];
                if (flipY) next.rawCell[0] = {
                    2: 4,
                    4: 2,
                    3: 5,
                    5: 3
                }[next.rawCell[0]] ?? next.rawCell[0];
            }
            if (!next.facing) delete next.facing;
            if (!next.material) delete next.material;
            const b = ref.list === "shapes" || ref.list === "refs" ? bounds(next) : {
                x: next.x,
                y: next.y,
                w: 0,
                h: 0
            }, owner = r.rooms.find(rm => rm.id === o.roomId), limits = !crossRooms && owner ? owner : {
                x: 0,
                y: 0,
                w: r.w,
                h: r.h
            };
            if (b.x < limits.x || b.y < limits.y || b.x + b.w > limits.x + limits.w || b.y + b.h > limits.y + limits.h) throw Error("选区超出编辑范围。");
            if (r.rooms.some(rm => rm.layer === o.layer && rm.locked && (b.w && b.h ? intersection(rm, b) : inside(b, rm)))) throw Error("选区经过锁定的房间。");
            if (crossRooms) {
                const center = {
                    x: b.x + b.w / 2,
                    y: b.y + b.h / 2
                };
                next.roomId = r.rooms.find(rm => rm.layer === o.layer && inside(center, rm) && b.x >= rm.x && b.y >= rm.y && b.x + b.w <= rm.x + rm.w && b.y + b.h <= rm.y + rm.h)?.id || null;
            }
            let parts = [ next ];
            if (ref.list === "shapes" && next.decoration && crossRooms) {
                const targets = r.rooms.filter(rm => rm.layer === next.layer).map(rm => ({
                    rm: rm,
                    clip: intersection(b, rm)
                })).filter(v => v.clip);
                if (Math.abs(targets.reduce((sum, v) => sum + v.clip.w * v.clip.h, 0) - b.w * b.h) > 1e-7) throw Error("背景选区需要放在房间内，请调整位置。");
                if (targets.some(v => roomPaintLayers(v.rm)[next.decoration].locked)) throw Error("目标房间的背景层已锁定。");
                parts = targets.map(({rm: rm, clip: clip}, i) => ({
                    ...clone(next),
                    id: i ? uid() : next.id,
                    roomId: rm.id,
                    clip: clip
                }));
            }
            updates.push({
                o: o,
                parts: parts,
                ref: ref
            });
        }
        if (r.shapes.length + updates.reduce((n, u) => n + u.parts.length - 1, 0) > 3e4) throw Error("移动后的轮廓超过上限。");
        const selected = [];
        for (const {o: o, parts: parts, ref: ref} of updates) {
            Object.assign(o, parts[0]);
            if (parts.length > 1) r.shapes.splice(r.shapes.indexOf(o) + 1, 0, ...parts.slice(1));
            selected.push(...parts.map(p => ({
                list: ref.list,
                id: p.id
            })));
        }
        refs.splice(0, refs.length, ...selected);
        return refs;
    }
    function copySelection(r, refs, target) {
        const l = r.layers.find(l => l.id === target);
        if (!l || l.locked || isDedicatedLayer(l)) throw Error("请选择未锁定的普通空间层。");
        const result = [], idMap = new Map;
        for (const ref of refs) {
            const o = r[ref.list]?.find(o => o.id === ref.id);
            if (!o) continue;
            const next = {
                ...clone(o),
                id: uid(),
                layer: target,
                locked: false,
                roomId: null
            }, b = next.points || next.w !== undefined ? bounds(next) : {
                x: next.x,
                y: next.y,
                w: 0,
                h: 0
            };
            const rm = r.rooms.find(rm => rm.layer === target && b.x >= rm.x && b.y >= rm.y && b.x + b.w <= rm.x + rm.w && b.y + b.h <= rm.y + rm.h);
            if (rm?.locked) throw Error("目标房间已锁定。");
            next.roomId = rm?.id || null;
            r[ref.list].push(next);
            idMap.set(o.id, next.id);
            result.push({
                list: ref.list,
                id: next.id
            });
        }
        for (const link of [ ...r.links ]) if (idMap.has(link.a) && idMap.has(link.b)) r.links.push({
            ...clone(link),
            id: uid(),
            a: idMap.get(link.a),
            b: idMap.get(link.b)
        });
        if (r.shapes.length > 3e4) throw Error("复制后轮廓超过上限。");
        return result;
    }
    function exactRegionRecords(docs, r) {
        return exactRecords(docs, "region", [ r.name, r.english ]);
    }
    function makeAreaRecord(name, english, profile) {
        return {
            id: uid(),
            title: name,
            kind: "text",
            category: "区域",
            content: "",
            sourcePath: "",
            logicalPath: "",
            archived: false,
            details: {
                synopsis: "",
                tags: [],
                characterTags: [],
                english: english,
                regionProfiles: profile ? [ clone(profile) ] : []
            }
        };
    }
    function parseRainedRoom(text) {
        text = String(text).replace(/^\uFEFF/, "");
        if (text.length > 40 * 1024 * 1024) throw Error("房间文件超过 40 MB。");
        const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim());
        if (lines.length < 6) throw Error("请选择 Rained 的房间工程 TXT。");
        let geometry;
        try {
            geometry = JSON.parse(lines[0]);
        } catch {
            throw Error("房间几何数据无法读取。");
        }
        const size = /#size\s*:\s*point\(\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(lines[5] || ""), width = +(size?.[1] || geometry?.length), height = +(size?.[2] || geometry?.[0]?.length);
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 3e5 || !Array.isArray(geometry) || geometry.length !== width) throw Error("房间尺寸无效或超过 30 万格。");
        for (const column of geometry) {
            if (!Array.isArray(column) || column.length !== height) throw Error("几何尺寸与房间尺寸不一致。");
            for (const cell of column) {
                if (!Array.isArray(cell) || cell.length !== 3) throw Error("需要三个几何深度。");
                for (const layer of cell) if (!Array.isArray(layer) || layer.length !== 2 || !Number.isInteger(layer[0]) || layer[0] < 0 || layer[0] > 9 || !Array.isArray(layer[1]) || layer[1].some(v => !Number.isInteger(v) || v < 1 || v > 32)) throw Error("包含无效几何单元。");
            }
        }
        const cameraPart = /#cameras\s*:\s*\[([^\]]*)\]/i.exec(lines[6] || "")?.[1] || "", camerasOut = [ ...cameraPart.matchAll(/point\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g) ].map(m => ({
            id: uid(),
            x: +m[1] / 20,
            y: +m[2] / 20
        }));
        if (camerasOut.some(c => !Number.isFinite(c.x) || !Number.isFinite(c.y) || c.x < 0 || c.y < 0 || c.x > width || c.y > height)) throw Error("镜头位置超出房间范围。");
        const water = Number(/#waterLevel\s*:\s*(-?\d+)/i.exec(lines[7] || "")?.[1] ?? -1);
        return {
            w: width,
            h: height,
            geometry: geometry,
            cameras: camerasOut.length ? camerasOut : cameras(width, height),
            water: Math.max(-1, Math.min(height, water)),
            source: lines.join("\r")
        };
    }
    function replaceRoomFromRained(w, r, id, data) {
        const rm = r.rooms.find(o => o.id === id);
        if (!rm) throw Error("请选择要覆盖的房间。");
        const reason = lockReason(r, rm, "rooms");
        if (reason) throw Error(reason);
        const old = clone(rm), before = clone(r), originals = new Map(r.rooms.map(o => [ o.id, clone(o) ]));
        rm.w = data.w;
        rm.h = data.h;
        const peers = r.rooms.filter(o => o.layer === rm.layer), moved = new Set;
        for (let pass = 0; pass < peers.length * peers.length + 10; pass++) {
            let collision = null;
            for (let i = 0; i < peers.length && !collision; i++) for (let j = i + 1; j < peers.length; j++) if (intersection(peers[i], peers[j])) {
                collision = [ peers[i], peers[j] ];
                break;
            }
            if (!collision) break;
            let [a, b] = collision;
            if (b.id === id || b.locked) [a, b] = [ b, a ];
            if (b.id === id || b.locked) throw Error("邻近房间已锁定，无法让开覆盖范围。");
            const options = [ {
                dx: a.x + a.w - b.x,
                dy: 0
            }, {
                dx: a.x - b.w - b.x,
                dy: 0
            }, {
                dx: 0,
                dy: a.y + a.h - b.y
            }, {
                dx: 0,
                dy: a.y - b.h - b.y
            } ].sort((p, q) => Math.abs(p.dx) + Math.abs(p.dy) - Math.abs(q.dx) - Math.abs(q.dy));
            const oa = originals.get(a.id), ob = originals.get(b.id), preferred = oa.x + oa.w <= ob.x ? options.find(p => p.dx > 0) : ob.x + ob.w <= oa.x ? options.find(p => p.dx < 0) : oa.y + oa.h <= ob.y ? options.find(p => p.dy > 0) : ob.y + ob.h <= oa.y ? options.find(p => p.dy < 0) : null;
            const direction = preferred || options.find(p => b.x + p.dx >= 0 && b.y + p.dy >= 0) || options[0];
            b.x += direction.dx;
            b.y += direction.dy;
            moved.add(b.id);
            if (pass === peers.length * peers.length + 9) throw Error("邻近房间过于密集，请先移动部分房间。");
        }
        for (const o of peers) {
            const original = originals.get(o.id), dx = o.x - original.x, dy = o.y - original.y;
            if (dx || dy) for (const key of [ "shapes", "markers", "ports", "refs" ]) for (const item of r[key]) if (item.roomId === o.id) shift(item, dx, dy);
        }
        const minX = Math.min(0, ...r.rooms.map(o => o.x)), minY = Math.min(0, ...r.rooms.map(o => o.y)), maxX = Math.max(r.w, ...r.rooms.map(o => o.x + o.w)), maxY = Math.max(r.h, ...r.rooms.map(o => o.y + o.h));
        if (maxX - minX > 4096 || maxY - minY > 4096) throw Error("导入后超出 4096 格区域上限。");
        if (minX || minY) {
            for (const key of [ "rooms", "shapes", "markers", "ports", "refs" ]) for (const item of r[key]) shift(item, -minX, -minY);
            for (const sc of w.scenes) if (sc.placements[r.id]) {
                sc.placements[r.id].x += minX;
                sc.placements[r.id].y += minY;
            }
        }
        r.w = maxX - minX;
        r.h = maxY - minY;
        r.shapes = r.shapes.filter(s => s.roomId !== id);
        Object.assign(rm, {
            cameras: clone(data.cameras),
            water: data.water,
            rainedSource: data.source,
            rainedSize: {
                w: data.w,
                h: data.h
            }
        });
        const types = {
            1: "solid",
            2: "slopeRU",
            3: "slopeLU",
            4: "slopeRD",
            5: "slopeLD",
            6: "platform",
            9: "solid"
        }, add = (x, y, len, depth, cell, material) => r.shapes.push({
            id: uid(),
            type: "rect",
            x: rm.x + x,
            y: rm.y + y,
            w: len,
            h: 1,
            layer: rm.layer,
            roomId: id,
            depth: depth,
            decoration: depth,
            material: material,
            rawCell: clone(cell)
        });
        for (let d = 0; d < 3; d++) for (let y = 0; y < data.h; y++) for (let x = 0; x < data.w; ) {
            const cell = data.geometry[x][y][d], key = JSON.stringify(cell), start = x;
            while (x < data.w && JSON.stringify(data.geometry[x][y][d]) === key) x++;
            if (!cell[0] && !cell[1].length) continue;
            add(start, y, x - start, d, cell, types[cell[0]] || cell[1].includes(1) ? types[cell[0]] || "beamH" : cell[1].includes(2) ? "beamV" : "air");
            if (cell[1].includes(1) && cell[1].includes(2)) add(start, y, x - start, d, cell, "beamV");
        }
        for (const o of [ ...r.markers, ...r.ports, ...r.refs ]) if (o.roomId === id && !isRoomMarker(o)) {
            o.x = Math.max(rm.x, Math.min(rm.x + rm.w - (o.w || .5), o.x));
            o.y = Math.max(rm.y, Math.min(rm.y + rm.h - (o.h || .5), o.y));
        }
        for (let x = 0; x < data.w; x++) for (let y = 0; y < data.h; y++) {
            const [geo, flags] = data.geometry[x][y][0], kind = flags.includes(7) ? "den" : flags.includes(21) ? "scavenger" : geo === 7 ? "exit" : null;
            if (kind && !r.ports.some(p => p.roomId === id && p.x === rm.x + x + .5 && p.y === rm.y + y + .5 && p.kind === kind)) r.ports.push({
                id: uid(),
                x: rm.x + x + .5,
                y: rm.y + y + .5,
                layer: rm.layer,
                roomId: id,
                kind: kind,
                name: portKinds[kind],
                facing: "auto"
            });
        }
        if (rm.roomType === "SHELTER") clipShelterEdits(r, r.shapes.filter(s => s.roomId === rm.id).map(s => s.id));
        syncShelterPort(r, rm);
        if (r.shapes.length > 3e4) throw Error("导入后的轮廓超过上限。");
        return {
            room: rm,
            moved: [ ...moved ],
            expanded: r.w !== before.w || r.h !== before.h,
            oldSize: {
                w: old.w,
                h: old.h
            }
        };
    }
    function compactPreviewRegion(source) {
        return clone(source);
    }
    return {
        shelterDoorTile: shelterDoorTile,
        selectRooms: selectRooms,
        moveRooms: moveRooms,
        roomMergePlan: roomMergePlan,
        mergeSelectedRooms: mergeSelectedRooms,
        deleteRoom: deleteRoom,
        shelterLayout: shelterLayout,
        configureShelter: configureShelter,
        clipShelterEdits: clipShelterEdits,
        shelterEditableBounds: shelterEditableBounds,
        shelterFixedShapes: shelterFixedShapes,
        protectShelterGeometry: protectShelterGeometry,
        syncShelterPort: syncShelterPort,
        shelterPresetData: shelterPresetData,
        roomGeometryIssues: roomGeometryIssues,
        roomWarnings: roomWarnings,
        roomWarningEnabled: roomWarningEnabled,
        roomShortcutInfo: roomShortcutInfo,
        roomConnectionIssues: roomConnectionIssues,
        prepareShelterGeometry: prepareShelterGeometry,
        shelterGeometryIssues: shelterGeometryIssues,
        brushFavorites: brushFavorites,
        shortcutChord: shortcutChord,
        backgroundsShown: backgroundsShown,
        connectPorts: connectPorts,
        shelterAtPort: shelterAtPort,
        connectShelter: connectShelter,
        recordKind: recordKind,
        exactRecords: exactRecords,
        searchRecords: searchRecords,
        paintLayerNames: paintLayerNames,
        roomPaintLayers: roomPaintLayers,
        paintLayerVisible: paintLayerVisible,
        compactPreviewRegion: compactPreviewRegion,
        parseRainedRoom: parseRainedRoom,
        replaceRoomFromRained: replaceRoomFromRained,
        exactRegionRecords: exactRegionRecords,
        makeAreaRecord: makeAreaRecord,
        selectContents: selectContents,
        isolateSelection: isolateSelection,
        selectionBounds: selectionBounds,
        transformSelection: transformSelection,
        copySelection: copySelection,
        mergeLayers: mergeLayers,
        roomFrameMergePlan: roomFrameMergePlan,
        mergeRoomFrame: mergeRoomFrame,
        fillRegion: fillRegion,
        isDedicatedLayer: isDedicatedLayer,
        isRoomMarker: isRoomMarker,
        gateLayer: gateLayer,
        ensureGateLayer: ensureGateLayer,
        ensureGateRoom: ensureGateRoom,
        organizeGates: organizeGates,
        gateIcon: gateIcon,
        renameGateMarker: renameGateMarker,
        saveGateConnection: saveGateConnection,
        exportWorkspace: exportWorkspace,
        rainedExportFiles: rainedExportFiles,
        regionLabelColor: regionLabelColor,
        regionRecordMatches: regionRecordMatches,
        portDirections: portDirections,
        portPose: portPose,
        shelterLayer: shelterLayer,
        ensureShelterLayer: ensureShelterLayer,
        organizeShelters: organizeShelters,
        transferRoomLayer: transferRoomLayer,
        snapTargets: snapTargets,
        snapBox: snapBox,
        iteratorRoomFrame: iteratorRoomFrame,
        categoryName: categoryName,
        lockReason: lockReason,
        unlockRegion: unlockRegion,
        opacity: opacity,
        objectOpacity: objectOpacity,
        roomCopyPosition: roomCopyPosition,
        duplicateRoom: duplicateRoom,
        setRoomKind: setRoomKind,
        roomTypeManifest: roomTypeManifest,
        nextLayerName: nextLayerName,
        addLayer: addLayer,
        duplicateLayer: duplicateLayer,
        regionContentBounds: regionContentBounds,
        regionResizeBox: regionResizeBox,
        resizeRegion: resizeRegion,
        symmetryFor: symmetryFor,
        setSymmetryCenter: setSymmetryCenter,
        resetSymmetryCenter: resetSymmetryCenter,
        partitionRoom: partitionRoom,
        regionInitials: regionInitials,
        setRegionCode: setRegionCode,
        roomHandles: roomHandles,
        roomHandlePoints: roomHandlePoints,
        hitRoomHandle: hitRoomHandle,
        roomResizeBox: roomResizeBox,
        resizeRoom: resizeRoom,
        exportDependencies: exportDependencies,
        nextRoomName: nextRoomName,
        renameRoom: renameRoom,
        setRoomType: setRoomType,
        roomVisible: roomVisible,
        roomLocked: roomLocked,
        docsOfKind: docsOfKind,
        bindRecord: bindRecord,
        makeRegionRecord: makeRegionRecord,
        uid: uid,
        clone: clone,
        workspace: workspace,
        region: region,
        rect: rect,
        inside: inside,
        intersection: intersection,
        bounds: bounds,
        subtract: subtract,
        cutShapes: cutShapes,
        cameras: cameras,
        addRoom: addRoom,
        shift: shift,
        moveRoom: moveRoom,
        splitRoom: splitRoom,
        mergeRooms: mergeRooms,
        forkRegion: forkRegion,
        mirrored: mirrored,
        hitShape: hitShape,
        raster: raster,
        rainedText: rainedText,
        check: check,
        validate: validate,
        categories: categories,
        materials: materials,
        portKinds: portKinds
    };
});
