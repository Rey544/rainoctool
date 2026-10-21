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
        solid: "实心墙",
        air: "空气 / 擦除",
        platform: "单向台阶",
        beamH: "横杆",
        beamV: "竖杆",
        slopeRU: "斜坡 ◣",
        slopeLU: "斜坡 ◢",
        slopeRD: "斜坡 ◤",
        slopeLD: "斜坡 ◥",
        crawl: "狭窄通道",
        shortcut: "捷径路径",
        water: "水体"
    };
    const normalizeMaterial = value => value === "draft" ? "solid" : value;
    const materialNormalizationReports = new WeakMap;
    function materialNormalizationSummary(w) {
        return materialNormalizationReports.get(w) || {
            changed: false,
            shapes: 0,
            presets: 0,
            favorites: 0,
            categories: 0
        };
    }
    function normalizeLegacyMaterials(w) {
        const report = {
            changed: false,
            shapes: 0,
            presets: 0,
            favorites: 0,
            categories: 0
        };
        for (const r of w.regions || []) {
            const oldDraft = r.categories?.draft, oldGeometry = r.categories?.geometry;
            if (oldDraft) {
                const visible = oldDraft.visible !== false || oldGeometry?.visible !== false, locked = oldDraft.locked === true && oldGeometry?.locked === true;
                for (const s of r.shapes || []) {
                    if (s.decoration || s.material === "water") continue;
                    const prior = s.material === "draft" ? oldDraft : oldGeometry;
                    if (visible && prior?.visible === false) s.visible = false;
                    if (!locked && prior?.locked === true) s.locked = true;
                }
                r.categories.geometry = {
                    ...oldGeometry,
                    visible: visible,
                    locked: locked
                };
                delete r.categories.draft;
                report.categories++;
            }
            for (const s of r.shapes || []) if (s.material === "draft") {
                s.material = "solid";
                report.shapes++;
            }
        }
        for (const p of Array.isArray(w.presets) ? w.presets : []) if (p?.material === "draft") {
            p.material = "solid";
            report.presets++;
        }
        const favorites = w.settings?.favorites;
        if (Array.isArray(favorites?.materials)) favorites.materials = favorites.materials.map(m => {
            if (m === "draft") {
                report.favorites++;
                return "solid";
            }
            return m;
        });
        report.changed = !!(report.shapes || report.presets || report.favorites || report.categories);
        materialNormalizationReports.set(w, report);
        return report;
    }
    const slopeVertices = {
        2: [ [ 0, 0 ], [ 0, 1 ], [ 1, 1 ] ],
        3: [ [ 0, 1 ], [ 1, 1 ], [ 1, 0 ] ],
        4: [ [ 1, 0 ], [ 0, 0 ], [ 0, 1 ] ],
        5: [ [ 1, 1 ], [ 1, 0 ], [ 0, 0 ] ]
    };
    function* shapeCells(s, limits, origin) {
        if (origin && (origin.x % 1 || origin.y % 1)) {
            const local = {
                ...s
            };
            if (s.points) local.points = s.points.map(p => ({
                x: p.x - origin.x,
                y: p.y - origin.y
            })); else {
                local.x = s.x - origin.x;
                local.y = s.y - origin.y;
            }
            if (s.clip) local.clip = {
                ...s.clip,
                x: s.clip.x - origin.x,
                y: s.clip.y - origin.y
            };
            const clip = limits ? {
                ...limits,
                x: limits.x - origin.x,
                y: limits.y - origin.y
            } : null;
            for (const cell of shapeCells(local, clip)) yield {
                x: cell.x + origin.x,
                y: cell.y + origin.y
            };
            return;
        }
        const shapeBounds = bounds(s), b = limits ? intersection(shapeBounds, limits) : shapeBounds;
        if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.w) || !Number.isFinite(b.h)) return;
        const left = Math.ceil(b.x - .5), top = Math.ceil(b.y - .5), right = Math.ceil(b.x + b.w - .5), bottom = Math.ceil(b.y + b.h - .5);
        if (s.points?.length > 2 && s.type !== "polygon") {
            const radius = (s.width || 1) / 2, segments = s.points.slice(1).map((end, i) => {
                const start = s.points[i], dx = end.x - start.x, dy = end.y - start.y;
                return {
                    start: start,
                    dx: dx,
                    dy: dy,
                    length: dx * dx + dy * dy || 1,
                    left: Math.max(left, Math.ceil(Math.min(start.x, end.x) - radius - .5)),
                    right: Math.min(right, Math.floor(Math.max(start.x, end.x) + radius - .5) + 1),
                    top: Math.min(start.y, end.y) - radius,
                    bottom: Math.max(start.y, end.y) + radius
                };
            });
            for (let y = top; y < bottom; y++) {
                const py = y + .5, row = new Set;
                for (const a of segments) {
                    if (py < a.top || py > a.bottom) continue;
                    for (let x = a.left; x < a.right; x++) {
                        if (row.has(x)) continue;
                        const px = x + .5, t = Math.max(0, Math.min(1, ((px - a.start.x) * a.dx + (py - a.start.y) * a.dy) / a.length));
                        if (Math.hypot(px - a.start.x - t * a.dx, py - a.start.y - t * a.dy) <= radius) row.add(x);
                    }
                }
                for (const x of [ ...row ].sort((a, b) => a - b)) yield {
                    x: x,
                    y: y
                };
            }
            return;
        }
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) if (hitShape(s, {
            x: x + .5,
            y: y + .5
        }, shapeBounds)) yield {
            x: x,
            y: y
        };
    }
    function cellTerrain(s, x, y, uncutBounds) {
        const code = s.rawCell?.[0] ?? {
            draft: 1,
            solid: 1,
            air: 0,
            crawl: 0,
            slopeRU: 2,
            slopeLU: 3,
            slopeRD: 4,
            slopeLD: 5,
            platform: 6
        }[s.material];
        if (s.rawCell || s.slopeMode !== "edge" || !slopeVertices[code]) return code;
        const source = s.clip ? {
            ...s,
            clip: null
        } : s, b = uncutBounds || bounds(source);
        return edgeSlopeCode(code, (dx, dy) => hitShape(source, {
            x: x + dx + .5,
            y: y + dy + .5
        }, b));
    }
    function edgeSlopeCode(code, has) {
        const left = has(-1, 0), right = has(1, 0), up = has(0, -1), down = has(0, 1);
        if (!left && !right && !up && !down && !has(-1, -1) && !has(-1, 1) && !has(1, -1) && !has(1, 1)) return code;
        return {
            2: left && down && !right && !up,
            3: right && down && !left && !up,
            4: left && up && !right && !down,
            5: right && up && !left && !down
        }[code] ? code : 1;
    }
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
        const owner = [ "exit", "internal" ].includes(p.kind) && portRoomOwner(r, p);
        if (owner) {
            const at = rainedPortAnchor(owner, p).entrance;
            p = {
                ...p,
                x: owner.x + at[0] + .5,
                y: owner.y + at[1] + .5
            };
        }
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
            x: p.x,
            y: p.y,
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
                presentationVersion: 5,
                portPlacementVersion: portPlacementVersion
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
                    width: Math.max(1, Math.min(100, Math.round(Number(p.width) || d.width)))
                };
            }),
            materials: [ "solid", "air", "beamH" ].map((d, i) => Object.hasOwn(materials, normalizeMaterial(value?.materials?.[i])) ? normalizeMaterial(value.materials[i]) : d),
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
    const shelterIcons = {
        original: "原版",
        "outer-expanse": "外层空间"
    };
    function shelterIconRoom(r, o) {
        return o?.roomType === "SHELTER" ? o : (o?.kind === "exit" && r ? shelterAtPort(r, o) : null) || r?.rooms.find(rm => rm.id === o?.roomId && rm.roomType === "SHELTER");
    }
    function shelterIcon(r, o) {
        return shelterIconRoom(r, o)?.shelterIcon === "outer-expanse" ? "shelter-outer-expanse" : "shelter-map";
    }
    function shelterIconSource(r, o) {
        const rm = shelterIconRoom(r, o), custom = rm ? r?.markers.find(m => m.kind === "shelter" && m.roomId === rm.id && m.icon)?.icon : o?.kind === "shelter" ? o.icon : null;
        return custom && !Object.hasOwn(shelterIcons, rm?.shelterIcon) ? custom : "rainworld-icons/" + shelterIcon(r, o) + ".png";
    }
    function setShelterIcon(r, rm, value) {
        if (rm?.roomType !== "SHELTER") throw Error("请选择庇护所房间。");
        if (!Object.hasOwn(shelterIcons, value)) throw Error("无效的庇护所图标。");
        const reason = lockReason(r, rm, "rooms");
        if (reason) throw Error(reason);
        rm.shelterIcon = value;
        return rm;
    }
    function connectShelter(r, host, shelter, position) {
        if (!host || !shelter || host.id === shelter.id || shelter.roomType !== "SHELTER") throw Error("请选择独立的庇护所房间。");
        for (const rm of [ host, shelter ]) {
            const reason = lockReason(r, rm, "rooms");
            if (reason) throw Error(reason);
        }
        if (r.categories.ports.locked) throw Error("通道井已锁定。");
        if (r.gateStorageOnly) {
            shelter.pendingRegionAssignment = true;
            shelter.gateCompanionId = host.sharedGateId || "";
        }
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
            categories: Object.fromEntries([ "geometry", "water", "rooms", "roomNames", "cameras", "ports", "connections", "refs", ...Object.keys(categories) ].map(k => [ k, {
                visible: [ "geometry", "water", "refs", "shelter" ].includes(k),
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
    function setRegionCode(r, code, w) {
        code = String(code).trim().toUpperCase();
        if (!/^[A-Z0-9]+$/.test(code)) throw Error("区域简称只能包含英文字母和数字。");
        const old = r.code, next = r.rooms.map(rm => rm.name.startsWith(old + "_") ? code + rm.name.slice(old.length) : rm.name.startsWith("GATE_") ? rm.name.split("_").map((part, i) => i && part === old ? code : part).join("_") : rm.name);
        if (new Set(next).size !== next.length) throw Error("修改简称会导致房间重名。");
        r.rooms.forEach((rm, i) => rm.name = next[i]);
        r.code = code;
        if (w) for (const g of w.gates) if (g.a.region === r.id || g.b.region === r.id) syncSharedGate(w, g);
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
    function shelterMinimumSize(room) {
        const vertical = [ "up", "down" ].includes(room.shelterFacing);
        return {
            w: vertical ? 7 : 14,
            h: vertical ? 14 : 7
        };
    }
    function roomResizeBox(r, room, handle, dx, dy) {
        if (!roomHandles.includes(handle)) throw Error("无效的房间控制点。");
        let left = room.x, top = room.y, right = room.x + room.w, bottom = room.y + room.h;
        const minimum = room.roomType === "SHELTER" ? shelterMinimumSize(room) : {
            w: 1,
            h: 1
        };
        dx = Math.round(dx);
        dy = Math.round(dy);
        if (handle.includes("w")) left = Math.max(0, Math.min(right - minimum.w, left + dx));
        if (handle.includes("e")) right = Math.min(r.w, Math.max(left + minimum.w, right + dx));
        if (handle.includes("n")) top = Math.max(0, Math.min(bottom - minimum.h, top + dy));
        if (handle.includes("s")) bottom = Math.min(r.h, Math.max(top + minimum.h, bottom + dy));
        return {
            x: left,
            y: top,
            w: right - left,
            h: bottom - top
        };
    }
    function resizeRoom(r, room, box, {geometryOnly: geometryOnly = false} = {}) {
        const nativeResize = [ "x", "y", "w", "h" ].some(k => box[k] !== room[k]) && needsNativeGeometryResize(room);
        if (nativeResize && !geometryOnly) throw Error("此房间包含原版 Rained 装饰，调整边界将只保留地形；请先确认保留原文件备份后继续。");
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
        if (nativeResize) {
            rememberRainedRoom(r, room);
            delete room.rainedSource;
            delete room.rainedSize;
        }
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
            const cat = s.material === "water" ? "water" : "geometry";
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
        const snapshot = gateRoomSnapshot(r, rm), ports = new Set(snapshot.ports.map(p => p.id)), markers = new Set(snapshot.markers.map(m => m.id));
        if (rm.sharedGateId) removeSharedGate(w, rm.sharedGateId, {
            deleteRoom: false,
            unregister: true
        });
        r.shapes = r.shapes.flatMap(s => s.roomId === id ? [] : !s.roomId && s.layer === rm.layer && intersection(bounds(s), rm) ? subtract(bounds(s), rm).map(clip => ({
            ...clone(s),
            id: uid(),
            clip: clip
        })) : [ s ]);
        for (const key of [ "markers", "ports", "refs" ]) {
            const owned = new Set(snapshot[key].map(o => o.id));
            r[key] = r[key].filter(o => !owned.has(o.id));
        }
        r.links = r.links.filter(l => !ports.has(l.a) && !ports.has(l.b));
        w.gates = w.gates.filter(g => ![ g.a, g.b ].some(side => side.region === r.id && markers.has(side.marker)));
        for (const g of w.gates) {
            g.connections = (g.connections || []).filter(l => ![ l.a, l.b ].some(end => end.region === r.id && ports.has(end.port)));
            for (const side of [ g.a, g.b ]) side.ports = (side.ports || []).filter(pid => !(g.sharedRoom?.region === r.id && ports.has(pid)));
            g.companions = (g.companions || []).filter(ref => ref.region !== r.id || ref.room !== id);
        }
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
            shelterOffsetVersion: 2,
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
        if (room.sharedGateId) throw Error("共享业力门不能切分，请编辑同一个房间。");
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
        for (const p of r.ports) if (p.roomId === room.id || p.roomId === b.id) {
            const owner = portRoomOwner(r, p);
            if (owner) p.roomId = owner.id;
        }
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
    function roomTransformSpec(box, {rotation: rotation = 0, flipX: flipX = false, flipY: flipY = false} = {}) {
        if (!Number.isFinite(rotation) || rotation % 90) throw Error("房间旋转只支持 90° 的整数倍。");
        const turn = (rotation / 90 % 4 + 4) % 4, w = turn % 2 ? box.h : box.w, h = turn % 2 ? box.w : box.h;
        const point = p => {
            const q = turnPoint({
                x: p.x - box.x,
                y: p.y - box.y
            }, box.w, box.h, turn);
            return {
                x: box.x + (flipX ? w - q.x : q.x),
                y: box.y + (flipY ? h - q.y : q.y)
            };
        }, rect = b => {
            const p = point(b), q = point({
                x: b.x + b.w,
                y: b.y + b.h
            });
            return {
                x: Math.min(p.x, q.x),
                y: Math.min(p.y, q.y),
                w: Math.abs(q.x - p.x),
                h: Math.abs(q.y - p.y)
            };
        };
        const direction = value => {
            for (let i = 0; i < turn; i++) value = {
                right: "down",
                down: "left",
                left: "up",
                up: "right"
            }[value] || value;
            if (flipX) value = {
                left: "right",
                right: "left"
            }[value] || value;
            if (flipY) value = {
                up: "down",
                down: "up"
            }[value] || value;
            return value;
        };
        const cell = value => {
            const out = turnCell(value, turn);
            if (flipX) out[0] = {
                2: 3,
                3: 2,
                4: 5,
                5: 4
            }[out[0]] ?? out[0];
            if (flipY) out[0] = {
                2: 4,
                4: 2,
                3: 5,
                5: 3
            }[out[0]] ?? out[0];
            return out;
        };
        const material = value => {
            for (let i = 0; i < turn; i++) value = {
                beamH: "beamV",
                beamV: "beamH",
                slopeRU: "slopeRD",
                slopeRD: "slopeLD",
                slopeLD: "slopeLU",
                slopeLU: "slopeRU"
            }[value] || value;
            if (flipX) value = {
                slopeRU: "slopeLU",
                slopeLU: "slopeRU",
                slopeRD: "slopeLD",
                slopeLD: "slopeRD"
            }[value] || value;
            if (flipY) value = {
                slopeRU: "slopeRD",
                slopeRD: "slopeRU",
                slopeLU: "slopeLD",
                slopeLD: "slopeLU"
            }[value] || value;
            return value;
        };
        return {
            turn: turn,
            flipX: flipX,
            flipY: flipY,
            w: w,
            h: h,
            point: point,
            rect: rect,
            direction: direction,
            cell: cell,
            material: material
        };
    }
    function transformRoomObject(o, key, spec) {
        if (key === "shapes" && ![ "rect", "ellipse", "polygon", "line" ].includes(o.type)) throw Error("包含暂不支持变换的绘制对象，未修改房间。");
        if (o.points) o.points = o.points.map(spec.point); else if (key === "refs") {
            const p = spec.point({
                x: o.x + o.w / 2,
                y: o.y + o.h / 2
            });
            o.x = p.x - o.w / 2;
            o.y = p.y - o.h / 2;
            o.angle = (o.angle || 0) + spec.turn * 90;
            if (spec.flipX) {
                o.flipX = !o.flipX;
                o.angle = -o.angle;
            }
            if (spec.flipY) {
                o.flipY = !o.flipY;
                o.angle = -o.angle;
            }
        } else if (o.w !== undefined && o.h !== undefined) Object.assign(o, spec.rect(o)); else Object.assign(o, spec.point(o));
        if (o.clip) o.clip = spec.rect(o.clip);
        if (o.material) o.material = spec.material(o.material);
        if (o.facing) o.facing = spec.direction(o.facing);
        if (o.rawCell) o.rawCell = spec.cell(o.rawCell);
    }
    function commitRoomEdit(r, staged) {
        for (const key of [ "rooms", "shapes", "markers", "ports", "refs", "links" ]) {
            const originals = new Map(r[key].map(o => [ o.id, o ]));
            r[key] = staged[key].map(next => {
                const old = originals.get(next.id);
                if (!old) return next;
                for (const field of Object.keys(old)) if (!Object.hasOwn(next, field)) delete old[field];
                return Object.assign(old, next);
            });
        }
        return r;
    }
    function rainedListField(line, key) {
        const match = new RegExp("#" + key + "\\s*:\\s*", "i").exec(line);
        if (!match) return null;
        const start = match.index + match[0].length;
        if (line[start] !== "[") throw Error("Rained " + key + " 数据格式无效。");
        let depth = 0, quoted = false;
        for (let i = start; i < line.length; i++) {
            const c = line[i];
            if (c === '"' && line[i - 1] !== "\\") quoted = !quoted;
            if (quoted) continue;
            if (c === "[") depth++; else if (c === "]" && ! --depth) return {
                start: start,
                end: i + 1,
                text: line.slice(start, i + 1)
            };
        }
        throw Error("Rained " + key + " 列表不完整。");
    }
    const nativeRoomFeatureCache = new Map;
    function nativeRoomFeatures(room) {
        if (!room.rainedSource) return null;
        const source = room.rainedSource, cached = nativeRoomFeatureCache.get(source);
        if (cached) return cached;
        const lines = source.split(/\r\n|\r|\n/).filter(l => l.trim()), effect = rainedListField(lines[2] || "", "effects"), props = rainedListField(lines[8] || "", "props"), field = rainedListField(lines[1] || "", "tlMatrix"), material = /#defaultMaterial\s*:\s*"([^"]+)"/i.exec(lines[1] || "")?.[1], features = {
            decorations: !!(effect && lingoListItems(effect.text).length || props && lingoListItems(props.text).length),
            foreignTiles: !field,
            shelterTiles: false,
            materials: !!material && material !== "Concrete" || /#tp\s*:\s*"material"/i.test(lines[1] || "")
        };
        if (field) for (const col of lingoListItems(field.text)) for (const cell of lingoListItems(col)) for (const depth of lingoListItems(cell)) if (/#tp\s*:\s*"tileHead"/i.test(depth)) {
            if (/"shelter gate [NEWS]"/i.test(depth)) features.shelterTiles = true; else features.foreignTiles = true;
        }
        if (nativeRoomFeatureCache.size >= 4) nativeRoomFeatureCache.delete(nativeRoomFeatureCache.keys().next().value);
        nativeRoomFeatureCache.set(source, features);
        return features;
    }
    function needsNativeGeometryTransform(room) {
        const f = nativeRoomFeatures(room);
        return !!f && (f.decorations || f.foreignTiles || f.shelterTiles && room.roomType !== "SHELTER");
    }
    function needsNativeGeometryResize(room) {
        const f = nativeRoomFeatures(room);
        return !!f && (f.materials || needsNativeGeometryTransform(room));
    }
    function rememberRainedRoom(r, room, target = room) {
        if (target.rainedTransformOriginal || !room.rainedSource) return;
        target.rainedTransformOriginal = {
            source: room.rainedSource,
            w: room.w,
            h: room.h,
            room: clone(room)
        };
        for (const key of [ "shapes", "markers", "ports", "refs" ]) target.rainedTransformOriginal[key] = r[key].filter(o => o.roomId === room.id).map(clone);
    }
    function transformRainedSource(room, next, spec, {geometryOnly: geometryOnly = false, allowDecorationReset: allowDecorationReset = false} = {}) {
        if (!room.rainedSource) return;
        const lines = room.rainedSource.split(/\r\n|\r|\n/).filter(l => l.trim()), field = rainedListField(lines[1] || "", "tlMatrix"), effect = rainedListField(lines[2] || "", "effects"), props = rainedListField(lines[8] || "", "props");
        let problem = "";
        if (!field) problem = "缺少完整贴块矩阵"; else if (effect && lingoListItems(effect.text).length || props && lingoListItems(props.text).length) problem = "包含 Rained 的特效或装饰道具";
        let matrix;
        if (!problem) {
            matrix = lingoListItems(field.text).map(col => lingoListItems(col).map(lingoListItems));
            if (matrix.length !== room.w || matrix.some(col => col.length !== room.h || col.some(c => c.length !== 3))) problem = "贴块尺寸与房间不一致";
        }
        const heads = new Set;
        if (!problem) for (let x = 0; x < room.w; x++) for (let y = 0; y < room.h; y++) for (let d = 0; d < 3; d++) {
            const cell = matrix[x][y][d], type = /#tp\s*:\s*"([^"]+)"/i.exec(cell)?.[1];
            if (type === "tileHead") {
                if (room.roomType === "SHELTER" && /"shelter gate [NEWS]"/i.test(cell)) heads.add([ x + 1, y + 1, d + 1 ].join(",")); else problem = "包含没有旋转素材的 Rained 贴块";
            } else if (![ "default", "material", "tileBody" ].includes(type)) problem = "包含未知 Rained 贴块";
        }
        if (problem) {
            if (!geometryOnly && !allowDecorationReset) throw Error(room.name + " " + problem + "；请先在 Rained 中旋转，或明确选择仅变换地形。原房间未修改。");
            next.rainedTransformOriginal ||= {
                source: room.rainedSource,
                w: room.w,
                h: room.h
            };
            delete next.rainedSource;
            delete next.rainedSize;
            return;
        }
        const blank = '[#tp: "default", #data: 0]', target = Array.from({
            length: next.w
        }, () => Array.from({
            length: next.h
        }, () => [ blank, blank, blank ]));
        for (let x = 0; x < room.w; x++) for (let y = 0; y < room.h; y++) {
            const p = spec.point({
                x: room.x + x + .5,
                y: room.y + y + .5
            }), xx = Math.floor(p.x - next.x), yy = Math.floor(p.y - next.y);
            for (let d = 0; d < 3; d++) {
                let cell = matrix[x][y][d];
                if (/#tp\s*:\s*"tileHead"/i.test(cell)) cell = blank; else if (/#tp\s*:\s*"tileBody"/i.test(cell)) {
                    const m = /#data\s*:\s*\[\s*point\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*,\s*(\d+)/i.exec(cell);
                    if (!m || !heads.has(m.slice(1).map(Number).join(","))) throw Error(room.name + " 含有无法匹配的贴块主体，原房间未修改。");
                    cell = blank;
                }
                target[xx][yy][d] = cell;
            }
        }
        lines[1] = lines[1].slice(0, field.start) + "[" + target.map(col => "[" + col.map(c => "[" + c.join(",") + "]").join(",") + "]").join(",") + "]" + lines[1].slice(field.end);
        lines[5] = lines[5].replace(/#size\s*:\s*point\([^)]*\)/i, "#size: point(" + next.w + ", " + next.h + ")").replace(/#extraTiles\s*:\s*\[[^\]]*\]/i, "#extraTiles: [0,0,0,0]");
        const geo = parseRainedRoom(room.rainedSource).geometry, out = Array.from({
            length: next.w
        }, () => Array.from({
            length: next.h
        }, () => [ [ 0, [] ], [ 0, [] ], [ 0, [] ] ]));
        for (let x = 0; x < room.w; x++) for (let y = 0; y < room.h; y++) {
            const p = spec.point({
                x: room.x + x + .5,
                y: room.y + y + .5
            });
            out[Math.floor(p.x - next.x)][Math.floor(p.y - next.y)] = geo[x][y].map(spec.cell);
        }
        lines[0] = JSON.stringify(out);
        lines[6] = "[#cameras: [" + next.cameras.map(c => "point(" + c.x * 20 + ", " + c.y * 20 + ")").join(",") + "]]";
        next.rainedSource = lines.join("\r");
        next.rainedSize = {
            w: next.w,
            h: next.h
        };
    }
    function transformRooms(r, ids, options = {}) {
        const rooms = selectedRooms(r, ids), set = new Set(rooms.map(rm => rm.id)), box = selectionBounds(r, rooms.map(rm => ({
            list: "rooms",
            id: rm.id
        }))), spec = roomTransformSpec(box, options);
        if (!spec.turn && !spec.flipX && !spec.flipY) return rooms;
        for (const rm of rooms) {
            const reason = lockReason(r, rm, "rooms");
            if (reason) throw Error(reason);
        }
        const staged = clone(r), selected = staged.rooms.filter(rm => set.has(rm.id));
        for (const rm of selected) cutShapes(staged, rm);
        for (const key of [ "markers", "ports", "refs" ]) for (const o of staged[key]) if (!o.roomId) {
            const owner = selected.find(rm => rm.layer === o.layer && inside(o, rm));
            if (owner) o.roomId = owner.id;
        }
        if (typeof portRoomOwner === "function") for (const p of staged.ports) {
            const owner = portRoomOwner(staged, p);
            if (owner) p.roomId = owner.id; else if (set.has(p.roomId)) throw Error("通道井「" + (p.name || p.id) + "」无法确定所属房间，原房间未修改。");
        }
        for (const key of [ "shapes", "markers", "ports", "refs" ]) for (const o of staged[key]) if (set.has(o.roomId)) {
            const category = key === "shapes" ? o.material === "water" ? "water" : "geometry" : key === "markers" ? o.kind : key, reason = lockReason(staged, o, category);
            if (reason) throw Error(reason);
            transformRoomObject(o, key, spec);
        }
        for (const rm of selected) {
            const old = rooms.find(o => o.id === rm.id), newBox = spec.rect(old), nextCameras = [], seen = new Set;
            for (const camera of old.cameras || []) {
                const p = spec.point({
                    x: old.x + camera.x + 35,
                    y: old.y + camera.y + 20
                }), x = Math.max(0, Math.min(Math.max(0, newBox.w - 70), Math.round(p.x - newBox.x - 35))), y = Math.max(0, Math.min(Math.max(0, newBox.h - 40), Math.round(p.y - newBox.y - 20))), key = x + "," + y;
                if (!seen.has(key)) {
                    seen.add(key);
                    nextCameras.push({
                        ...camera,
                        x: x,
                        y: y
                    });
                }
            }
            for (const camera of cameras(newBox.w, newBox.h)) {
                const key = camera.x + "," + camera.y;
                if (!seen.has(key)) {
                    seen.add(key);
                    nextCameras.push(camera);
                }
            }
            Object.assign(rm, newBox, {
                cameras: nextCameras
            });
            if (old.symmetryCenter) {
                const p = spec.point({
                    x: old.x + old.symmetryCenter.x,
                    y: old.y + old.symmetryCenter.y
                });
                rm.symmetryCenter = {
                    x: p.x - rm.x,
                    y: p.y - rm.y
                };
            }
            if (old.water > 0) {
                if (spec.turn || spec.flipY) throw Error(old.name + " 含有水平水面，请先改为水体绘制或移除房间水位后再旋转／上下翻转。原房间未修改。");
                rm.water = old.water;
            }
            if (rm.roomType === "SHELTER") {
                rm.shelterOffsetVersion = 2;
                const layout = shelterLayout(old), entrance = turnPoint({
                    x: 3.5,
                    y: layout.offset + .5
                }, layout.w, layout.h, layout.turn), p = spec.point({
                    x: old.x + entrance.x,
                    y: old.y + entrance.y
                });
                rm.shelterFacing = spec.direction(old.shelterFacing || "left");
                rm.shelterOffset = Math.floor([ "up", "down" ].includes(rm.shelterFacing) ? p.x - rm.x : p.y - rm.y);
            }
            if (rm.roomType === "SHELTER" && (rm.w < 70 || rm.h < 40)) {
                const oldW = rm.w, oldH = rm.h;
                rm.w = Math.max(70, rm.w);
                rm.h = Math.max(40, rm.h);
                const base = {
                    type: "rect",
                    material: "solid",
                    depth: 0,
                    decoration: 0,
                    roomId: rm.id,
                    layer: rm.layer
                };
                if (rm.w > oldW) staged.shapes.push({
                    ...base,
                    id: uid(),
                    x: rm.x + oldW,
                    y: rm.y,
                    w: rm.w - oldW,
                    h: rm.h
                });
                if (rm.h > oldH) staged.shapes.push({
                    ...base,
                    id: uid(),
                    x: rm.x,
                    y: rm.y + oldH,
                    w: oldW,
                    h: rm.h - oldH
                });
                rm.cameras = cameras(rm.w, rm.h);
            }
            transformRainedSource(old, rm, spec, options);
            if (rm.rainedTransformOriginal && !old.rainedTransformOriginal) {
                rm.rainedTransformOriginal.room = clone(old);
                for (const key of [ "shapes", "markers", "ports", "refs" ]) rm.rainedTransformOriginal[key] = r[key].filter(o => o.roomId === old.id).map(clone);
            }
        }
        for (const rm of selected) {
            if (rm.x < 0 || rm.y < 0 || rm.x + rm.w > r.w || rm.y + rm.h > r.h) throw Error("变换后超出区域，请先移动房间或扩大区域。");
            if (staged.rooms.some(o => o.id !== rm.id && o.layer === rm.layer && intersection(o, rm))) throw Error("变换后与同层房间重叠，原房间未修改。");
            if (rm.roomType === "SHELTER") syncShelterPort(staged, rm);
        }
        if (staged.shapes.length > 3e4) throw Error("变换后的轮廓超过上限。");
        commitRoomEdit(r, staged);
        return ids.map(id => r.rooms.find(rm => rm.id === id));
    }
    function mergeRooms(r, a, b) {
        return mergeSelectedRooms(r, [ a?.id, b?.id ]);
    }
    function forkRegion(w, scene, id) {
        const source = w.regions.find(r => r.id === id), r = clone(source), ids = new Map, remap = v => {
            if (!ids.has(v)) ids.set(v, uid());
            return ids.get(v);
        };
        r.id = remap(id);
        for (const list of [ "layers", "shapes", "rooms", "markers", "ports", "links", "refs" ]) for (const o of r[list]) {
            o.id = remap(o.id);
            for (const key of [ "roomId", "layer", "returnLayer", "a", "b" ]) if (o[key]) o[key] = remap(o[key]);
            delete o.sharedGateId;
            delete o.sharedGateRoom;
        }
        scene.regions = scene.regions.map(v => v === id ? r.id : v);
        if (scene.placements[id]) scene.placements[r.id] = clone(scene.placements[id]);
        for (const group of scene.groups || []) group.regions = group.regions.map(v => v === id ? r.id : v);
        w.regions.push(r);
        for (const g of [ ...w.gates ]) if (g.scenes.includes(scene.id) && (g.a.region === id || g.b.region === id)) {
            g.scenes = g.scenes.filter(x => x !== scene.id);
            const ng = {
                ...clone(g),
                id: uid(),
                scenes: [ scene.id ]
            }, forkSide = g.a.region === id ? "a" : "b", remoteSide = forkSide === "a" ? "b" : "a", gatePorts = new Map;
            ng[forkSide].region = r.id;
            ng[forkSide].marker = remap(g[forkSide].marker);
            if (g.sharedVersion === 2 && g.sharedRoom) {
                if (g.sharedRoom.region === id) {
                    ng.sharedRoom = {
                        region: r.id,
                        room: remap(g.sharedRoom.room)
                    };
                    for (const p of source.ports.filter(p => p.roomId === g.sharedRoom.room)) gatePorts.set(p.id, remap(p.id));
                } else {
                    const owner = w.regions.find(rr => rr.id === g.sharedRoom.region), original = owner?.rooms.find(rm => rm.id === g.sharedRoom.room);
                    if (!original) throw Error("共享业力门原房间不存在，无法建立独立副本。");
                    const snapshot = gateRoomSnapshot(owner, original), layer = ensureGateLayer(r), marker = r.markers.find(m => m.id === ng[forkSide].marker);
                    r.w = Math.max(r.w, original.w);
                    r.h = Math.max(r.h, original.h);
                    let box = {
                        x: Math.round(Math.max(0, Math.min(r.w - original.w, (marker?.x ?? original.x) - original.w / 2))),
                        y: Math.round(Math.max(0, Math.min(r.h - original.h, (marker?.y ?? original.y) - original.h / 2))),
                        w: original.w,
                        h: original.h,
                        layer: layer.id
                    };
                    if (r.rooms.some(rm => rm.layer === layer.id && intersection(rm, box))) {
                        const free = roomCopyPosition(r, box, layer.id);
                        if (free) Object.assign(box, free); else if (r.w + original.w + 4 <= 4096) {
                            box.x = r.w + 4;
                            box.y = 0;
                            r.w = box.x + box.w;
                        } else if (r.h + original.h + 4 <= 4096) {
                            box.x = 0;
                            box.y = r.h + 4;
                            r.h = box.y + box.h;
                        } else throw Error("区域没有足够空间容纳共享业力门独立副本。");
                    }
                    const rm = {
                        ...clone(original),
                        ...box,
                        id: uid()
                    }, copied = new Map([ [ original.id, rm.id ] ]);
                    delete rm.sharedGateId;
                    delete rm.detachedGateBackup;
                    r.rooms.push(rm);
                    ng.sharedRoom = {
                        region: r.id,
                        room: rm.id
                    };
                    for (const key of [ "shapes", "markers", "ports", "refs" ]) for (const o of snapshot[key]) {
                        if (key === "markers" && o.kind === "gate") continue;
                        const next = {
                            ...clone(o),
                            id: uid(),
                            layer: rm.layer,
                            roomId: rm.id
                        };
                        shift(next, rm.x - original.x, rm.y - original.y);
                        delete next.sharedGateId;
                        delete next.sharedGateRoom;
                        r[key].push(next);
                        copied.set(o.id, next.id);
                        if (key === "ports") gatePorts.set(o.id, next.id);
                    }
                    ng.connections = (ng.connections || []).map(l => clone(l));
                    for (const l of snapshot.links) {
                        const end = pid => copied.has(pid) ? {
                            region: r.id,
                            port: copied.get(pid)
                        } : {
                            region: owner.id,
                            port: pid
                        }, a = end(l.a), b = end(l.b);
                        if (a.region === r.id && b.region === r.id) r.links.push({
                            ...clone(l),
                            id: uid(),
                            a: a.port,
                            b: b.port
                        }); else ng.connections.push({
                            ...clone(l),
                            id: uid(),
                            a: a,
                            b: b
                        });
                    }
                }
                for (const l of ng.connections || []) for (const key of [ "a", "b" ]) {
                    const end = l[key];
                    if (end.region === g.sharedRoom.region && gatePorts.has(end.port)) l[key] = {
                        region: r.id,
                        port: gatePorts.get(end.port)
                    }; else if (end.region === id) l[key] = {
                        region: r.id,
                        port: remap(end.port)
                    };
                }
                for (const key of [ "a", "b" ]) ng[key].ports = (g[key].ports || []).map(pid => gatePorts.get(pid) || pid);
                const rr = w.regions.find(rr => rr.id === ng[remoteSide].region), originalMarker = rr?.markers.find(m => m.id === g[remoteSide].marker);
                if (originalMarker) {
                    const marker = {
                        ...clone(originalMarker),
                        id: uid(),
                        sceneIds: [ scene.id ]
                    };
                    delete marker.roomId;
                    delete marker.sharedGateId;
                    delete marker.sharedGateRoom;
                    rr.markers.push(marker);
                    ng[remoteSide].marker = marker.id;
                }
            }
            w.gates.push(ng);
            if (ng.sharedVersion === 2) {
                syncSharedGate(w, ng);
                if (moveSharedGateToStorage(w, ng)) syncSharedGate(w, ng);
            }
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
    function hitShape(s, p, shapeBounds = bounds(s)) {
        if (!inside(p, shapeBounds)) return false;
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
        if (!Number.isInteger(room.w) || !Number.isInteger(room.h)) throw Error("房间宽高需要使用整数格；请先将尺寸调整到完整格子后再导出。");
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
                const uncutBounds = s.slopeMode === "edge" ? bounds({
                    ...s,
                    clip: null
                }) : null;
                for (const cell of shapeCells(s, room, room)) {
                    const x = Math.round(cell.x - room.x), y = Math.round(cell.y - room.y);
                    const d = level || (s.depth || 0);
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
                        c[0] = cellTerrain(s, cell.x, cell.y, uncutBounds);
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
        }[rm.shelterFacing] || 0, w = turn % 2 ? rm.h : rm.w, h = turn % 2 ? rm.w : rm.h, position = Math.max(3, Math.min(h - 4, Number.isInteger(rm.shelterOffset) ? rm.shelterOffset : Math.floor(h / 2))), offset = turn === 1 || turn === 2 ? h - 1 - position : position;
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
                2: 4,
                4: 5,
                5: 3,
                3: 2
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
    function configureShelter(r, rm, {shelterFacing: shelterFacing = rm.shelterFacing || "left", shelterOffset: shelterOffset, w: w = rm.w, h: h = rm.h, shelterIcon: shelterIcon = rm.shelterIcon, geometryOnly: geometryOnly = false} = {}) {
        const reason = lockReason(r, rm, "rooms");
        if (reason) throw Error(reason);
        if (rm.roomType !== "SHELTER") throw Error("请选择庇护所房间。");
        if (![ "left", "up", "right", "down" ].includes(shelterFacing)) throw Error("无效的庇护所朝向。");
        if (shelterIcon !== undefined && !Object.hasOwn(shelterIcons, shelterIcon)) throw Error("无效的庇护所图标。");
        if (w === rm.w && h === rm.h && shelterFacing === (rm.shelterFacing || "left") && (shelterOffset === undefined || shelterOffset === shelterLayout(rm).position)) return shelterIcon === undefined ? rm : setShelterIcon(r, rm, shelterIcon);
        const staged = clone(r), next = staged.rooms.find(o => o.id === rm.id);
        clipShelterEdits(staged, staged.shapes.filter(o => o.roomId === rm.id).map(o => o.id));
        next.shelterFacing = shelterFacing;
        next.shelterIcon = shelterIcon;
        next.shelterOffsetVersion = 2;
        if (!shelterEditableBounds({
            ...next,
            w: w,
            h: h
        })) throw Error("尺寸不足以容纳这个方向的门机构，请增大房间。");
        if (w !== rm.w || h !== rm.h) resizeRoom(staged, next, {
            x: rm.x,
            y: rm.y,
            w: w,
            h: h
        }, {
            geometryOnly: geometryOnly
        });
        next.shelterOffset = shelterOffset === undefined ? shelterLayout(next).position : shelterOffset;
        if (!Number.isInteger(next.shelterOffset)) throw Error("出口位置需要是整数。");
        const layout = shelterLayout(next);
        next.shelterOffset = layout.position;
        syncShelterPort(staged, next);
        commitRoomEdit(r, staged);
        return r.rooms.find(o => o.id === rm.id);
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
        const w = options.w || 70, h = options.h || 40, r = region("庇护所", "Shelter", w, h), rm = addRoom(r, {
            x: 0,
            y: 0,
            w: w,
            h: h,
            layer: r.layers[0].id
        });
        Object.assign(rm, {
            roomType: "SHELTER",
            shelterFacing: options.shelterFacing || "left",
            shelterOffset: options.shelterOffset,
            shelterIcon: options.shelterIcon === "outer-expanse" ? "outer-expanse" : "original"
        });
        const data = parseRainedRoom(rainedText(r, rm));
        data.shelterOptions = {
            shelterFacing: rm.shelterFacing,
            shelterOffset: shelterLayout(rm).position,
            shelterOffsetVersion: 2,
            shelterIcon: rm.shelterIcon
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
    function portRoomOwner(r, p) {
        const contains = rm => rm.layer === p.layer && p.x >= rm.x && p.x <= rm.x + rm.w && p.y >= rm.y && p.y <= rm.y + rm.h;
        const declared = r.rooms.find(rm => rm.id === p.roomId);
        if (declared && contains(declared)) return declared;
        const candidates = r.rooms.filter(contains);
        return candidates.length === 1 ? candidates[0] : null;
    }
    function rainedPortAnchor(room, p) {
        const source = [ Math.floor(p.x - room.x), Math.floor(p.y - room.y) ], entrance = [ ...source ];
        for (let axis = 0; axis < 2; axis++) {
            const size = axis ? room.h : room.w;
            if (source[axis] === 0) entrance[axis] = 2; else if (source[axis] === size) entrance[axis] = size - 3;
        }
        return {
            source: source,
            entrance: entrance,
            boundaryAdjusted: source.some((n, i) => n !== entrance[i])
        };
    }
    function traceRainedShortcut(geometry, start) {
        const h = geometry[0]?.length || 0, w = geometry.length, dirs = [ [ -1, 0 ], [ 0, 1 ], [ 1, 0 ], [ 0, -1 ] ], cell = p => geometry[p[0]]?.[p[1]]?.[0], same = (a, b) => a[0] === b[0] && a[1] === b[1];
        const path = p => p[0] >= 0 && p[1] >= 0 && p[0] < w && p[1] < h && cell(p)[1].some(f => [ 4, 5, 6, 7, 19, 21 ].includes(f));
        let current = start, last = start;
        const visited = new Set, tiles = [ start ];
        for (let n = 0; n < 1e3; n++) {
            const delta = [ current[0] - last[0], current[1] - last[1] ], key = [ ...current, ...delta ].join(",");
            if (visited.has(key)) break;
            visited.add(key);
            let next = current;
            const forward = [ current[0] + delta[0], current[1] + delta[1] ];
            if ((delta[0] || delta[1]) && path(forward)) next = forward; else {
                const turn = dirs.find(d => (d[0] !== -delta[0] || d[1] !== -delta[1]) && path([ current[0] + d[0], current[1] + d[1] ]));
                if (turn) next = [ current[0] + turn[0], current[1] + turn[1] ];
                if (same(next, last)) next = [ next[0] - delta[0], next[1] - delta[1] ];
            }
            if (same(next, current)) break;
            tiles.push(next);
            const c = cell(next), flags = c?.[1] || [];
            if (c?.[0] === 7) return {
                type: "internal",
                end: next,
                tiles: tiles
            };
            if (flags.includes(6)) return {
                type: "exit",
                end: next,
                tiles: tiles
            };
            if (flags.some(f => [ 7, 19, 21 ].includes(f))) return {
                type: "other",
                end: next,
                tiles: tiles
            };
            last = current;
            current = next;
        }
        return {
            type: "dead-end",
            end: current,
            tiles: tiles
        };
    }
    const rainedPlayableBoundsCache = new WeakMap;
    function rainedPlayableBounds(room) {
        const cached = rainedPlayableBoundsCache.get(room);
        if (cached && cached.source === room.rainedSource && cached.w === room.w && cached.h === room.h && cached.sourceW === room.rainedSize?.w && cached.sourceH === room.rainedSize?.h) return cached;
        const bounds = {
            source: room.rainedSource,
            w: room.w,
            h: room.h,
            sourceW: room.rainedSize?.w,
            sourceH: room.rainedSize?.h,
            left: 0,
            top: 0,
            right: room.w,
            bottom: room.h,
            valid: true
        };
        if (room.rainedSource && room.rainedSize?.w === room.w && room.rainedSize?.h === room.h) {
            const line = room.rainedSource.split(/\r\n|\r|\n/)[5] || "", match = /#?extraTiles\s*:\s*\[([^\]]*)\]/i.exec(line), margins = match?.[1].split(",").map(v => v.trim() ? Number(v.trim()) : NaN);
            if (!margins || margins.length !== 4 || margins.some(n => !Number.isInteger(n) || n < 0) || margins[0] + margins[2] >= room.w || margins[1] + margins[3] >= room.h) bounds.valid = false; else Object.assign(bounds, {
                left: margins[0],
                top: margins[1],
                right: room.w - margins[2],
                bottom: room.h - margins[3]
            });
        }
        rainedPlayableBoundsCache.set(room, bounds);
        return bounds;
    }
    function rainedInPlayableBounds(bounds, at) {
        return bounds.valid && at[0] >= bounds.left && at[1] >= bounds.top && at[0] < bounds.right && at[1] < bounds.bottom;
    }
    function rainedRenderedBounds(room) {
        const b = rainedPlayableBounds(room);
        return {
            left: b.left,
            top: b.top,
            width: b.right - b.left,
            height: b.bottom - b.top,
            sourceWidth: b.w,
            sourceHeight: b.h,
            valid: b.valid
        };
    }
    function rainedGamePoint(bounds, at) {
        return at ? {
            x: at.x - bounds.left,
            y: at.y - bounds.top
        } : null;
    }
    function validateRainedShortcut(geometry, start, type, end, bounds) {
        const route = traceRainedShortcut(geometry, start), same = (a, b) => a[0] === b[0] && a[1] === b[1], dirs = {
            left: [ -1, 0 ],
            up: [ 0, -1 ],
            right: [ 1, 0 ],
            down: [ 0, 1 ]
        }, network = c => c?.[0] === 7 || c?.[1].some(f => [ 4, 5, 6, 7, 19, 21 ].includes(f));
        if (route.type !== type || end && !same(route.end, end)) return {
            valid: false,
            reason: "捷径没有通向指定类型的另一端。",
            route: route
        };
        if (bounds && route.tiles.some(at => !rainedInPlayableBounds(bounds, at))) return {
            valid: false,
            reason: "入口、路径或出口节点超出 Rained 白框内的可玩区域。",
            route: route
        };
        const open = Object.entries(dirs).filter(([, d]) => geometry[start[0] + d[0]]?.[start[1] + d[1]]?.[0]?.[0] !== 1);
        if (geometry[start[0]]?.[start[1]]?.[0]?.[0] !== 7 || open.length !== 1) return {
            valid: false,
            reason: "入口需要三面实体墙和一个空气或台阶开口。",
            route: route
        };
        if ([ [ -1, -1 ], [ 1, -1 ], [ -1, 1 ], [ 1, 1 ] ].some(d => geometry[start[0] + d[0]]?.[start[1] + d[1]]?.[0]?.[0] !== 1)) return {
            valid: false,
            reason: "入口四角必须都是实体墙，开口需向墙内退一格。",
            route: route
        };
        const front = open[0][1], frontCell = geometry[start[0] + front[0]]?.[start[1] + front[1]]?.[0], behind = geometry[start[0] - front[0]]?.[start[1] - front[1]]?.[0];
        if (bounds && !rainedInPlayableBounds(bounds, [ start[0] + front[0], start[1] + front[1] ])) return {
            valid: false,
            reason: "入口开口超出 Rained 白框内的可玩区域。",
            route: route
        };
        if (![ 0, 6 ].includes(frontCell?.[0]) || !behind?.[1].some(f => [ 5, 6, 7, 19, 21 ].includes(f))) return {
            valid: false,
            reason: "入口开口应为空气或台阶，捷径路径必须从开口反方向开始。",
            route: route
        };
        for (let i = 0; i < route.tiles.length; i++) {
            const p = route.tiles[i], neighbors = Object.values(dirs).filter(d => network(geometry[p[0] + d[0]]?.[p[1] + d[1]]?.[0])).length;
            if (neighbors !== (i === 0 || i === route.tiles.length - 1 ? 1 : 2)) return {
                valid: false,
                reason: "捷径路径存在分叉或相邻线路冲突。",
                route: route
            };
        }
        return {
            valid: true,
            reason: "",
            route: route,
            facing: open[0][0]
        };
    }
    const nativeShortcutTileCache = new WeakMap;
    function rainedNativeTileCells(room) {
        const cached = nativeShortcutTileCache.get(room);
        if (cached && cached.source === room.rainedSource) return cached;
        const result = {
            source: room.rainedSource,
            cells: new Set,
            unreadable: false
        };
        if (room.rainedSource) try {
            const line = room.rainedSource.split(/\r\n|\r|\n/)[1] || "", match = /#tlMatrix\s*:\s*/i.exec(line);
            if (!match) throw Error("no tile matrix");
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
            const columns = lingoListItems(line.slice(start, end));
            for (let x = 0; x < columns.length; x++) {
                const rows = lingoListItems(columns[x]);
                for (let y = 0; y < rows.length; y++) {
                    const layers = lingoListItems(rows[y]);
                    if (/#tp\s*:\s*"tile(?:Head|Body)"/i.test(layers[0] || "")) result.cells.add(x + "," + y);
                }
            }
        } catch {
            result.unreadable = true;
        }
        nativeShortcutTileCache.set(room, result);
        return result;
    }
    function rainedPlacementCandidates(r, room, p, {geometry: geometry, reserved: reserved = new Set, portSites: portSites = new Map, planned: planned = []} = {}) {
        const geo = geometry || raster(r, room), bounds = rainedPlayableBounds(room), dirs = {
            left: [ -1, 0 ],
            up: [ 0, -1 ],
            right: [ 1, 0 ],
            down: [ 0, 1 ]
        }, steps = Object.values(dirs), key = p => p.join(","), add = (a, b, n = 1) => [ a[0] + b[0] * n, a[1] + b[1] * n ], cell = p => geo[p[0]]?.[p[1]]?.[0], network = c => c?.[0] === 7 || c?.[1].some(f => [ 4, 5, 6, 7, 19, 21 ].includes(f));
        const at = rainedPortAnchor(room, p).entrance, type = p.kind === "internal" ? "internal" : "exit", explicit = Object.hasOwn(dirs, p.facing), visualSolid = q => geo[q[0]]?.[q[1]]?.some(c => c[0] === 1), open = Object.keys(dirs).filter(name => !visualSolid(add(at, dirs[name]))), edges = [ [ "down", at[1] ], [ "up", room.h - 1 - at[1] ], [ "right", at[0] ], [ "left", room.w - 1 - at[0] ] ].sort((a, b) => a[1] - b[1]), preferred = open.length === 1 ? open[0] : edges.find(([name]) => open.includes(name))?.[0] || edges[0][0], names = explicit ? [ p.facing ] : [ preferred, ...Object.keys(dirs).filter(d => d !== preferred) ];
        if (!bounds.valid || !rainedInPlayableBounds(bounds, at)) return [ {
            valid: false,
            at: at,
            reason: bounds.valid ? "入口位于 Rained 白框外，不能生成可通行捷径。" : "无法读取原生房间的 Rained 白框边界，未生成捷径。"
        } ];
        if (![ "exit", "internal" ].includes(p.kind)) return [ {
            valid: false,
            at: at,
            reason: "此类型需要在 Rained 配置专用节点。"
        } ];
        if (portSites.get(key(at))?.some(id => id !== p.id)) return [ {
            valid: false,
            at: at,
            reason: "此格已有另一个通道井，请保留一个入口。"
        } ];
        if (cell(at)?.[0] === 7) {
            const found = validateRainedShortcut(geo, at, type, undefined, bounds);
            if (found.valid && (!explicit || found.facing === p.facing)) return [ {
                valid: true,
                reason: "复用现有入口",
                at: at,
                tail: found.route.end,
                network: found.route.tiles,
                patch: new Map,
                facing: found.facing,
                port: p.id,
                reused: true,
                route: found.route
            } ];
            return [ {
                valid: false,
                at: at,
                reason: found.reason || "此处已有入口与所选类型或朝向不符，不能覆盖。"
            } ];
        }
        const nativeTiles = rainedNativeTileCells(room);
        return names.map(name => {
            const front = dirs[name], back = [ -front[0], -front[1] ], side = [ -front[1], front[0] ], tail = add(at, back, 2), tiles = [ at, add(at, back), tail ], patch = new Map, writes = [ {
                at: at,
                value: 7,
                flag: 4,
                role: "mouth"
            }, {
                at: add(at, back),
                value: 1,
                flag: 5,
                role: "path"
            }, {
                at: tail,
                value: type === "exit" ? 1 : null,
                flag: type === "exit" ? 6 : 5,
                role: type === "exit" ? "node" : "path"
            }, {
                at: add(at, side),
                value: 1,
                role: "solid"
            }, {
                at: add(at, side, -1),
                value: 1,
                role: "solid"
            }, ...[ -1, 1 ].flatMap(n => [ -1, 1 ].map(m => ({
                at: add(add(at, front, n), side, m),
                value: 1,
                role: "solid"
            }))), {
                at: add(at, front),
                value: 0,
                role: "air"
            }, {
                at: add(at, front, 2),
                value: 0,
                role: "air"
            } ];
            let reason = "";
            for (const write of writes) {
                const k = key(write.at), c = cell(write.at);
                if ((write.flag || write.role === "air") && !rainedInPlayableBounds(bounds, write.at)) {
                    reason = "入口、开口、路径或出口节点超出 Rained 白框内的可玩区域。";
                    break;
                }
                if (!c) {
                    reason = "入口、空气开口或出口节点超出房间边界。";
                    break;
                }
                const next = [ write.value === null ? c[0] : write.value, [ ...c[1] ] ];
                if (write.flag) next[1].push(write.flag);
                const sharedWallOrAir = [ "solid", "air" ].includes(write.role) && JSON.stringify(next) === JSON.stringify(c);
                if (reserved.has(k) && !sharedWallOrAir || portSites.get(k)?.some(id => id !== p.id)) {
                    reason = "入口范围与另一个通道井或已生成结构重叠。";
                    break;
                }
                if (![ 0, 1 ].includes(c[0]) || network(c)) {
                    reason = "入口范围与斜坡、台阶或已有捷径冲突。";
                    break;
                }
                patch.set(k, {
                    at: write.at,
                    cell: next,
                    role: write.role
                });
            }
            if (!reason && tiles.some(a => steps.some(d => network(cell(add(a, d)))))) reason = "入口紧邻已有捷径，会形成分叉。";
            if (!reason && [ ...patch.values() ].some(v => v.cell[0] === 1 !== (cell(v.at)[0] === 1) && [ ...steps, [ -1, -1 ], [ 1, -1 ], [ -1, 1 ], [ 1, 1 ] ].some(d => cell(add(v.at, d))?.[0] === 7))) reason = "入口会改变已有捷径的开口或边墙，不能覆盖。";
            if (!reason) for (const other of planned) {
                const conflict = [ ...patch ].some(([k, v]) => {
                    const old = other.patch?.get(k);
                    return old && (network(v.cell) || network(old.cell) || JSON.stringify(v.cell) !== JSON.stringify(old.cell));
                }), near = tiles.some(a => steps.some(d => other.network?.some(b => key(b) === key(add(a, d)))));
                if (conflict || near) {
                    reason = "入口范围与另一个通道井的计划入口冲突，请留出开口和独立路径。";
                    break;
                }
            }
            const tileConflicts = [ ...patch.values() ].filter(v => nativeTiles.cells.has(key(v.at)) && v.cell[0] !== cell(v.at)[0]).map(v => ({
                x: v.at[0],
                y: v.at[1]
            }));
            return {
                valid: !reason,
                reason: reason || (tileConflicts.length ? "入口会改变已有贴块覆盖的地形，请在 Rained 检查贴块。" : ""),
                at: at,
                tail: tail,
                network: tiles,
                patch: patch,
                facing: name,
                port: p.id,
                reused: false,
                tileConflicts: tileConflicts,
                nativeTilesUnchecked: nativeTiles.unreadable
            };
        });
    }
    function rainedPortSurface(r, room, geo, kind, candidate) {
        if (candidate.reused) return "foreground";
        const bounds = rainedPlayableBounds(room);
        if (!rainedInPlayableBounds(bounds, candidate.at)) return null;
        const d = {
            left: [ -1, 0 ],
            up: [ 0, -1 ],
            right: [ 1, 0 ],
            down: [ 0, 1 ]
        }[candidate.facing];
        if (!d) return null;
        const terrain = at => geo[at[0]]?.[at[1]]?.[0]?.[0];
        const at = candidate.at, back = [ at[0] - d[0], at[1] - d[1] ], side = [ -d[1], d[0] ], walls = [ back, ...[ -1, 0, 1 ].flatMap(n => [ -1, 1 ].map(m => [ at[0] + d[0] * n + side[0] * m, at[1] + d[1] * n + side[1] * m ])) ];
        if (kind === "exit") walls.push([ at[0] - d[0] * 2, at[1] - d[1] * 2 ]);
        const front = [ at[0] + d[0], at[1] + d[1] ], outside = [ at[0] + d[0] * 2, at[1] + d[1] * 2 ];
        if (![ front, outside, back, [ at[0] - d[0] * 2, at[1] - d[1] * 2 ] ].every(q => rainedInPlayableBounds(bounds, q))) return null;
        if (![ 0, 1 ].includes(terrain(front)) || terrain(outside) !== 0) return null;
        if (walls.every(q => terrain(q) === 1)) return "foreground";
        if (terrain(at) === 1) return "repair-foreground";
        return null;
    }
    const placementSurfaceCache = new WeakMap, nativeRepairPlanningCache = new WeakMap;
    function rainedSurfaceIndex(r, room, geometry, kind) {
        let cache = placementSurfaceCache.get(geometry);
        if (!cache) {
            cache = new Map;
            placementSurfaceCache.set(geometry, cache);
        }
        const key = room.id + ":" + kind;
        if (cache.has(key)) return cache.get(key);
        const entries = [];
        for (let y = 1; y < room.h - 1; y++) for (let x = 1; x < room.w - 1; x++) {
            if (![ 0, 1 ].includes(geometry[x][y][0][0])) continue;
            for (const facing of [ "left", "up", "right", "down" ]) {
                const surface = rainedPortSurface(r, room, geometry, kind, {
                    at: [ x, y ],
                    facing: facing
                });
                if (surface) entries.push({
                    at: [ x, y ],
                    facing: facing,
                    surface: surface
                });
            }
        }
        cache.set(key, entries);
        return entries;
    }
    function rainedRankSurfaces(r, room, geometry, p) {
        const px = p.x - room.x, py = p.y - room.y, base = [ Math.floor(px), Math.floor(py) ];
        return rainedSurfaceIndex(r, room, geometry, p.kind).map(c => ({
            ...c,
            distance: Math.hypot(c.at[0] + .5 - px, c.at[1] + .5 - py)
        })).sort((a, b) => a.distance + (a.surface.startsWith("repair-") ? 1 : 0) - (b.distance + (b.surface.startsWith("repair-") ? 1 : 0)) || (a.surface.startsWith("repair-") ? 1 : 0) - (b.surface.startsWith("repair-") ? 1 : 0) || a.distance - b.distance || (a.surface === "foreground" ? 0 : 1) - (b.surface === "foreground" ? 0 : 1) || Math.abs(a.at[0] - base[0]) + Math.abs(a.at[1] - base[1]) - (Math.abs(b.at[0] - base[0]) + Math.abs(b.at[1] - base[1])) || a.at[1] - b.at[1] || a.at[0] - b.at[0]);
    }
    function rainedRepairNativeEntrance(r, room, p, {geometry: geometry, portSites: portSites = new Map, planned: planned = [], searchRoom: searchRoom = true, targetPosition: targetPosition} = {}) {
        const geo = geometry || raster(r, room), at = rainedPortAnchor(room, p).entrance, key = q => q.join(","), same = (a, b) => key(a) === key(b), steps = [ [ 1, 0 ], [ -1, 0 ], [ 0, 1 ], [ 0, -1 ] ], add = (a, d, n = 1) => [ a[0] + d[0] * n, a[1] + d[1] * n ], cell = q => geo[q[0]]?.[q[1]]?.[0], network = c => c?.[0] === 7 || c?.[1].some(f => [ 4, 5, 6, 7, 19, 21 ].includes(f)), bounds = rainedPlayableBounds(room), tiles = rainedNativeTileCells(room), type = p.kind === "internal" ? "internal" : "exit";
        const fail = reason => ({
            valid: false,
            at: at,
            reason: reason
        });
        if (cell(at)?.[0] !== 7) return fail("原位置没有可修复的原生入口。");
        if (portSites.get(key(at))?.some(id => id !== p.id)) return fail("同一原生入口有多个标记，无法确定应修复哪一个。");
        if (!bounds.valid || tiles.unreadable) return fail("无法确认原生房间的白框或贴块范围，已保留原入口。");
        const original = validateRainedShortcut(geo, at, type, undefined, bounds);
        if (original.valid && !targetPosition) return {
            valid: true,
            at: at,
            tail: original.route.end,
            network: original.route.tiles,
            patch: new Map,
            facing: original.facing,
            reused: true,
            route: original.route,
            port: p.id
        };
        const route = traceRainedShortcut(geo, at), component = [], seen = new Set, queue = [ at ];
        for (let i = 0; i < queue.length && queue.length <= 2e3; i++) {
            const q = queue[i], k = key(q);
            if (seen.has(k) || !network(cell(q))) continue;
            seen.add(k);
            component.push(q);
            for (const d of steps) {
                const n = add(q, d);
                if (network(cell(n)) && !seen.has(key(n))) queue.push(n);
            }
        }
        const linear = component.length <= 1e3 && component.every(q => steps.filter(d => network(cell(add(q, d)))).length <= 2), hasRoute = route.type === type && route.tiles.every(q => rainedInPlayableBounds(bounds, q)) && linear, orphan = route.type === "dead-end" && linear && component.filter(q => cell(q)[0] === 7).length === 1 && component.every(q => !cell(q)[1].some(f => [ 6, 7, 19, 21 ].includes(f)));
        if (!hasRoute && !orphan || component.some(q => !rainedInPlayableBounds(bounds, q))) return fail("原生线路分叉、越过白框或目标类型不一致，不能安全改接。");
        const plannedNetwork = new Set(planned.flatMap(c => c.network || []).map(key)), plannedCells = new Set(planned.flatMap(c => [ ...c.patch?.keys() || [] ])), routeSet = new Set(component.map(key)), viewOf = patch => {
            const view = geo.map(col => col.slice());
            for (const other of planned) for (const v of other.patch?.values() || []) view[v.at[0]][v.at[1]] = [ v.cell, ...geo[v.at[0]][v.at[1]].slice(1) ];
            for (const v of patch.values()) view[v.at[0]][v.at[1]] = [ v.cell, ...geo[v.at[0]][v.at[1]].slice(1) ];
            return view;
        };
        function safePatch(patch) {
            for (const [k, v] of patch) {
                const c = cell(v.at);
                if (!c || portSites.get(k)?.some(id => id !== p.id)) return false;
                if (v.cell[0] !== c[0] && (tiles.cells.has(k) || [ ...steps, [ -1, -1 ], [ 1, -1 ], [ -1, 1 ], [ 1, 1 ] ].some(d => {
                    const q = add(v.at, d);
                    return !same(q, at) && cell(q)?.[0] === 7;
                }))) return false;
                if (network(c) && !routeSet.has(k) && JSON.stringify(c) !== JSON.stringify(v.cell)) return false;
                for (const other of planned) {
                    const old = other.patch?.get(k);
                    if (old && (network(v.cell) || network(old.cell) || JSON.stringify(v.cell) !== JSON.stringify(old.cell))) return false;
                }
            }
            return true;
        }
        function result(candidate, patch, nativeRoute) {
            const changes = [ ...patch.values() ].filter(v => JSON.stringify(v.cell) !== JSON.stringify(cell(v.at)));
            return {
                ...candidate,
                valid: true,
                reason: "已自动修复原生入口并保留原线路。",
                patch: nativeRoute ? patch : new Map([ ...patch, ...candidate.patch ]),
                nativeRepair: true,
                reused: !!nativeRoute,
                route: nativeRoute,
                network: nativeRoute?.tiles || candidate.network,
                repair: {
                    kind: nativeRoute ? "native-route" : "orphan-mouth",
                    source: {
                        x: at[0],
                        y: at[1]
                    },
                    cells: changes.map(v => ({
                        x: v.at[0],
                        y: v.at[1],
                        cell: clone(v.cell)
                    }))
                }
            };
        }
        if (!targetPosition && hasRoute && route.tiles.length > 1) {
            const back = [ route.tiles[1][0] - at[0], route.tiles[1][1] - at[1] ], front = [ -back[0], -back[1] ], side = [ -front[1], front[0] ], outside = add(at, front, 2), facing = Object.entries({
                left: [ -1, 0 ],
                up: [ 0, -1 ],
                right: [ 1, 0 ],
                down: [ 0, 1 ]
            }).find(([, d]) => same(d, front))?.[0], patch = new Map;
            if (facing && cell(outside)?.[0] === 0 && rainedInPlayableBounds(bounds, outside)) {
                const writes = [ {
                    at: add(at, back),
                    value: 1
                }, {
                    at: add(at, front),
                    value: 0
                }, ...[ -1, 0, 1 ].flatMap(n => [ -1, 1 ].map(m => ({
                    at: add(add(at, front, n), side, m),
                    value: 1
                }))) ];
                let valid = true;
                for (const w of writes) {
                    const c = cell(w.at);
                    if (!c || ![ 0, 1 ].includes(c[0]) || network(c) && !same(w.at, route.tiles[1])) {
                        valid = false;
                        break;
                    }
                    patch.set(key(w.at), {
                        at: w.at,
                        cell: [ w.value, [ ...c[1] ] ],
                        role: w.value ? "solid" : "air"
                    });
                }
                if (valid && safePatch(patch)) {
                    const checked = validateRainedShortcut(viewOf(patch), at, type, route.end, bounds);
                    if (checked.valid) return result({
                        at: at,
                        tail: route.end,
                        facing: facing,
                        port: p.id
                    }, patch, checked.route);
                }
            }
        }
        if (!searchRoom) return fail("原入口周围没有连通的安全空气开口。");
        const cleared = new Map;
        for (const q of component) {
            const c = cell(q);
            cleared.set(key(q), {
                at: q,
                cell: [ c[0] === 7 ? 1 : c[0], c[1].filter(f => ![ 4, 5, 6, 7, 19, 21 ].includes(f)) ],
                role: "path"
            });
        }
        let cache = nativeRepairPlanningCache.get(geo);
        if (!cache) {
            cache = new Map;
            nativeRepairPlanningCache.set(geo, cache);
        }
        const cacheKey = room.id + ":" + key(at);
        let planning = cache.get(cacheKey);
        if (!planning) {
            planning = geo.map(col => col.slice());
            for (const v of cleared.values()) planning[v.at[0]][v.at[1]] = [ v.cell, ...geo[v.at[0]][v.at[1]].slice(1) ];
            cache.set(cacheKey, planning);
        }
        const ranked = rainedRankSurfaces(r, room, planning, {
            ...p,
            ...targetPosition,
            kind: hasRoute ? "internal" : p.kind
        });
        for (const entry of ranked) {
            if (hasRoute && network(cell(entry.at))) continue;
            const proposal = {
                ...p,
                x: room.x + entry.at[0] + .5,
                y: room.y + entry.at[1] + .5,
                kind: hasRoute ? "internal" : p.kind,
                facing: entry.facing
            };
            for (const candidate of rainedPlacementCandidates(r, room, proposal, {
                geometry: planning,
                portSites: portSites,
                planned: planned
            }).filter(c => c.valid && !c.reused && !c.tileConflicts?.length && !c.nativeTilesUnchecked)) {
                if (orphan) {
                    if (!safePatch(cleared)) continue;
                    return result(candidate, cleared, null);
                }
                const patch = new Map(candidate.patch), old = cell(at);
                patch.set(key(at), {
                    at: at,
                    cell: [ 1, [ ...old[1].filter(f => f !== 4), 5 ].filter((f, i, a) => a.indexOf(f) === i) ],
                    role: "path"
                });
                let compatible = true;
                for (const [k, v] of patch) if (routeSet.has(k) && k !== key(at)) {
                    const c = cell(v.at);
                    if (v.cell[0] !== c[0] || v.role === "mouth" || c[1].some(f => [ 6, 7, 19, 21 ].includes(f))) {
                        compatible = false;
                        break;
                    }
                    v.cell = [ c[0], [ ...new Set([ ...c[1], ...v.cell[1] ]) ] ];
                }
                if (!compatible || !safePatch(patch)) continue;
                let checked = validateRainedShortcut(viewOf(patch), candidate.at, type, route.end, bounds);
                if (checked.valid) return result(candidate, patch, checked.route);
                const prefix = new Set(candidate.network.map(key)), start = key(candidate.tail), goal = key(at), previous = new Map([ [ start, null ] ]), walk = [ candidate.tail ];
                let cursor = 0;
                const allowed = q => {
                    const k = key(q);
                    if (k === goal) return true;
                    if (!rainedInPlayableBounds(bounds, q) || portSites.has(k) && k !== key(at) || patch.has(k) || plannedCells.has(k) || network(cell(q))) return false;
                    return !steps.some(d => {
                        const n = add(q, d), nk = key(n);
                        return network(cell(n)) && nk !== goal || prefix.has(nk) && nk !== start || plannedNetwork.has(nk);
                    });
                };
                while (cursor < walk.length && !previous.has(goal)) {
                    const q = walk[cursor++];
                    for (const n of steps.map(d => add(q, d)).sort((a, b) => Math.abs(a[0] - at[0]) + Math.abs(a[1] - at[1]) - Math.abs(b[0] - at[0]) - Math.abs(b[1] - at[1]))) {
                        const k = key(n);
                        if (previous.has(k) || !allowed(n)) continue;
                        previous.set(k, key(q));
                        walk.push(n);
                    }
                }
                if (!previous.has(goal)) continue;
                for (let k = goal; k !== null; k = previous.get(k)) {
                    if (patch.has(k)) continue;
                    const q = k.split(",").map(Number), c = cell(q);
                    patch.set(k, {
                        at: q,
                        cell: [ c[0], [ ...new Set([ ...c[1], 5 ]) ] ],
                        role: "path"
                    });
                }
                if (!safePatch(patch)) continue;
                checked = validateRainedShortcut(viewOf(patch), candidate.at, type, route.end, bounds);
                if (checked.valid) return result(candidate, patch, checked.route);
            }
        }
        return fail("同一房间内没有能安全接回原线路的空气边界；原入口和贴块已保留。");
    }
    function applyPortPlacement(r, p, suggestion) {
        if (!suggestion?.valid) throw Error(suggestion?.reason || "没有可用的安全入口位置。");
        const room = r.rooms.find(rm => rm.id === suggestion.roomId);
        if (!room) throw Error("入口所属房间不存在。");
        if (suggestion.repair?.cells?.length) {
            rememberRainedRoom(r, room);
            for (const change of suggestion.repair.cells) {
                const id = "shortcut-repair-" + p.id + "-" + change.x + "-" + change.y;
                const shape = {
                    id: id,
                    type: "rect",
                    x: room.x + change.x,
                    y: room.y + change.y,
                    w: 1,
                    h: 1,
                    layer: room.layer,
                    roomId: room.id,
                    depth: 0,
                    material: "solid",
                    rawCell: clone(change.cell),
                    shortcutRepair: p.id
                };
                const previous = r.shapes.findIndex(s => s.id === id);
                if (previous >= 0) r.shapes.splice(previous, 1);
                r.shapes.push(shape);
            }
        }
        Object.assign(p, suggestion.position, {
            facing: suggestion.facing,
            roomId: room.id
        });
        delete p.placementIssue;
        return p;
    }
    function suggestPortPlacement(r, p, {snap: snap = true, searchRadius: searchRadius = 4, geometry: geometry, searchRoom: searchRoom = true} = {}) {
        const radius = Math.max(0, Math.min(4, Number(searchRadius) || 0)), declared = r.rooms.find(rm => rm.id === p.roomId && rm.layer === p.layer), room = portRoomOwner(r, p) || (declared && p.x >= declared.x - radius && p.x <= declared.x + declared.w + radius && p.y >= declared.y - radius && p.y <= declared.y + declared.h + radius ? declared : null);
        const failure = (reason, position = {
            x: p.x,
            y: p.y
        }) => ({
            valid: false,
            reason: reason,
            position: position,
            roomId: room?.id || null,
            candidates: [],
            preview: {
                cells: []
            }
        });
        if (!room) return failure("请在唯一的目标房间内放置通道井。");
        const geo = geometry || raster(r, room), pointer = [ p.x - room.x, p.y - room.y ], base = pointer.map(Math.floor), anchor = rainedPortAnchor(room, p), sites = new Map, others = [];
        const stored = r.ports.find(other => other.id === p.id), storedOwner = stored && portRoomOwner(r, stored);
        let nativeMove = null;
        if (storedOwner) {
            const original = rainedPortAnchor(storedOwner, stored).entrance, originalGeo = storedOwner.id === room.id ? geo : raster(r, storedOwner);
            if (originalGeo[original[0]]?.[original[1]]?.[0]?.[0] === 7 && (storedOwner.id !== room.id || original[0] !== anchor.entrance[0] || original[1] !== anchor.entrance[1])) {
                if (storedOwner.id !== room.id) return failure("已有实际线路的入口只能在同一房间内安全移动。");
                nativeMove = stored;
            }
        }
        for (const other of r.ports) {
            if (other.id === p.id || portRoomOwner(r, other)?.id !== room.id) continue;
            const a = rainedPortAnchor(room, other);
            for (const at of [ a.source, a.entrance ]) {
                const k = at.join(",");
                sites.set(k, [ ...sites.get(k) || [], other.id ]);
            }
            others.push(other);
        }
        if (sites.has(base.join(","))) return failure("这一格已经有通道井。", {
            x: room.x + base[0] + .5,
            y: room.y + base[1] + .5
        });
        const planned = others.map(other => rainedPlacementCandidates(r, room, other, {
            geometry: geo,
            portSites: sites
        }).find(c => c.valid && !c.reused)).filter(Boolean), options = [], tileDistance = c => Math.abs(c.at[0] - base[0]) + Math.abs(c.at[1] - base[1]);
        const score = c => c.distance + (c.surface?.startsWith("repair-") ? 1 : 0), rank = (a, b) => score(a) - score(b) || (a.surface?.startsWith("repair-") ? 1 : 0) - (b.surface?.startsWith("repair-") ? 1 : 0) || a.distance - b.distance || tileDistance(a) - tileDistance(b) || a.at[1] - b.at[1] || a.at[0] - b.at[0];
        function annotate(c, surface) {
            return {
                ...c,
                valid: c.valid && !!surface && !c.tileConflicts?.length && !c.nativeTilesUnchecked,
                reason: c.reason || (!surface ? "这里没有可安全补齐入口的空气边界。" : ""),
                position: {
                    x: room.x + c.at[0] + .5,
                    y: room.y + c.at[1] + .5
                },
                surface: surface,
                distance: Math.hypot(c.at[0] + .5 - pointer[0], c.at[1] + .5 - pointer[1])
            };
        }
        function inspect(at, facing = p.facing) {
            if (at[0] < 1 || at[1] < 1 || at[0] >= room.w - 1 || at[1] >= room.h - 1) return [];
            const proposed = {
                ...p,
                roomId: room.id,
                x: room.x + at[0] + .5,
                y: room.y + at[1] + .5,
                facing: facing
            };
            return rainedPlacementCandidates(r, room, proposed, {
                geometry: geo,
                portSites: sites,
                planned: planned
            }).map(c => annotate(c, rainedPortSurface(r, room, geo, p.kind, c)));
        }
        let chosen;
        if (nativeMove || geo[anchor.entrance[0]]?.[anchor.entrance[1]]?.[0]?.[0] === 7) {
            const native = rainedRepairNativeEntrance(r, room, nativeMove || p, {
                geometry: geo,
                portSites: sites,
                planned: planned,
                searchRoom: snap && searchRoom,
                targetPosition: nativeMove ? {
                    x: p.x,
                    y: p.y
                } : undefined
            });
            if (!native.valid) return failure(native.reason);
            chosen = annotate(native, "foreground");
            options.push(chosen);
        } else {
            for (let dy = -(snap ? Math.ceil(radius) : 0); dy <= (snap ? Math.ceil(radius) : 0); dy++) for (let dx = -(snap ? Math.ceil(radius) : 0); dx <= (snap ? Math.ceil(radius) : 0); dx++) {
                const at = [ base[0] + dx, base[1] + dy ];
                if (!snap || Math.hypot(at[0] + .5 - pointer[0], at[1] + .5 - pointer[1]) <= radius) options.push(...inspect(at));
            }
            chosen = options.filter(c => c.valid).sort(rank)[0];
            if (snap && searchRoom && (!chosen || chosen.surface.startsWith("repair-"))) {
                for (const entry of rainedRankSurfaces(r, room, geo, p)) {
                    if ([ "left", "up", "right", "down" ].includes(p.facing) && entry.facing !== p.facing) continue;
                    if (chosen && score(entry) > score(chosen) + 1e-8) break;
                    const candidate = inspect(entry.at, entry.facing).find(c => c.valid);
                    if (candidate && (!chosen || rank(candidate, chosen) < 0)) {
                        chosen = candidate;
                        options.push(candidate);
                    }
                    if (chosen && !chosen.surface.startsWith("repair-")) break;
                }
            }
        }
        if (!chosen) return failure(options.find(c => c.reason && /冲突|重叠|已有|白框|贴块/.test(c.reason))?.reason || "同一房间内没有可安全补齐入口的空气边界；请先在 Geometry 层画出实心墙。", {
            x: room.x + base[0] + .5,
            y: room.y + base[1] + .5
        });
        const cells = [ ...chosen.patch?.values() || [] ].map(v => ({
            x: room.x + v.at[0],
            y: room.y + v.at[1],
            w: 1,
            h: 1,
            terrain: v.cell[0],
            features: v.cell[1],
            role: v.role
        })), warnings = [];
        if (chosen.surface?.startsWith("repair-")) warnings.push("此处墙体不足，已预留入口所需的完整边墙和空气凹口。");
        return {
            valid: chosen.valid,
            reason: chosen.nativeRepair ? chosen.reason : chosen.distance > radius ? "已自动对齐到同一房间最近的安全空气边界。" : chosen.reason,
            roomId: room.id,
            position: chosen.position,
            facing: chosen.facing,
            sourceTile: {
                x: anchor.source[0],
                y: anchor.source[1]
            },
            entrance: {
                x: chosen.at[0],
                y: chosen.at[1]
            },
            worldEntrance: chosen.position,
            boundaryAdjusted: anchor.boundaryAdjusted,
            snapped: chosen.position.x !== p.x || chosen.position.y !== p.y,
            reused: chosen.reused,
            nativeRepair: !!chosen.nativeRepair,
            repair: chosen.repair,
            tileConflicts: [],
            nativeTilesUnchecked: false,
            warnings: warnings,
            preview: {
                cells: cells
            },
            candidates: options.map(c => ({
                valid: c.valid,
                reason: c.reason,
                facing: c.facing,
                position: c.position,
                entrance: {
                    x: c.at[0],
                    y: c.at[1]
                },
                surface: c.surface
            }))
        };
    }
    const portNormalizationReports = new WeakMap, portPlacementVersion = 3;
    function portNormalizationSummary(w) {
        return portNormalizationReports.get(w) || {
            version: portPlacementVersion,
            changed: false,
            updated: 0,
            ownershipRepairs: 0,
            unresolved: 0,
            nativePreserved: 0,
            entries: []
        };
    }
    function normalizeLegacyPorts(w) {
        const report = {
            version: portPlacementVersion,
            changed: false,
            updated: 0,
            ownershipRepairs: 0,
            unresolved: 0,
            nativePreserved: 0,
            entries: []
        };
        portNormalizationReports.set(w, report);
        const legacy = w.settings?.portPlacementVersion !== portPlacementVersion;
        if (!legacy && !w.regions.some(r => r.ports.some(p => p.placementIssue))) return report;
        const key = at => at.join(",");
        for (const r of w.regions) {
            const records = [], states = new Map;
            for (const p of [ ...r.ports ].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
                if (![ "exit", "internal" ].includes(p.kind)) continue;
                const before = {
                    x: p.x,
                    y: p.y,
                    roomId: p.roomId || null,
                    facing: p.facing ?? null,
                    issue: p.placementIssue || null
                }, owner = portRoomOwner(r, p), record = {
                    region: r.id,
                    port: p.id,
                    before: before,
                    room: owner?.id || null,
                    status: legacy || p.placementIssue ? "unchanged" : "preserved-versioned"
                };
                records.push({
                    p: p,
                    owner: owner,
                    record: record
                });
                if (!owner) {
                    record.status = "unresolved";
                    record.reason = "无法唯一确定所属房间。";
                    continue;
                }
                if (p.roomId !== owner.id) {
                    p.roomId = owner.id;
                    report.ownershipRepairs++;
                }
                if (owner.roomType === "SHELTER" && p.kind === "exit") {
                    record.status = "fixed-shelter";
                    continue;
                }
                let state = states.get(owner.id);
                if (!state) {
                    try {
                        state = {
                            room: owner,
                            geometry: raster(r, owner),
                            sites: new Map,
                            assigned: [],
                            ports: []
                        };
                    } catch (error) {
                        state = {
                            room: owner,
                            error: error.message
                        };
                    }
                    states.set(owner.id, state);
                }
                if (state.error) {
                    record.status = "unresolved";
                    record.reason = state.error;
                    continue;
                }
                state.ports.push({
                    p: p,
                    record: record
                });
            }
            for (const state of states.values()) {
                if (state.error) continue;
                const {room: room, geometry: geometry} = state, atPort = p => rainedPortAnchor(room, p).entrance;
                function candidates(p, at, facing = p.facing) {
                    const proposed = {
                        ...p,
                        roomId: room.id,
                        x: room.x + at[0] + .5,
                        y: room.y + at[1] + .5,
                        facing: facing
                    };
                    return rainedPlacementCandidates(r, room, proposed, {
                        geometry: geometry,
                        portSites: state.sites,
                        planned: state.assigned
                    }).filter(c => c.valid && !c.tileConflicts?.length && !c.nativeTilesUnchecked && rainedPortSurface(r, room, geometry, p.kind, c));
                }
                function reserve(p, c) {
                    state.sites.set(key(c.at), [ p.id ]);
                    state.assigned.push(c);
                }
                function accept(p, record, c) {
                    const previous = atPort(p);
                    if (c.repair?.cells?.length) {
                        applyPortPlacement(r, p, {
                            ...c,
                            roomId: room.id,
                            position: {
                                x: room.x + c.at[0] + .5,
                                y: room.y + c.at[1] + .5
                            }
                        });
                        for (const v of c.repair.cells) geometry[v.x][v.y][0] = clone(v.cell);
                        placementSurfaceCache.delete(geometry);
                        nativeRepairPlanningCache.delete(geometry);
                        record.repairedCells = c.repair.cells.length;
                    } else Object.assign(p, {
                        x: room.x + c.at[0] + .5,
                        y: room.y + c.at[1] + .5,
                        facing: c.facing
                    });
                    if (key(previous) !== key(c.at)) {
                        const ids = (state.sites.get(key(previous)) || []).filter(id => id !== p.id);
                        if (ids.length) state.sites.set(key(previous), ids); else state.sites.delete(key(previous));
                    }
                    reserve(p, c);
                    record.status = c.nativeRepair ? "native-repaired" : "normalized";
                    record.surface = rainedPortSurface(r, room, geometry, p.kind, c);
                }
                for (const {p: p, record: record} of state.ports) {
                    const at = atPort(p);
                    if (record.status === "preserved-versioned") {
                        const c = candidates(p, at).find(Boolean);
                        if (c) reserve(p, c); else state.sites.set(key(at), [ p.id ]);
                    } else if (geometry[at[0]]?.[at[1]]?.[0]?.[0] === 7) state.sites.set(key(at), [ ...state.sites.get(key(at)) || [], p.id ]);
                }
                for (const {p: p, record: record} of state.ports) {
                    if (record.status !== "unchanged") continue;
                    const at = atPort(p);
                    if (geometry[at[0]]?.[at[1]]?.[0]?.[0] === 7) {
                        const c = candidates(p, at, "auto").find(c => c.reused);
                        if (c) {
                            reserve(p, c);
                            record.status = "native-preserved";
                            report.nativePreserved++;
                            if (p.facing && p.facing !== "auto" && p.facing !== c.facing) p.facing = c.facing;
                        }
                    } else {
                        const found = [ ...candidates(p, at), ...candidates(p, at, "auto") ].find(c => !c.reused && !rainedPortSurface(r, room, geometry, p.kind, c).startsWith("repair-"));
                        if (found) accept(p, record, found);
                    }
                }
                for (const {p: p, record: record} of state.ports) {
                    if (record.status !== "unchanged") continue;
                    const at = atPort(p);
                    let chosen;
                    if (geometry[at[0]]?.[at[1]]?.[0]?.[0] === 7) {
                        const repair = rainedRepairNativeEntrance(r, room, p, {
                            geometry: geometry,
                            portSites: state.sites,
                            planned: state.assigned
                        });
                        if (repair.valid) chosen = repair; else record.reason = repair.reason;
                    } else for (const entry of rainedRankSurfaces(r, room, geometry, p)) {
                        chosen = candidates(p, entry.at, entry.facing).find(c => !c.reused);
                        if (chosen) break;
                    }
                    if (chosen) accept(p, record, chosen); else {
                        record.status = "unresolved";
                        record.reason ||= "同一房间的可玩区域内没有可安全补齐入口的空气边界；原标记和连线已保留。";
                    }
                }
            }
            for (const {p: p, record: record} of records) {
                if (record.status === "unresolved") p.placementIssue = {
                    version: portPlacementVersion,
                    code: "SHORTCUT_PORT_PLACEMENT",
                    message: record.reason
                }; else if (record.status !== "preserved-versioned") delete p.placementIssue;
                const after = {
                    x: p.x,
                    y: p.y,
                    roomId: p.roomId || null,
                    facing: p.facing ?? null,
                    issue: p.placementIssue || null
                }, changed = JSON.stringify(record.before) !== JSON.stringify(after) || record.repairedCells > 0;
                if (changed) {
                    report.updated++;
                    record.after = after;
                }
                if (record.status === "unresolved") report.unresolved++;
                if (changed || record.status === "unresolved") report.entries.push(record);
            }
        }
        w.settings ||= {};
        w.settings.portPlacementVersion = portPlacementVersion;
        report.changed = legacy || report.updated > 0;
        return report;
    }
    function prepareRegionShortcuts(r) {
        const directions = {
            left: [ -1, 0 ],
            up: [ 0, -1 ],
            right: [ 1, 0 ],
            down: [ 0, 1 ]
        }, steps = Object.values(directions), key = p => p[0] + "," + p[1], same = (a, b) => a[0] === b[0] && a[1] === b[1], add = (a, b, n = 1) => [ a[0] + b[0] * n, a[1] + b[1] * n ];
        const isNetwork = c => c?.[0] === 7 || c?.[1].some(f => [ 4, 5, 6, 7, 19, 21 ].includes(f));
        const rooms = new Map(r.rooms.map(room => [ room.id, {
            room: room,
            geometry: raster(r, room),
            bounds: rainedPlayableBounds(room),
            reserved: new Set,
            portSites: new Map,
            endpoints: [],
            routes: []
        } ])), owners = new Map, ports = new Map(r.ports.map(p => [ p.id, p ])), diagnostics = [], ownershipRepairs = [], connections = [], degree = new Map;
        const issue = (code, p, message, extra = {}) => {
            const rm = owners.get(p?.id);
            diagnostics.push({
                code: code.startsWith("SHORTCUT_") ? code : "SHORTCUT_" + code,
                severity: "warning",
                room: rm?.id || p?.roomId,
                port: p?.id,
                message: (rm?.name || "通道井") + "：" + message,
                ...extra
            });
        };
        for (const p of r.ports) {
            const owner = portRoomOwner(r, p);
            if (owner) {
                owners.set(p.id, owner);
                if (owner.id !== p.roomId) {
                    const repair = {
                        port: p.id,
                        position: {
                            x: p.x,
                            y: p.y
                        },
                        previousRoom: p.roomId || null,
                        room: owner.id,
                        roomName: owner.name
                    };
                    ownershipRepairs.push(repair);
                    issue("PORT_OWNER_REPAIRED", p, "通道井所属房间与位置不符；导出副本按唯一包含它的房间校正为 " + owner.name + "，原项目不变。", repair);
                }
            } else issue("PORT_OWNER_UNRESOLVED", p, "无法唯一确定通道井所属房间，未生成实际捷径。");
        }
        for (const p of r.ports) {
            const rm = owners.get(p.id);
            if (rm) {
                const sites = rooms.get(rm.id).portSites, anchor = rainedPortAnchor(rm, p);
                for (const k of new Set([ key(anchor.source), key(anchor.entrance) ])) sites.set(k, [ ...sites.get(k) || [], p.id ]);
            }
        }
        for (const link of r.links) for (const id of [ link.a, link.b ]) degree.set(id, (degree.get(id) || 0) + 1);
        for (const p of r.ports) {
            if (!degree.get(p.id) && [ "exit", "internal" ].includes(p.kind)) issue("PORT_UNPAIRED", p, "通道井尚未连接另一端，保留原标记，不自动配对或生成入口。"); else if (degree.get(p.id) > 1) issue("PORT_MULTIPLE_LINKS", p, "一个通道井连接了多个目标，无法确定唯一实际捷径；请保留一个目标。"); else if (![ "exit", "internal" ].includes(p.kind)) issue("PORT_KIND_MANUAL", p, "此类通道井保留在清单中，需在 Rained 设置专用节点。");
        }
        const local = (s, p) => rainedPortAnchor(s.room, p).entrance, cell = (s, p) => s.geometry[p[0]]?.[p[1]]?.[0], within = (s, p) => rainedInPlayableBounds(s.bounds, p);
        function existing(s, p, type) {
            const at = local(s, p);
            if (cell(s, at)?.[0] !== 7 || s.portSites.get(key(at))?.some(id => id !== p.id) || s.endpoints.some(e => e.entrance.x === at[0] && e.entrance.y === at[1])) return null;
            const found = validateRainedShortcut(s.geometry, at, type, undefined, s.bounds);
            return found.valid && (!Object.hasOwn(directions, p.facing) || p.facing === found.facing) ? {
                at: at,
                route: found.route,
                facing: found.facing,
                reused: true,
                port: p.id
            } : null;
        }
        function candidates(s, p, type) {
            const options = rainedPlacementCandidates(r, s.room, p, {
                geometry: s.geometry,
                reserved: s.reserved,
                portSites: s.portSites
            }), valid = options.filter(candidate => candidate.valid && !candidate.reused);
            if (!valid.length) {
                const boundary = options.find(candidate => candidate.reason?.includes("白框"));
                if (boundary) issue("PLAYABLE_BOUNDS", p, boundary.reason);
            }
            return valid;
        }
        function mergePatch(a, b) {
            const out = new Map(a);
            for (const [k, v] of b) {
                const old = out.get(k);
                if (old && JSON.stringify(old.cell) !== JSON.stringify(v.cell)) return null;
                out.set(k, v);
            }
            return out;
        }
        function joinedRoute(s, a, b) {
            const patch = mergePatch(a.patch, b.patch);
            if (!patch) return null;
            const prefix = new Set([ ...a.network, ...b.network ].map(key)), start = key(a.tail), end = key(b.tail), previous = new Map([ [ start, null ] ]), queue = [ a.tail ];
            let cursor = 0;
            const allowed = p => {
                const k = key(p);
                if (k === start || k === end) return true;
                if (!within(s, p) || p[0] === 0 || p[1] === 0 || p[0] === s.room.w - 1 || p[1] === s.room.h - 1 || s.reserved.has(k) || s.portSites.has(k) || patch.has(k) || isNetwork(cell(s, p))) return false;
                if (steps.some(d => {
                    const q = add(p, d), kq = key(q);
                    return isNetwork(cell(s, q)) || prefix.has(kq) && kq !== start && kq !== end;
                })) return false;
                return true;
            };
            while (cursor < queue.length && !previous.has(end)) {
                const p = queue[cursor++], ordered = steps.map(d => add(p, d)).sort((u, v) => Math.abs(u[0] - b.tail[0]) + Math.abs(u[1] - b.tail[1]) - Math.abs(v[0] - b.tail[0]) - Math.abs(v[1] - b.tail[1]));
                for (const q of ordered) {
                    const k = key(q);
                    if (previous.has(k) || !allowed(q)) continue;
                    previous.set(k, key(p));
                    queue.push(q);
                }
            }
            if (!previous.has(end)) return null;
            const middle = [];
            for (let k = end; k !== null; k = previous.get(k)) middle.push(k.split(",").map(Number));
            middle.reverse();
            const route = [ a.at, a.network[1], ...middle, b.network[1], b.at ];
            if (route.length > 999 || new Set(route.map(key)).size !== route.length) return null;
            for (const p of middle) {
                const k = key(p);
                if (!patch.has(k)) {
                    const c = cell(s, p);
                    patch.set(k, {
                        at: p,
                        cell: [ c[0], [ ...c[1], 5 ] ]
                    });
                }
            }
            return {
                patch: patch,
                route: route
            };
        }
        function validatePatch(s, patch, endpoints) {
            const view = s.geometry.map(col => col.slice());
            for (const {at: at, cell: c} of patch.values()) view[at[0]][at[1]] = [ c, ...s.geometry[at[0]][at[1]].slice(1) ];
            return endpoints.every(endpoint => validateRainedShortcut(view, endpoint.at, endpoint.type, endpoint.end, s.bounds).valid);
        }
        function apply(s, patch) {
            for (const [k, {at: at, cell: c}] of patch) {
                s.geometry[at[0]][at[1]][0] = c;
                s.reserved.add(k);
            }
        }
        function endpointRecord(s, p, candidate, type, end, link) {
            const anchor = rainedPortAnchor(s.room, p);
            if (anchor.boundaryAdjusted) issue("BOUNDARY_ANCHOR", p, "边界上的通道井按协议向房间内定位入口，原标记坐标不变。", {
                sourceTile: {
                    x: anchor.source[0],
                    y: anchor.source[1]
                },
                entrance: {
                    x: candidate.at[0],
                    y: candidate.at[1]
                }
            });
            if (candidate.tileConflicts?.length) issue("NATIVE_TILE_OVERLAP", p, "入口局部地形覆盖了 " + candidate.tileConflicts.length + " 格已有贴块；贴块原文已保留，请在 Rained 检查或调整贴块。", {
                tiles: candidate.tileConflicts
            });
            if (candidate.nativeTilesUnchecked) issue("NATIVE_TILE_CHECK", p, "未能读取原工程的贴块覆盖范围；原贴块数据已保留，请在 Rained 检查新增入口周围的贴块。");
            return {
                port: p.id,
                link: link.id,
                kind: p.kind,
                room: s.room.id,
                roomName: s.room.name,
                sourcePosition: {
                    x: p.x,
                    y: p.y
                },
                sourceTile: {
                    x: anchor.source[0],
                    y: anchor.source[1]
                },
                entrance: {
                    x: candidate.at[0],
                    y: candidate.at[1]
                },
                gameEntrance: rainedGamePoint(s.bounds, {
                    x: candidate.at[0],
                    y: candidate.at[1]
                }),
                boundaryAdjusted: anchor.boundaryAdjusted,
                facing: candidate.facing || p.facing || "existing",
                path: traceRainedShortcut(s.geometry, candidate.at).tiles,
                node: type === "exit" ? {
                    x: end[0],
                    y: end[1]
                } : null,
                gameNode: type === "exit" ? rainedGamePoint(s.bounds, {
                    x: end[0],
                    y: end[1]
                }) : null,
                reused: candidate.reused,
                nativeTileConflicts: candidate.tileConflicts || []
            };
        }
        for (const link of [ ...r.links ].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
            const a = ports.get(link.a), b = ports.get(link.b), ar = owners.get(a?.id), br = owners.get(b?.id);
            if (!a || !b || !ar || !br || degree.get(a.id) !== 1 || degree.get(b.id) !== 1) continue;
            const sa = rooms.get(ar.id), sb = rooms.get(br.id), internal = a.kind === "internal" && b.kind === "internal" && ar.id === br.id, cross = a.kind === "exit" && b.kind === "exit" && ar.id !== br.id;
            if (!internal && !cross) {
                issue("PORT_LINK_KIND_MISMATCH", a, "连接两端的类型或所属房间不符合协议：同房间连接需要两个同房间通道井，跨房间连接需要两个不同房间的出口。", {
                    link: link.id
                });
                continue;
            }
            const type = internal ? "internal" : "exit", ea = existing(sa, a, type), eb = existing(sb, b, type);
            let selected = null;
            if (internal) {
                if (ea && eb && same(ea.route.end, eb.at) && same(eb.route.end, ea.at)) selected = {
                    a: ea,
                    b: eb,
                    patchA: new Map,
                    patchB: new Map,
                    route: ea.route.tiles,
                    endA: eb.at,
                    endB: ea.at
                }; else if (!ea && !eb) {
                    for (const ca of candidates(sa, a, type)) {
                        for (const cb of candidates(sb, b, type)) {
                            const joined = joinedRoute(sa, ca, cb);
                            if (joined && validatePatch(sa, joined.patch, [ {
                                at: ca.at,
                                type: type,
                                end: cb.at
                            }, {
                                at: cb.at,
                                type: type,
                                end: ca.at
                            } ])) {
                                selected = {
                                    a: ca,
                                    b: cb,
                                    patchA: joined.patch,
                                    patchB: new Map,
                                    route: joined.route,
                                    endA: cb.at,
                                    endB: ca.at
                                };
                                break;
                            }
                        }
                        if (selected) break;
                    }
                }
            } else {
                const ca = ea ? [ ea ] : candidates(sa, a, type), cb = eb ? [ eb ] : candidates(sb, b, type);
                for (const aa of ca) {
                    const endA = aa.reused ? aa.route.end : aa.tail;
                    if (!aa.reused && !validatePatch(sa, aa.patch, [ {
                        at: aa.at,
                        type: type,
                        end: endA
                    } ])) continue;
                    for (const bb of cb) {
                        const endB = bb.reused ? bb.route.end : bb.tail;
                        if (bb.reused || validatePatch(sb, bb.patch, [ {
                            at: bb.at,
                            type: type,
                            end: endB
                        } ])) {
                            selected = {
                                a: aa,
                                b: bb,
                                patchA: aa.patch || new Map,
                                patchB: bb.patch || new Map,
                                endA: endA,
                                endB: endB
                            };
                            break;
                        }
                    }
                    if (selected) break;
                }
            }
            if (!selected) {
                issue("SHORTCUT_UNBUILDABLE", a, "已连接的通道井无法安全生成：入口周围空间不足、已有捷径冲突、路径受阻，或导入房间的原始入口不匹配。未移动标记、未覆盖已有捷径；请在 Rained 完成此连接。", {
                    link: link.id,
                    ports: [ a.id, b.id ],
                    rooms: [ ar.id, br.id ]
                });
                continue;
            }
            apply(sa, selected.patchA);
            apply(sb, selected.patchB);
            const ra = endpointRecord(sa, a, selected.a, type, selected.endA, link), rb = endpointRecord(sb, b, selected.b, type, selected.endB, link);
            sa.endpoints.push(ra);
            sb.endpoints.push(rb);
            if (internal) sa.routes.push({
                link: link.id,
                kind: type,
                ports: [ a.id, b.id ],
                tiles: selected.route,
                reused: selected.a.reused
            }); else connections.push({
                link: link.id,
                a: ra,
                b: rb
            });
        }
        const handoff = [];
        for (const s of rooms.values()) {
            const nodes = [];
            for (let y = 0; y < s.room.h; y++) for (let x = 0; x < s.room.w; x++) if (s.geometry[x][y][0][1].includes(6)) {
                if (within(s, [ x, y ])) nodes.push({
                    x: x,
                    y: y
                }); else diagnostics.push({
                    code: "SHORTCUT_PLAYABLE_BOUNDS",
                    severity: "warning",
                    room: s.room.id,
                    node: {
                        x: x,
                        y: y
                    },
                    message: s.room.name + "：原生出口节点位于 Rained 白框外，保留原始几何，但不纳入有效世界连接序号。"
                });
            }
            const entries = nodes.map((node, index) => {
                const endpoint = s.endpoints.find(e => e.node && e.node.x === node.x && e.node.y === node.y), connection = endpoint && connections.find(c => c.link === endpoint.link), target = connection && (connection.a === endpoint ? connection.b : connection.a);
                if (!target) diagnostics.push({
                    code: "SHORTCUT_EXIT_TARGET_UNDECLARED",
                    severity: "warning",
                    room: s.room.id,
                    message: s.room.name + "：实际出口节点 " + index + " 没有可确认的跨房间目标，世界接线暂记为 DISCONNECTED。"
                });
                if (endpoint) endpoint.nodeIndex = index;
                return {
                    index: index,
                    node: node,
                    gameNode: rainedGamePoint(s.bounds, node),
                    port: endpoint?.port || null,
                    target: target?.roomName || "DISCONNECTED",
                    targetPort: target?.port || null
                };
            });
            handoff.push({
                room: s.room.name,
                roomId: s.room.id,
                roomType: s.room.roomType,
                renderedBounds: rainedRenderedBounds(s.room),
                exits: entries
            });
        }
        for (const row of handoff) {
            for (const e of row.exits) {
                const target = handoff.find(t => t.room === e.target);
                e.targetNode = target?.exits.find(n => n.port === e.targetPort)?.index ?? null;
            }
            const targets = row.exits.map(e => e.target).filter(n => n !== "DISCONNECTED");
            if (new Set(targets).size !== targets.length) diagnostics.push({
                code: "SHORTCUT_WORLD_DUPLICATE_TARGET",
                severity: "warning",
                room: row.roomId,
                message: row.room + "：多个出口通向同一个房间，普通 world 接线不能保证回程入口唯一；请依据节点清单在游戏工具中检查。"
            });
        }
        return {
            protocol: {
                format: "rainoc-rained-shortcuts",
                version: 2,
                coordinates: "room-local-top-left-zero-based",
                gameCoordinates: "game-room-local-top-left-zero-based",
                nodeOrder: "exit-nodes: y ascending, then x ascending"
            },
            rooms: rooms,
            owners: owners,
            diagnostics: diagnostics,
            ownershipRepairs: ownershipRepairs,
            connections: connections,
            handoff: handoff
        };
    }
    function rainedText(r, room, {geometry: geometry} = {}) {
        const geo = geometry || raster(r, room);
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
        if (!geo.some(col => col.some(c => c[0][0] === 1))) issue("SHELTER_NO_SOLID", null, "庇护所缺少前景实心墙；背景层不能作为围墙或地板。");
        if (geo.some((col, x) => col.some((c, y) => (x === 0 || y === 0 || x === w - 1 || y === h - 1) && c[0][0] !== 1))) issue("SHELTER_OPEN_BOUNDARY", null, "庇护所四周必须由前景实心墙完全封闭，不能用背景墙代替。");
        if (exits.length !== 1) issue("SHELTER_EXIT_COUNT", null, "普通庇护所需要一个完整的房间出口；地图上的入口标记不能代替实际捷径。", {
            count: exits.length
        });
        for (const start of exits) {
            const open = dirs.filter(d => !solid(add(start, d)));
            if (open.length !== 1) issue("SHELTER_ENTRANCE_DIRECTION", start, "庇护所入口需要三面实体墙和一个朝向室内的开口。");
            if (open.length === 1) {
                const d = open[0], side = [ -d[1], d[0] ], collar = [];
                for (let offset = -1; offset <= 1; offset++) for (const sign of [ -1, 1 ]) collar.push([ start[0] + d[0] * offset + side[0] * sign, start[1] + d[1] * offset + side[1] * sign ]);
                if (collar.some(p => !solid(p))) issue("SHELTER_ENTRANCE_COLLAR", start, "庇护所入口两侧及前后墙角必须完整封闭，否则 Rained 无法识别入口。");
            }
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
            for (let x = 1; x <= 4; x++) for (const yy of [ y - 1, y + 1 ]) geometry[x][yy][0] = [ 1, [] ];
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
        let collarFilled = 0;
        const dirs = [ [ -1, 0 ], [ 0, -1 ], [ 1, 0 ], [ 0, 1 ] ], cell = ([x, y]) => geometry[x]?.[y]?.[0];
        for (const [x, upY] of roomShortcutInfo(geometry).exits) {
            const y = h - 1 - upY, open = dirs.filter(([dx, dy]) => cell([ x + dx, y + dy ])?.[0] !== 1);
            if (open.length !== 1) continue;
            const [dx, dy] = open[0];
            for (let offset = -1; offset <= 1; offset++) for (const sign of [ -1, 1 ]) {
                const at = [ x + dx * offset - dy * sign, y + dy * offset + dx * sign ], c = cell(at);
                if (c?.[0] === 0 && !c[1].length) {
                    geometry[at[0]][at[1]][0] = [ 1, [] ];
                    collarFilled++;
                }
            }
        }
        if (collarFilled) repairs.push({
            code: "SHELTER_ENTRANCE_COLLAR",
            cells: collarFilled,
            message: "已补齐入口两侧及前后墙角的 " + collarFilled + " 格空白实体墙。"
        });
        const issues = shelterGeometryIssues(geometry);
        return {
            geometry: issues.length ? clone(source) : geometry,
            issues: issues,
            repairs: issues.length ? [] : repairs
        };
    }
    function roomConnectionIssues(r, {phase: phase = "export", shortcutPlan: shortcutPlan, workspace: workspace, sceneId: sceneId} = {}) {
        const plan = phase === "edit" ? null : shortcutPlan || prepareRegionShortcuts(r), issues = [ ...plan?.diagnostics || [] ], paired = new Set, linked = new Set, owners = new Map;
        for (const p of r.ports.filter(p => p.placementIssue)) {
            const owner = portRoomOwner(r, p);
            let valid = false;
            try {
                if (owner) {
                    const suggestion = suggestPortPlacement(r, p, {
                        snap: false,
                        geometry: raster(r, owner)
                    });
                    valid = suggestion.valid && !suggestion.tileConflicts?.length && !suggestion.nativeTilesUnchecked;
                }
            } catch {}
            if (!valid) issues.push({
                code: "SHORTCUT_PORT_PLACEMENT",
                severity: "warning",
                port: p.id,
                room: owner?.id || p.roomId,
                message: (owner?.name || p.name || "通道井") + "：旧入口尚未对齐到安全墙面，原位置与连线已保留。" + (p.placementIssue.message || "请调整入口附近地形或入口位置。")
            });
        }
        const key = (a, b) => [ a, b ].sort().join("|");
        for (const p of r.ports.filter(p => p.kind === "exit")) {
            const owner = plan?.owners.get(p.id) || portRoomOwner(r, p);
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
        for (const gate of workspace?.gates || []) if (gate.scenes.includes(sceneId || workspace.activeScene)) for (const link of gate.connections || []) {
            const ends = [ link.a, link.b ].map(end => {
                const region = workspace.regions.find(region => region.id === end.region), port = region?.ports.find(port => port.id === end.port);
                return {
                    region: region,
                    port: port,
                    room: port && port.kind === "exit" ? portRoomOwner(region, port) : null
                };
            });
            if (ends.some(end => !end.room) || ends[0].region.id === ends[1].region.id && ends[0].room.id === ends[1].room.id) continue;
            for (const end of ends) if (end.region.id === r.id) linked.add(end.room.id);
            if (ends.every(end => end.region.id === r.id)) paired.add(key(ends[0].room.id, ends[1].room.id));
        }
        for (const link of plan?.connections || []) {
            const a = link.a.room, b = link.b.room;
            if (a && b && a !== b) {
                paired.add(key(a, b));
                linked.add(a);
                linked.add(b);
            }
        }
        for (const rm of r.rooms) {
            let info;
            try {
                info = roomShortcutInfo(plan?.rooms.get(rm.id)?.geometry || raster(r, rm));
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
                message: rm.name + (planned ? "：导出后仍无完整的跨房间出口。请查看未配对、位置冲突或路径受阻的通道井诊断；原标记与连线保留在设计清单。" : "：没有完整的跨房间通道井。用于正常区域游玩时，至少需要一个通向房间外的实际出口；单独的图标、连线或生物巢穴不能代替。")
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
    function roomGeometryIssues(r, rm, {shortcutPlan: shortcutPlan} = {}) {
        try {
            const geo = shortcutPlan?.rooms.get(rm.id)?.geometry || raster(r, rm);
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
    function roomWarnings(r, options = {}) {
        const opts = options.phase === "edit" ? options : {
            ...options,
            shortcutPlan: options.shortcutPlan || prepareRegionShortcuts(r)
        };
        return [ ...roomConnectionIssues(r, opts), ...r.rooms.flatMap(rm => roomGeometryIssues(r, rm, opts).map(p => ({
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
        const gates = w.gates.filter(g => g.a.marker === mid || g.b.marker === mid || g.id === marker.sharedGateId), targets = [ {
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
    const sharedGateReports = new WeakMap;
    function sharedGateNormalizationSummary(w) {
        return sharedGateReports.get(w) || {
            changed: false,
            gates: 0,
            rooms: 0,
            ports: 0,
            warnings: []
        };
    }
    function sharedGateForRoom(w, rid, roomId) {
        return w.gates.find(g => g.sharedRoom?.region === rid && g.sharedRoom.room === roomId) || null;
    }
    function resolveSharedGateRoom(w, rid, mid) {
        const marker = w.regions.find(r => r.id === rid)?.markers.find(m => m.id === mid), gate = w.gates.find(g => [ "a", "b" ].some(k => g[k].region === rid && g[k].marker === mid) || marker?.sharedGateId === g.id);
        if (!gate?.sharedRoom) return null;
        const region = w.regions.find(r => r.id === gate.sharedRoom.region), room = region?.rooms.find(rm => rm.id === gate.sharedRoom.room);
        return room ? {
            gate: gate,
            region: region,
            room: room,
            marker: marker,
            side: gate.a.region === rid ? "a" : "b"
        } : null;
    }
    function sharedGateConnections(w, g) {
        return (g.connections || []).filter(l => l.a && l.b).map(l => clone(l));
    }
    function sharedGateName(w, g) {
        const a = w.regions.find(r => r.id === g.a.region && !r.gateStorageOnly), b = w.regions.find(r => r.id === g.b.region && !r.gateStorageOnly), base = a && b ? "GATE_" + a.code + "_" + b.code : "DRAFT_GATE_" + g.id.toUpperCase(), owner = w.regions.find(r => r.id === g.sharedRoom?.region), rm = owner?.rooms.find(rm => rm.id === g.sharedRoom?.room), used = new Set(w.regions.flatMap(r => r.rooms.filter(o => o !== rm).map(o => o.name)));
        let name = rm?.name;
        if (name && (name === base || new RegExp("^" + base + "_[0-9]+$").test(name)) && !used.has(name)) return name;
        name = base;
        let n = 1;
        while (used.has(name)) name = base + "_" + String(n++).padStart(2, "0");
        return name;
    }
    function gateStorageRegion(w) {
        let r = w.regions.find(r => r.gateStorageOnly);
        if (!r) {
            r = region("业力门编辑区", "Gate workspace", 280, 160);
            r.code = "GATESTORAGE";
            r.codeAuto = false;
            r.gateStorageOnly = true;
            w.regions.push(r);
        }
        return r;
    }
    function emptyGateSide(side = {}) {
        return {
            ...clone(side),
            region: side.region || "",
            marker: side.marker || "",
            karma: String(side.karma || "1"),
            ports: Array.isArray(side.ports) ? clone(side.ports) : []
        };
    }
    function placeStoredGate(w, g, r, rm) {
        if (!r.gateStorageOnly) return;
        g.placements ||= {};
        for (const sid of g.scenes) {
            if (g.placements[sid] && Number.isFinite(g.placements[sid].x) && Number.isFinite(g.placements[sid].y)) continue;
            const scene = w.scenes.find(s => s.id === sid);
            if (!scene) continue;
            let x = 0, y = 0;
            for (const rid of scene.regions) {
                const region = w.regions.find(r => r.id === rid && !r.gateStorageOnly), at = scene.placements[rid];
                if (region && at) x = Math.max(x, at.x + region.w + 24);
            }
            for (const other of w.gates) {
                const at = other.placements?.[sid], owner = w.regions.find(r => r.id === other.sharedRoom?.region), room = owner?.rooms.find(rm => rm.id === other.sharedRoom?.room);
                if (other !== g && at && room) x = Math.max(x, at.x + room.w + 24);
            }
            g.placements[sid] = {
                x: x,
                y: y
            };
        }
    }
    function gateRoomSnapshot(r, rm) {
        const data = {
            region: r.id,
            code: r.code,
            room: clone(rm),
            layer: clone(r.layers.find(l => l.id === rm.layer)),
            shapes: [],
            markers: [],
            ports: [],
            refs: [],
            links: []
        }, uniqueOwner = o => {
            const rooms = r.rooms.filter(rm => rm.layer === o.layer && o.x >= rm.x && o.y >= rm.y && o.x + (o.w || 0) <= rm.x + rm.w && o.y + (o.h || 0) <= rm.y + rm.h);
            return rooms.length === 1 ? rooms[0] : null;
        };
        for (const s of r.shapes) {
            if (s.roomId === rm.id) data.shapes.push(clone(s)); else if (!s.roomId && s.layer === rm.layer) {
                const clip = intersection(bounds(s), rm);
                if (clip) data.shapes.push({
                    ...clone(s),
                    roomId: rm.id,
                    clip: clip
                });
            }
        }
        for (const k of [ "markers", "ports", "refs" ]) data[k] = clone(r[k].filter(o => o.roomId === rm.id || !o.roomId && !(k === "markers" && o.kind === "gate" && o.sharedGateRoom && o.sharedGateRoom.region !== r.id) && (k === "ports" ? portRoomOwner(r, o) : uniqueOwner(o))?.id === rm.id));
        const ports = new Set(data.ports.map(p => p.id));
        data.links = clone(r.links.filter(l => ports.has(l.a) || ports.has(l.b)));
        return data;
    }
    function gateGeometrySignature(source) {
        const room = source.room;
        return JSON.stringify({
            w: room.w,
            h: room.h,
            water: room.water,
            rainedSource: room.rainedSource || "",
            shapes: source.shapes.map(s => {
                s = clone(s);
                shift(s, -room.x, -room.y);
                for (const k of [ "id", "roomId", "layer", "visible", "locked" ]) delete s[k];
                return s;
            })
        });
    }
    function gateSourceScore(source) {
        return (source.room.rainedSource ? 1e9 : 0) + source.shapes.reduce((n, s) => n + (s.rawCell ? 1 : Math.min(1e4, (bounds(s).w || 1) * (bounds(s).h || 1))), 0) + source.ports.length * .001;
    }
    function restoreGateSourceRoom(r, source, marker) {
        const layer = ensureGateLayer(r), old = source.room;
        let box = {
            x: Math.max(0, Math.min(r.w - old.w, old.x)),
            y: Math.max(0, Math.min(r.h - old.h, old.y)),
            w: old.w,
            h: old.h,
            layer: layer.id
        };
        r.w = Math.max(r.w, box.w);
        r.h = Math.max(r.h, box.h);
        if (r.rooms.some(rm => rm.layer === box.layer && intersection(rm, box))) {
            const p = roomCopyPosition(r, box, box.layer);
            if (p) Object.assign(box, p); else if (r.w + box.w + 4 <= 4096) {
                box.x = r.w + 4;
                box.y = 0;
                r.w = box.x + box.w;
            } else if (r.h + box.h + 4 <= 4096) {
                box.x = 0;
                box.y = r.h + 4;
                r.h = box.y + box.h;
            } else throw Error("独立地图中的业力门副本需要更多区域空间。");
        }
        const rm = {
            ...clone(old),
            ...box,
            id: uid()
        }, map = new Map([ [ old.id, rm.id ] ]);
        delete rm.sharedGateId;
        delete rm.detachedGateBackup;
        r.rooms.push(rm);
        for (const key of [ "shapes", "markers", "ports", "refs" ]) for (const item of source[key]) {
            if (key === "markers" && item.kind === "gate") continue;
            const o = {
                ...clone(item),
                id: uid(),
                roomId: rm.id,
                layer: rm.layer
            };
            delete o.sharedGateId;
            delete o.sharedGateRoom;
            shift(o, rm.x - old.x, rm.y - old.y);
            r[key].push(o);
            map.set(item.id, o.id);
        }
        for (const link of source.links) {
            const a = map.get(link.a) || link.a, b = map.get(link.b) || link.b;
            if (a !== b && r.ports.some(p => p.id === a) && r.ports.some(p => p.id === b)) r.links.push({
                ...clone(link),
                id: uid(),
                a: a,
                b: b
            });
        }
        marker.roomId = rm.id;
        marker.layer = rm.layer;
        return rm;
    }
    function gateMarker(w, g, key) {
        const side = g[key], r = w.regions.find(r => r.id === side.region && !r.gateStorageOnly);
        if (!r) return {
            r: null,
            m: null
        };
        let m = r.markers.find(m => m.id === side.marker && m.kind === "gate") || r.markers.find(m => m.kind === "gate" && m.sharedGateId === g.id);
        if (!m) {
            m = {
                id: uid(),
                kind: "gate",
                name: g.name,
                layer: ensureGateLayer(r).id,
                x: Math.round(Math.max(0, Math.min(r.w, Number.isFinite(side.x) ? side.x : r.w / 2))),
                y: Math.round(Math.max(0, Math.min(r.h, Number.isFinite(side.y) ? side.y : r.h / 2))),
                sceneIds: clone(g.scenes),
                color: "#ffffff"
            };
            r.markers.push(m);
        }
        side.marker = m.id;
        return {
            r: r,
            m: m
        };
    }
    function syncSharedGate(w, g) {
        const r = w.regions.find(r => r.id === g.sharedRoom?.region), rm = r?.rooms.find(rm => rm.id === g.sharedRoom?.room);
        if (!rm) return;
        g.a = emptyGateSide(g.a);
        g.b = emptyGateSide(g.b);
        g.sharedVersion = 2;
        g.visible ??= true;
        g.connections ||= [];
        rm.sharedGateId = g.id;
        rm.name = sharedGateName(w, g);
        rm.gateTo = w.regions.find(rr => rr.id === (g.a.region === r.id ? g.b.region : g.a.region))?.code || "";
        for (const key of [ "a", "b" ]) {
            const rr = w.regions.find(rr => rr.id === g[key].region && !rr.gateStorageOnly), existing = rr?.markers.find(m => m.id === g[key].marker);
            if (!rr) {
                g[key].marker = "";
                g[key].ports = [];
                continue;
            }
            if (!existing && (g[key].markerOmitted || rr === r && rm.gateMarkerOmitted)) continue;
            const {m: m} = gateMarker(w, g, key);
            m.name = g.name;
            m.sharedGateId = g.id;
            m.sharedGateRoom = clone(g.sharedRoom);
            m.layer = ensureGateLayer(rr).id;
            if (rr.id === r.id) m.roomId = rm.id; else delete m.roomId;
            g[key].ports = (g[key].ports || []).filter(id => r.ports.some(p => p.id === id && p.roomId === rm.id));
        }
        let owner = r.markers.find(m => m.kind === "gate" && m.roomId === rm.id);
        if (!owner && !rm.gateMarkerOmitted) {
            owner = {
                id: uid(),
                kind: "gate",
                name: g.name,
                roomId: rm.id,
                roomTypeMarker: true,
                layer: rm.layer,
                x: rm.x + Math.floor(rm.w / 2),
                y: rm.y + Math.floor(rm.h / 2),
                sceneIds: clone(g.scenes),
                color: "#ffffff"
            };
            r.markers.push(owner);
        }
        if (owner) {
            owner.name = g.name;
            owner.sharedGateId = g.id;
            owner.sharedGateRoom = clone(g.sharedRoom);
            g.ownerMarker = owner.id;
        }
        placeStoredGate(w, g, r, rm);
    }
    function moveSharedGateToStorage(w, g) {
        const source = w.regions.find(r => r.id === g.sharedRoom?.region), rm = source?.rooms.find(rm => rm.id === g.sharedRoom?.room);
        if (!rm || source.gateStorageOnly) return false;
        const snapshot = gateRoomSnapshot(source, rm), target = gateStorageRegion(w), layer = ensureGateLayer(target), old = {
            ...rm
        }, sourceLayer = source.layers.find(l => l.id === rm.layer);
        g.placements ||= {};
        for (const sid of g.scenes) {
            const scene = w.scenes.find(s => s.id === sid), at = scene?.placements[source.id] || {
                x: 0,
                y: 0
            };
            g.placements[sid] ||= {
                x: at.x + rm.x,
                y: at.y + rm.y
            };
        }
        target.w = Math.max(target.w, rm.w);
        target.h = Math.max(target.h, rm.h);
        let box = {
            x: Math.max(0, Math.min(target.w - rm.w, rm.x)),
            y: Math.max(0, Math.min(target.h - rm.h, rm.y)),
            w: rm.w,
            h: rm.h,
            layer: layer.id
        };
        if (target.rooms.some(o => o.layer === layer.id && intersection(o, box))) {
            const free = roomCopyPosition(target, box, layer.id);
            if (free) Object.assign(box, free); else if (target.w + rm.w + 4 <= 4096) {
                box.x = target.w + 4;
                box.y = 0;
                target.w = box.x + box.w;
            } else if (target.h + rm.h + 4 <= 4096) {
                box.x = 0;
                box.y = target.h + 4;
                target.h = box.y + box.h;
            } else {
                const extra = region("业力门编辑区", "Gate workspace", Math.max(280, rm.w), Math.max(160, rm.h));
                extra.code = "GATESTORAGE";
                extra.codeAuto = false;
                extra.gateStorageOnly = true;
                w.regions.push(extra);
                return moveSharedGateToStorageTarget(w, g, snapshot, source, extra);
            }
        }
        return moveSharedGateToStorageTarget(w, g, snapshot, source, target, box, sourceLayer);
    }
    function moveSharedGateToStorageTarget(w, g, snapshot, source, target, box, sourceLayer) {
        const old = snapshot.room, layer = ensureGateLayer(target);
        sourceLayer ||= snapshot.layer;
        if (opacity(layer) !== 1) {
            for (const room of target.rooms.filter(room => room.layer === layer.id)) room.opacity = opacity(room) * opacity(layer);
            layer.opacity = 1;
        }
        box ||= {
            x: 0,
            y: 0,
            w: old.w,
            h: old.h,
            layer: layer.id
        };
        const ids = new Set([ "rooms", "shapes", "markers", "ports", "links", "refs" ].flatMap(k => target[k].map(o => o.id))), mapping = new Map, allocate = id => {
            let next = id;
            while (ids.has(next)) next = uid();
            ids.add(next);
            mapping.set(id, next);
            return next;
        }, moved = {
            ...clone(old),
            ...box,
            id: allocate(old.id),
            sharedGateId: g.id
        };
        if (sourceLayer?.locked) moved.locked = true;
        if (sourceLayer?.visible === false) moved.visible = false;
        moved.opacity = opacity(old) * opacity(sourceLayer);
        moved.fullDisplay = typeof old.fullDisplay === "boolean" ? old.fullDisplay : sourceLayer?.fullDisplay === true;
        moved.returnLayer = target.layers.find(l => !isDedicatedLayer(l))?.id;
        target.rooms.push(moved);
        const movingPorts = new Set(snapshot.ports.map(p => p.id));
        for (const key of [ "shapes", "markers", "ports", "refs" ]) for (const o of snapshot[key]) {
            if (key === "markers" && o.kind === "gate") continue;
            const next = {
                ...clone(o),
                id: allocate(o.id),
                roomId: moved.id,
                layer: layer.id
            };
            shift(next, moved.x - old.x, moved.y - old.y);
            target[key].push(next);
        }
        for (const link of snapshot.links) {
            const endpoint = id => movingPorts.has(id) ? {
                region: target.id,
                port: mapping.get(id)
            } : {
                region: source.id,
                port: id
            }, a = endpoint(link.a), b = endpoint(link.b);
            if (a.region === target.id && b.region === target.id) target.links.push({
                ...clone(link),
                id: allocate(link.id),
                a: a.port,
                b: b.port
            }); else (g.connections ||= []).push({
                ...clone(link),
                id: uid(),
                a: a,
                b: b
            });
        }
        source.links = source.links.filter(l => !movingPorts.has(l.a) && !movingPorts.has(l.b));
        source.shapes = source.shapes.flatMap(s => s.roomId === old.id ? [] : !s.roomId && s.layer === old.layer && intersection(bounds(s), old) ? subtract(bounds(s), old).map(clip => ({
            ...clone(s),
            id: uid(),
            clip: clip
        })) : [ s ]);
        for (const key of [ "ports", "refs" ]) {
            const removed = new Set(snapshot[key].map(o => o.id));
            source[key] = source[key].filter(o => !removed.has(o.id));
        }
        const movedMarkers = new Set(snapshot.markers.filter(m => m.kind !== "gate").map(m => m.id)), projectionIds = new Set([ g.a, g.b ].filter(side => side.region === source.id).map(side => side.marker));
        source.markers = source.markers.filter(m => !movedMarkers.has(m.id) && !(m.kind === "gate" && m.roomId === old.id && !projectionIds.has(m.id)));
        for (const m of source.markers) if (m.roomId === old.id) delete m.roomId;
        source.rooms = source.rooms.filter(o => o.id !== old.id);
        for (const gate of w.gates) for (const link of gate.connections || []) for (const key of [ "a", "b" ]) if (link[key].region === source.id && movingPorts.has(link[key].port)) link[key] = {
            region: target.id,
            port: mapping.get(link[key].port)
        };
        for (const side of [ g.a, g.b ]) side.ports = (side.ports || []).map(id => mapping.get(id) || id);
        g.sharedRoom = {
            region: target.id,
            room: moved.id
        };
        g.worldSharedVersion = 1;
        g.previousRoomOwner ||= {
            region: source.id,
            room: old.id
        };
        target.categories.gate.visible = true;
        target.gateLayerVersion = 1;
        return true;
    }
    function normalizeSharedGates(w) {
        const report = {
            changed: false,
            gates: 0,
            rooms: 0,
            ports: 0,
            warnings: []
        };
        const claimed = new Set(w.gates.flatMap(g => [ g.sharedRoom && g.sharedRoom.region + "|" + g.sharedRoom.room, ...[ g.a, g.b ].filter(Boolean).map(side => {
            const r = w.regions.find(r => r.id === side.region), m = r?.markers.find(m => m.id === side.marker);
            return m?.roomId ? r.id + "|" + m.roomId : null;
        }) ].filter(Boolean)));
        for (const r of w.regions) for (const rm of r.rooms.filter(rm => rm.roomType === "GATE")) {
            if (claimed.has(r.id + "|" + rm.id) || rm.gateMarkerOmitted || r.gateContextOnly) continue;
            const marker = r.markers.find(m => m.kind === "gate" && m.roomId === rm.id), scenes = w.scenes.filter(s => s.regions.includes(r.id)).map(s => s.id), code = String(rm.gateTo || (/^GATE_/.test(rm.name) ? rm.name.split("_").find((part, i) => i > 0 && part !== r.code) : "") || "").toUpperCase(), matches = code && code !== "XX" ? w.regions.filter(rr => rr.id !== r.id && !rr.gateStorageOnly && rr.code === code && w.scenes.some(s => scenes.includes(s.id) && s.regions.includes(rr.id))) : [], g = {
                id: uid(),
                name: marker?.name || "业力门",
                a: emptyGateSide(r.gateStorageOnly ? {} : {
                    region: r.id,
                    marker: marker?.id,
                    karma: "1"
                }),
                b: emptyGateSide(matches.length === 1 ? {
                    region: matches[0].id,
                    karma: "1"
                } : {}),
                sharedRoom: {
                    region: r.id,
                    room: rm.id
                },
                sharedVersion: 2,
                scenes: scenes.length ? scenes : [ w.activeScene || w.scenes[0].id ],
                visible: true,
                legacyTargetCode: code,
                legacyRoomName: rm.name,
                connections: []
            };
            w.gates.push(g);
            claimed.add(r.id + "|" + rm.id);
            report.changed = true;
            report.gates++;
        }
        for (const g of w.gates) {
            g.a = emptyGateSide(g.a);
            g.b = emptyGateSide(g.b);
            if (g.a.region && g.a.region === g.b.region || ![ g.a.region, g.b.region ].filter(Boolean).every(id => w.regions.some(r => r.id === id && !r.gateStorageOnly))) continue;
            const current = w.regions.find(r => r.id === g.sharedRoom?.region)?.rooms.find(rm => rm.id === g.sharedRoom?.room && rm.roomType === "GATE");
            if (g.sharedVersion === 2 && current && (!current.sharedGateId || current.sharedGateId === g.id)) {
                const state = () => JSON.stringify([ g.a, g.b, g.sharedRoom, g.visible, g.sharedVersion, current.name ]), prior = state();
                syncSharedGate(w, g);
                if (moveSharedGateToStorage(w, g)) {
                    syncSharedGate(w, g);
                    report.changed = true;
                }
                if (prior !== state()) report.changed = true;
                continue;
            }
            const ends = [ "a", "b" ].map(key => ({
                key: key,
                ...gateMarker(w, g, key)
            })).filter(e => e.r && e.m), sources = [];
            for (const e of ends) if (e.m.sharedGateId && e.m.sharedGateId !== g.id) {
                const previous = w.gates.find(o => o.id === e.m.sharedGateId), rm = e.r.rooms.find(rm => rm.id === e.m.roomId && rm.roomType === "GATE"), source = rm ? gateRoomSnapshot(e.r, rm) : previous?.legacyRooms?.find(s => s.region === e.r.id && s.markers.some(m => m.id === e.m.id)), m = {
                    ...clone(e.m),
                    id: uid(),
                    sceneIds: clone(g.scenes)
                };
                delete m.roomId;
                delete m.sharedGateId;
                delete m.sharedGateRoom;
                e.r.markers.push(m);
                e.m = m;
                g[e.key].marker = m.id;
                if (source) {
                    (g.legacySharedSources ||= []).push(clone(source));
                    restoreGateSourceRoom(e.r, source, m);
                }
                const warning = {
                    code: "SHARED_GATE_SCENE_COPY",
                    message: "同一个旧标志用于不同区域连接，已为这条连接保留独立共享房间，避免覆盖另一张地图。",
                    sourceRegion: e.r.id
                };
                (g.migrationWarnings ||= []).push(warning);
                report.warnings.push(warning);
            }
            for (const e of ends) {
                let rm = e.r.rooms.find(rm => rm.id === e.m.roomId && rm.roomType === "GATE");
                if (rm && !sources.some(s => s.region === e.r.id && s.room.id === rm.id)) sources.push(gateRoomSnapshot(e.r, rm));
            }
            const requested = g.sharedRoom && sources.find(s => s.region === g.sharedRoom.region && s.room.id === g.sharedRoom.room);
            sources.sort((a, b) => gateSourceScore(b) - gateSourceScore(a));
            let selected = requested || sources[0];
            if (!selected) {
                let owner = ends.find(e => e.r.id === g.sharedRoom?.region) || ends[0];
                if (!owner) {
                    const r = gateStorageRegion(w), m = {
                        id: uid(),
                        kind: "gate",
                        name: g.name,
                        layer: ensureGateLayer(r).id,
                        x: r.w / 2,
                        y: r.h / 2,
                        sceneIds: clone(g.scenes),
                        color: "#ffffff"
                    };
                    r.markers.push(m);
                    owner = {
                        r: r,
                        m: m,
                        key: "a"
                    };
                }
                const rm = ensureGateRoom(owner.r, owner.m, w.regions.find(r => r.id === (owner.key === "a" ? g.b.region : g.a.region))?.code || "");
                selected = gateRoomSnapshot(owner.r, rm);
                sources.push(selected);
            }
            const owner = w.regions.find(r => r.id === selected.region), room = owner.rooms.find(rm => rm.id === selected.room.id), portMap = new Map, localIds = new Set([ "layers", "rooms", "shapes", "markers", "ports", "links", "refs" ].flatMap(k => owner[k].map(o => o.id))), geometry = gateGeometrySignature(selected);
            g.sharedRoom = {
                region: owner.id,
                room: room.id
            };
            g.connections ||= [];
            g.migrationWarnings ||= [];
            g.legacyRooms ||= [];
            if (sources.some(s => s.room.locked || s.layer?.locked)) room.locked = true;
            if (sources.length > 1) for (const source of sources) if (!g.legacyRooms.some(s => s.region === source.region && s.room.id === source.room.id)) g.legacyRooms.push(clone(source));
            cutShapes(owner, room);
            for (const key of [ "markers", "ports", "refs" ]) {
                const selectedIds = new Set(selected[key].map(o => o.id));
                for (const o of owner[key]) if (selectedIds.has(o.id) && !o.roomId) {
                    o.roomId = room.id;
                    o.layer = room.layer;
                }
            }
            for (const e of ends) {
                const source = sources.find(s => s.region === e.r.id && s.room.id === e.m.roomId);
                g[e.key].ports = source ? source.ports.map(p => p.id) : [];
            }
            for (const p of selected.ports) portMap.set(owner.id + "|" + p.id, {
                region: owner.id,
                port: p.id
            });
            const freshId = id => {
                if (localIds.has(id)) {
                    do {
                        id = uid();
                    } while (localIds.has(id));
                }
                localIds.add(id);
                return id;
            }, recordWarning = (code, message, extra = {}) => {
                const item = {
                    code: code,
                    message: message,
                    ...extra
                };
                g.migrationWarnings.push(item);
                report.warnings.push(item);
            };
            for (const source of sources) {
                if (source === selected) continue;
                const from = w.regions.find(r => r.id === source.region), same = geometry === gateGeometrySignature(source), dx = room.x - source.room.x, dy = room.y - source.room.y;
                if (!same) recordWarning("SHARED_GATE_SOURCE_PRESERVED", "旧版两侧业力门地形不同，已采用内容更完整的一份；另一份完整保存在门的旧来源中。", {
                    sourceRegion: source.region,
                    sourceRoom: source.room.id
                });
                for (const p of source.ports) {
                    const x = Math.max(room.x, Math.min(room.x + room.w, p.x + dx)), y = Math.max(room.y, Math.min(room.y + room.h, p.y + dy)), at = owner.ports.find(q => q.roomId === room.id && q.kind === p.kind && (q.facing || "auto") === (p.facing || "auto") && Math.abs(q.x - x) < 1e-6 && Math.abs(q.y - y) < 1e-6), linked = source.links.some(l => l.a === p.id || l.b === p.id), otherLinked = at && (owner.links.some(l => l.a === at.id || l.b === at.id) || g.connections.some(l => [ l.a, l.b ].some(e => e.region === owner.id && e.port === at.id)));
                    let next = at && !linked && !otherLinked ? at : null;
                    if (!next) {
                        next = {
                            ...clone(p),
                            id: freshId(p.id),
                            roomId: room.id,
                            layer: room.layer,
                            x: x,
                            y: y
                        };
                        if (at) {
                            const occupied = (xx, yy) => owner.ports.some(q => q.roomId === room.id && Math.floor(q.x - room.x) === Math.floor(xx - room.x) && Math.floor(q.y - room.y) === Math.floor(yy - room.y));
                            let free = null;
                            for (let d = 1; d <= 4 && !free; d++) for (const [xx, yy] of [ [ x + d, y ], [ x - d, y ], [ x, y + d ], [ x, y - d ] ]) if (xx > room.x && yy > room.y && xx < room.x + room.w && yy < room.y + room.h && !occupied(xx, yy)) {
                                free = {
                                    x: xx,
                                    y: yy
                                };
                                break;
                            }
                            if (free) Object.assign(next, free);
                            next.placementIssue = {
                                code: "SHARED_GATE_PORT_COLLISION",
                                message: "旧版两侧入口重合但连线不同，已分别保留并重新寻找安全入口。"
                            };
                            recordWarning("SHARED_GATE_DISTINCT_PORTS", "旧版两侧同位置入口具有独立连线，已保留为两个入口并重新对齐，未合并连线。", {
                                sourceRegion: source.region,
                                sourcePort: p.id,
                                port: next.id
                            });
                        }
                        if (!same || x !== p.x + dx || y !== p.y + dy) {
                            next.placementIssue ||= {
                                code: "SHARED_GATE_SOURCE_CHANGED",
                                message: "旧版入口已转入共享房间，正在重新核对安全位置。"
                            };
                            recordWarning("SHARED_GATE_PORT_REPOSITIONED", "旧门地形或尺寸不同，通道井已转入共享房间并重新核对；原位置保存在旧来源中。", {
                                sourceRegion: source.region,
                                sourcePort: p.id,
                                port: next.id
                            });
                        }
                        owner.ports.push(next);
                    }
                    portMap.set(from.id + "|" + p.id, {
                        region: owner.id,
                        port: next.id
                    });
                    report.ports++;
                }
                for (const k of [ "markers", "refs" ]) for (const item of source[k]) {
                    if (k === "markers" && item.kind === "gate") continue;
                    const next = {
                        ...clone(item),
                        id: freshId(item.id),
                        roomId: room.id,
                        layer: room.layer
                    };
                    shift(next, dx, dy);
                    if (k === "markers") {
                        next.x = Math.max(room.x, Math.min(room.x + room.w, next.x));
                        next.y = Math.max(room.y, Math.min(room.y + room.h, next.y));
                    }
                    owner[k].push(next);
                }
                const moving = new Set(source.ports.map(p => p.id));
                for (const link of source.links) {
                    const a = portMap.get(from.id + "|" + link.a) || {
                        region: from.id,
                        port: link.a
                    }, b = portMap.get(from.id + "|" + link.b) || {
                        region: from.id,
                        port: link.b
                    };
                    if (a.region === b.region && a.port === b.port) {
                        recordWarning("SHARED_GATE_DUPLICATE_LINK", "旧版重复入口的自连接已移入旧来源备份。", {
                            sourceRegion: from.id,
                            link: link.id
                        });
                        continue;
                    }
                    if (a.region === owner.id && b.region === owner.id) {
                        if (!owner.links.some(l => l.a === a.port && l.b === b.port || l.a === b.port && l.b === a.port)) owner.links.push({
                            ...clone(link),
                            id: freshId(link.id),
                            a: a.port,
                            b: b.port
                        });
                    } else if (!g.connections.some(l => l.a.region === a.region && l.a.port === a.port && l.b.region === b.region && l.b.port === b.port || l.a.region === b.region && l.a.port === b.port && l.b.region === a.region && l.b.port === a.port)) g.connections.push({
                        ...clone(link),
                        id: freshId(link.id),
                        a: a,
                        b: b
                    });
                }
                from.links = from.links.filter(l => !moving.has(l.a) && !moving.has(l.b));
                from.ports = from.ports.filter(p => !moving.has(p.id));
                from.shapes = from.shapes.flatMap(s => s.roomId === source.room.id ? [] : !s.roomId && s.layer === source.room.layer && intersection(bounds(s), source.room) ? subtract(bounds(s), source.room).map(clip => ({
                    ...clone(s),
                    id: uid(),
                    clip: clip
                })) : [ s ]);
                const refIds = new Set(source.refs.map(ref => ref.id)), markerIds = new Set(source.markers.map(m => m.id));
                from.refs = from.refs.filter(ref => !refIds.has(ref.id));
                from.markers = from.markers.filter(m => !markerIds.has(m.id) || m.kind === "gate");
                for (const m of from.markers) if (m.roomId === source.room.id) delete m.roomId;
                from.rooms = from.rooms.filter(rm => rm.id !== source.room.id);
                report.rooms++;
            }
            for (const key of [ "a", "b" ]) g[key].ports = [ ...new Set((g[key].ports || []).map(id => portMap.get(g[key].region + "|" + id)?.port || id)) ];
            for (const gate of w.gates) for (const link of gate.connections || []) for (const key of [ "a", "b" ]) {
                const mapped = portMap.get(link[key].region + "|" + link[key].port);
                if (mapped) link[key] = clone(mapped);
            }
            syncSharedGate(w, g);
            if (moveSharedGateToStorage(w, g)) syncSharedGate(w, g);
            report.gates++;
            report.changed = true;
        }
        if (report.ports && w.regions.some(r => r.ports.some(p => p.placementIssue))) normalizeLegacyPorts(w);
        sharedGateReports.set(w, report);
        return report;
    }
    function gateDraftEnds(w, sid, draft) {
        const scene = w.scenes.find(s => s.id === sid);
        if (!scene) throw Error("当前地图不存在。");
        if (draft.a?.region && draft.a.region === draft.b?.region) throw Error("业力门两侧不能绑定同一个区域。");
        return [ "a", "b" ].map(key => {
            const side = emptyGateSide(draft[key]), r = side.region ? w.regions.find(r => r.id === side.region && !r.gateStorageOnly) : null, m = r?.markers.find(m => m.id === side.marker && m.kind === "gate");
            if (side.region && (!r || !scene.regions.includes(r.id))) throw Error("请选择当前地图中的区域，或保留未绑定。");
            if (![ "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "locked" ].includes(String(side.karma))) throw Error("业力等级无效。");
            if (m) {
                const reason = lockReason(r, m, "gate");
                if (reason) throw Error(reason);
            }
            if (r && gateLayer(r)?.locked) throw Error("业力门层级已锁定。");
            return {
                key: key,
                side: side,
                r: r,
                m: m
            };
        });
    }
    function createSharedGate(w, sid, draft) {
        const name = String(draft.name || "业力门").trim();
        if (!name) throw Error("请填写业力门昵称。");
        const ends = gateDraftEnds(w, sid, draft), registered = draft.room && sharedGateForRoom(w, draft.room.region, draft.room.room);
        if (registered) return saveGateConnection(w, sid, {
            ...draft,
            name: name,
            a: ends[0].side,
            b: ends[1].side
        }, registered.id);
        for (const e of ends) if (e.m && w.gates.some(g => [ "a", "b" ].some(k => g[k].region === e.r.id && g[k].marker === e.m.id))) throw Error("所选业力门已登记，请编辑原有连接。");
        const owner = draft.room ? w.regions.find(r => r.id === draft.room.region) : gateStorageRegion(w);
        let rm = draft.room && owner?.rooms.find(rm => rm.id === draft.room.room);
        if (draft.room && !rm) throw Error("所选业力门房间不存在。");
        if (rm && rm.roomType !== "GATE") throw Error("请选择业力门房间。");
        if (rm && lockReason(owner, rm, "rooms")) throw Error(lockReason(owner, rm, "rooms"));
        const g = {
            id: uid(),
            name: name,
            a: ends[0].side,
            b: ends[1].side,
            scenes: [ sid ],
            visible: draft.visible !== false
        };
        if (rm) {
            g.sharedRoom = {
                region: owner.id,
                room: rm.id
            };
            const side = ends.find(e => e.r === owner);
            if (side) {
                g[side.key].marker ||= owner.markers.find(m => m.roomId === rm.id && m.kind === "gate")?.id;
                const e = gateMarker(w, g, side.key);
                e.m.roomId = rm.id;
                e.m.layer = rm.layer;
            }
        }
        if (!rm && !ends.some(e => e.m?.roomId && e.r?.rooms.some(rm => rm.id === e.m.roomId && rm.roomType === "GATE"))) {
            const layer = ensureGateLayer(owner), size = {
                w: Math.min(draft.preset?.w || 70, 4096),
                h: Math.min(draft.preset?.h || 40, 4096)
            };
            owner.w = Math.max(owner.w, size.w);
            owner.h = Math.max(owner.h, size.h);
            const side = ends.find(e => e.r === owner), e = side ? gateMarker(w, g, side.key) : {
                r: owner,
                m: null
            }, anchor = e.m || {
                x: owner.w / 2,
                y: owner.h / 2
            }, box = {
                x: Math.round(Math.max(0, Math.min(owner.w - size.w, anchor.x - size.w / 2))),
                y: Math.round(Math.max(0, Math.min(owner.h - size.h, anchor.y - size.h / 2))),
                ...size,
                layer: layer.id
            };
            if (owner.rooms.some(rm => rm.layer === box.layer && intersection(rm, box))) {
                const p = roomCopyPosition(owner, box, box.layer);
                if (p) Object.assign(box, p); else if (owner.gateStorageOnly && owner.w + box.w + 4 <= 4096) {
                    box.x = owner.w + 4;
                    box.y = 0;
                    owner.w = box.x + box.w;
                } else throw Error("区域内没有位置放置业力门，请先扩展区域。");
            }
            rm = addRoom(owner, box);
            setRoomType(owner, rm, "GATE", ends.find(e => e.r && e.r !== owner)?.r.code || "");
            if (e.m) {
                e.m.roomId = rm.id;
                e.m.layer = rm.layer;
            }
            g.sharedRoom = {
                region: owner.id,
                room: rm.id
            };
        }
        if (g.sharedRoom) g.sharedVersion = 2;
        w.gates.push(g);
        normalizeSharedGates(w);
        for (const e of ends) if (e.r) {
            e.r.categories.gate.visible = true;
            ensureGateLayer(e.r).visible = true;
        }
        owner.categories.gate.visible = true;
        return g;
    }
    function saveGateConnection(w, sid, draft, id) {
        const existing = id ? w.gates.find(g => g.id === id) : null;
        if (id && !existing) throw Error("此连接已不存在。");
        if (!existing) return createSharedGate(w, sid, draft);
        const name = String(draft.name || "").trim();
        if (!name) throw Error("请填写业力门昵称。");
        const ends = gateDraftEnds(w, sid, draft), owner = w.regions.find(r => r.id === existing.sharedRoom?.region), room = owner?.rooms.find(rm => rm.id === existing.sharedRoom?.room);
        if (room && lockReason(owner, room, "rooms")) throw Error(lockReason(owner, room, "rooms"));
        const previous = {
            a: emptyGateSide(existing.a),
            b: emptyGateSide(existing.b)
        }, kept = new Set(ends.filter(e => e.r).map(e => e.r.id)), swapped = !!draft.a?.region && !!draft.b?.region && draft.a.region === previous.b.region && draft.b.region === previous.a.region;
        for (const prior of Object.values(previous)) {
            const r = w.regions.find(r => r.id === prior.region), m = r?.markers.find(m => m.id === prior.marker);
            if (m && lockReason(r, m, "gate")) throw Error(lockReason(r, m, "gate"));
        }
        for (const e of ends) if (e.m && w.gates.some(g => g !== existing && [ "a", "b" ].some(k => g[k].region === e.r.id && g[k].marker === e.m.id))) throw Error("所选业力门已属于另一条共享连接。");
        if (owner?.gateStorageOnly && kept.size) {
            const pending = owner.rooms.filter(rm => rm.roomType === "SHELTER" && (rm.pendingRegionAssignment && rm.gateCompanionId === existing.id || owner.links.some(l => {
                const a = owner.ports.find(p => p.id === l.a), b = owner.ports.find(p => p.id === l.b);
                return a?.roomId === rm.id && b?.roomId === room?.id || b?.roomId === rm.id && a?.roomId === room?.id;
            })));
            if (pending.length) {
                const trial = clone(w), gate = trial.gates.find(g => g.id === existing.id);
                gate.a = clone(ends[0].side);
                gate.b = clone(ends[1].side);
                for (const rm of pending) moveGateCompanionToRegion(trial, existing.id, {
                    region: owner.id,
                    room: rm.id
                }, gate.a.region || gate.b.region);
            }
        }
        const gatePortIds = new Set(room ? gateRoomSnapshot(owner, room).ports.map(p => p.id) : []), isGateEnd = end => end.region === owner?.id && gatePortIds.has(end.port), detached = [];
        existing.connections = (existing.connections || []).filter(l => {
            if ([ l.a, l.b ].some(end => !isGateEnd(end) && !kept.has(end.region))) {
                detached.push({
                    ...clone(l),
                    reason: "region-rebound"
                });
                return false;
            }
            return true;
        });
        if (owner && !kept.has(owner.id)) owner.links = owner.links.filter(l => {
            if (gatePortIds.has(l.a) !== gatePortIds.has(l.b)) {
                const other = owner.ports.find(p => p.id === (gatePortIds.has(l.a) ? l.b : l.a)), companion = owner.rooms.find(rm => rm.id === other?.roomId && rm.roomType === "SHELTER");
                if (owner.gateStorageOnly && companion) {
                    companion.pendingRegionAssignment = true;
                    companion.gateCompanionId = existing.id;
                    return true;
                }
                detached.push({
                    ...clone(l),
                    a: {
                        region: owner.id,
                        port: l.a
                    },
                    b: {
                        region: owner.id,
                        port: l.b
                    },
                    reason: "region-rebound"
                });
                return false;
            }
            return true;
        });
        if (detached.length) (existing.detachedConnections ||= []).push(...detached);
        for (const prior of Object.values(previous)) if (prior.region && !kept.has(prior.region)) {
            const r = w.regions.find(r => r.id === prior.region);
            if (r) r.markers = r.markers.filter(m => !(m.id === prior.marker && m.sharedGateId === existing.id && !(r === owner && m.roomId === room?.id)));
        }
        for (const {key: key, side: next} of ends) {
            const prior = next.region ? Object.values(previous).find(side => side.region === next.region) : !previous[key].region ? previous[key] : null;
            existing[key] = prior ? {
                ...prior,
                ...clone(next),
                marker: prior.marker,
                ports: clone(prior.ports || []),
                karma: String(swapped ? prior.karma : next.karma)
            } : emptyGateSide(next);
        }
        existing.name = name;
        if (!existing.scenes.includes(sid)) existing.scenes.push(sid);
        existing.rebindReport = {
            detachedConnections: detached.length,
            assignedShelters: 0
        };
        syncSharedGate(w, existing);
        if (owner?.gateStorageOnly && kept.size) {
            const target = existing.a.region || existing.b.region;
            for (const rm of [ ...owner.rooms ].filter(rm => rm.roomType === "SHELTER" && rm.id !== room?.id)) {
                const linked = owner.links.some(l => {
                    const a = owner.ports.find(p => p.id === l.a), b = owner.ports.find(p => p.id === l.b);
                    return a?.roomId === rm.id && b?.roomId === room?.id || b?.roomId === rm.id && a?.roomId === room?.id;
                });
                if (rm.pendingRegionAssignment && rm.gateCompanionId === existing.id || linked) {
                    moveGateCompanionToRegion(w, existing.id, {
                        region: owner.id,
                        room: rm.id
                    }, target);
                    existing.rebindReport.assignedShelters++;
                }
            }
        }
        normalizeSharedGates(w);
        return existing;
    }
    function connectSharedGatePorts(w, gid, a, b) {
        const g = w.gates.find(g => g.id === gid);
        if (!g?.sharedRoom) throw Error("共享业力门不存在。");
        const ends = [ a, b ].map(ref => {
            const r = w.regions.find(r => r.id === ref.region), p = r?.ports.find(p => p.id === ref.port);
            if (!p || !(r.id === g.sharedRoom.region && p.roomId === g.sharedRoom.room) && ![ g.a.region, g.b.region ].filter(Boolean).includes(r.id)) throw Error("请选择共享门内或已绑定区域中的通道井。");
            if (lockReason(r, p, "ports")) throw Error(lockReason(r, p, "ports"));
            if (!p.roomId || [ "den", "internal" ].includes(p.kind)) throw Error("请选择可连接房间的通道井。");
            return {
                r: r,
                p: p
            };
        });
        if (a.region === b.region && a.port === b.port) throw Error("请选择另一个通道井。");
        if (ends.filter(e => e.r.id === g.sharedRoom.region && e.p.roomId === g.sharedRoom.room).length !== 1) throw Error("连接的一端需要位于共享业力门内，另一端位于已绑定区域的独立房间。");
        if ((g.connections || []).some(l => l.a.region === a.region && l.a.port === a.port && l.b.region === b.region && l.b.port === b.port || l.a.region === b.region && l.a.port === b.port && l.b.region === a.region && l.b.port === a.port) || a.region === b.region && ends[0].r.links.some(l => l.a === a.port && l.b === b.port || l.a === b.port && l.b === a.port)) throw Error("这两个通道井已经连接。");
        for (const e of ends) if (e.r.links.some(l => l.a === e.p.id || l.b === e.p.id) || w.gates.some(gate => (gate.connections || []).some(l => [ l.a, l.b ].some(end => end.region === e.r.id && end.port === e.p.id)))) throw Error("此通道井已有连接，请先解除原连接。");
        const link = {
            id: uid(),
            a: clone(a),
            b: clone(b)
        };
        (g.connections ||= []).push(link);
        for (const e of ends) if (e.p.roomId === g.sharedRoom.room && e.r.id === g.sharedRoom.region) {
            const other = ends.find(x => x !== e), key = other.r.id === g.a.region ? "a" : "b";
            g[key].ports = [ ...new Set([ ...g[key].ports || [], e.p.id ]) ];
        }
        return link;
    }
    function removeSharedGateConnection(w, gid, id) {
        const g = w.gates.find(g => g.id === gid), link = g?.connections?.find(l => l.id === id);
        if (!link) return;
        for (const end of [ link.a, link.b ]) {
            const r = w.regions.find(r => r.id === end.region), p = r?.ports.find(p => p.id === end.port);
            if (p && lockReason(r, p, "ports")) throw Error(lockReason(r, p, "ports"));
        }
        g.connections = g.connections.filter(l => l.id !== id);
    }
    function moveGateCompanionToRegion(w, gid, ref, targetRegion) {
        const g = w.gates.find(g => g.id === gid), source = w.regions.find(r => r.id === ref.region), rm = source?.rooms.find(rm => rm.id === ref.room), target = w.regions.find(r => r.id === targetRegion && !r.gateStorageOnly);
        if (!g || !rm || rm.roomType !== "SHELTER" || !target || ![ g.a.region, g.b.region ].includes(target.id)) throw Error("请选择这个业力门已绑定区域中的庇护所归属。");
        if (lockReason(source, rm, "rooms")) throw Error(lockReason(source, rm, "rooms"));
        if (source === target) {
            delete rm.pendingRegionAssignment;
            rm.gateCompanionId = gid;
            return rm;
        }
        const layer = ensureShelterLayer(target);
        if (layer.locked) throw Error("目标区域庇护所层级已锁定。");
        const snapshot = gateRoomSnapshot(source, rm), old = {
            ...rm
        }, box = {
            x: Math.max(0, Math.min(target.w - rm.w, rm.x)),
            y: Math.max(0, Math.min(target.h - rm.h, rm.y)),
            w: rm.w,
            h: rm.h,
            layer: layer.id
        };
        target.w = Math.max(target.w, box.w);
        target.h = Math.max(target.h, box.h);
        if (target.rooms.some(o => o.layer === layer.id && intersection(o, box))) {
            const p = roomCopyPosition(target, box, layer.id);
            if (p) Object.assign(box, p); else if (target.w + box.w + 4 <= 4096) {
                box.x = target.w + 4;
                box.y = 0;
                target.w = box.x + box.w;
            } else if (target.h + box.h + 4 <= 4096) {
                box.y = target.h + 4;
                box.x = 0;
                target.h = box.y + box.h;
            } else throw Error("目标区域没有足够空间放置庇护所。");
        }
        const ids = new Set([ "rooms", "shapes", "markers", "ports", "links", "refs" ].flatMap(k => target[k].map(o => o.id))), mapping = new Map, allocate = id => {
            let next = id;
            while (ids.has(next)) next = uid();
            ids.add(next);
            mapping.set(id, next);
            return next;
        }, moved = {
            ...clone(rm),
            ...box,
            id: allocate(rm.id),
            name: nextRoomName(target, "SHELTER", layer.id),
            gateCompanionId: gid
        };
        delete moved.pendingRegionAssignment;
        target.rooms.push(moved);
        for (const key of [ "shapes", "markers", "ports", "refs" ]) for (const o of snapshot[key]) {
            const next = {
                ...clone(o),
                id: allocate(o.id),
                roomId: moved.id,
                layer: layer.id
            };
            shift(next, moved.x - old.x, moved.y - old.y);
            target[key].push(next);
        }
        const movingPorts = new Set(snapshot.ports.map(p => p.id));
        for (const link of snapshot.links) {
            const end = id => movingPorts.has(id) ? {
                region: target.id,
                port: mapping.get(id)
            } : {
                region: source.id,
                port: id
            }, a = end(link.a), b = end(link.b);
            if (a.region === target.id && b.region === target.id) target.links.push({
                ...clone(link),
                id: allocate(link.id),
                a: a.port,
                b: b.port
            }); else (g.connections ||= []).push({
                ...clone(link),
                id: uid(),
                a: a,
                b: b
            });
        }
        source.links = source.links.filter(l => !movingPorts.has(l.a) && !movingPorts.has(l.b));
        source.shapes = source.shapes.flatMap(s => s.roomId === old.id ? [] : !s.roomId && s.layer === old.layer && intersection(bounds(s), old) ? subtract(bounds(s), old).map(clip => ({
            ...clone(s),
            id: uid(),
            clip: clip
        })) : [ s ]);
        for (const key of [ "markers", "ports", "refs" ]) {
            const removed = new Set(snapshot[key].map(o => o.id));
            source[key] = source[key].filter(o => !removed.has(o.id));
        }
        source.rooms = source.rooms.filter(o => o.id !== old.id);
        for (const gate of w.gates) for (const link of gate.connections || []) for (const key of [ "a", "b" ]) if (link[key].region === source.id && movingPorts.has(link[key].port)) link[key] = {
            region: target.id,
            port: mapping.get(link[key].port)
        };
        syncShelterPort(target, moved);
        g.companions = (g.companions || []).filter(o => !(o.region === source.id && o.room === old.id));
        g.companions.push({
            region: target.id,
            room: moved.id
        });
        return moved;
    }
    function detachSharedGateBindings(w, gid, {side: side} = {}) {
        const g = w.gates.find(g => g.id === gid);
        if (!g) return;
        const sid = g.scenes.find(id => w.scenes.some(s => s.id === id)) || w.activeScene, draft = {
            name: g.name,
            a: side === "b" ? clone(g.a) : emptyGateSide({
                karma: g.a.karma
            }),
            b: side === "a" ? clone(g.b) : emptyGateSide({
                karma: g.b.karma
            })
        };
        return saveGateConnection(w, sid, draft, gid);
    }
    function assignPendingRoomRegion(w, ref, targetRegion, sceneId = w.activeScene) {
        const source = w.regions.find(r => r.id === ref.region), rm = source?.rooms.find(rm => rm.id === ref.room), target = w.regions.find(r => r.id === targetRegion && !r.gateStorageOnly), scene = w.scenes.find(s => s.id === sceneId);
        if (!source?.gateStorageOnly || !rm?.pendingRegionAssignment || rm.roomType !== "SHELTER" || !target || !scene) throw Error("请选择待归属的独立庇护所和真实区域。");
        const ports = new Set(gateRoomSnapshot(source, rm).ports.map(p => p.id)), recipients = new Map;
        for (const link of source.links) {
            if (ports.has(link.a) === ports.has(link.b)) continue;
            const other = source.ports.find(p => p.id === (ports.has(link.a) ? link.b : link.a)), gate = other && sharedGateForRoom(w, source.id, other.roomId);
            if (!gate || ![ gate.a.region, gate.b.region ].includes(target.id)) throw Error("此房间还连接着其他待归属房间，请先解除该连接，或选择该业力门已绑定的区域。");
            recipients.set(link.id, gate);
        }
        const temporary = {
            id: uid(),
            a: emptyGateSide({
                region: target.id
            }),
            b: emptyGateSide(),
            scenes: [ scene.id ],
            connections: []
        };
        w.gates.push(temporary);
        let moved;
        try {
            moved = moveGateCompanionToRegion(w, temporary.id, ref, target.id);
            for (const link of temporary.connections) {
                const previous = source.links.find(l => l.id === link.id), recipient = previous && recipients.get(previous.id) || [ ...recipients.values() ].find(g => [ link.a, link.b ].some(end => {
                    const p = w.regions.find(r => r.id === end.region)?.ports.find(p => p.id === end.port);
                    return end.region === g.sharedRoom.region && p?.roomId === g.sharedRoom.room;
                }));
                if (recipient) (recipient.connections ||= []).push(link);
            }
            delete moved.gateCompanionId;
            delete moved.pendingRegionAssignment;
            if (!scene.regions.includes(target.id)) {
                scene.regions.push(target.id);
                scene.placements[target.id] ||= {
                    x: 0,
                    y: 0
                };
            }
        } finally {
            w.gates = w.gates.filter(g => g !== temporary);
        }
        return moved;
    }
    function removeSharedGate(w, gid, {deleteRoom: erase = true, sceneId: sceneId, unregister: unregister = false} = {}) {
        const g = w.gates.find(g => g.id === gid);
        if (!g) return;
        const owner = w.regions.find(r => r.id === g.sharedRoom?.region), room = owner?.rooms.find(rm => rm.id === g.sharedRoom?.room);
        for (const key of [ "a", "b" ]) {
            const r = w.regions.find(r => r.id === g[key].region), m = r?.markers.find(m => m.id === g[key].marker);
            if (m && lockReason(r, m, "gate")) throw Error(lockReason(r, m, "gate"));
        }
        if (room && lockReason(owner, room, "rooms")) throw Error(lockReason(owner, room, "rooms"));
        if (sceneId) {
            g.scenes = g.scenes.filter(id => id !== sceneId);
            if (g.scenes.length) return room;
        }
        if (!erase && !unregister) return detachSharedGateBindings(w, gid);
        if (room) {
            room.detachedGateBackup = clone(g);
            delete room.sharedGateId;
        }
        const projectionIds = new Map([ g.a, g.b ].filter(s => s.region).map(s => [ s.region, s.marker ]));
        for (const r of w.regions) {
            r.markers = r.markers.filter(m => m.sharedGateId !== gid && projectionIds.get(r.id) !== m.id || r === owner && m.roomId === room?.id);
            for (const m of r.markers) if (m.sharedGateId === gid) {
                delete m.sharedGateId;
                delete m.sharedGateRoom;
            }
            for (const rm of r.rooms) if (rm.gateCompanionId === gid) {
                delete rm.gateCompanionId;
                if (r.gateStorageOnly) rm.pendingRegionAssignment = true;
            }
        }
        w.gates = w.gates.filter(o => o !== g);
        if (erase && room) deleteRoom(w, owner, room.id);
        w.regions = w.regions.filter(r => !r.gateStorageOnly || r.rooms.length || r.shapes.length || r.ports.length || r.refs.length);
        return room;
    }
    function chooseSharedGateSource(w, gid, rid) {
        const g = w.gates.find(g => g.id === gid), source = g?.legacyRooms?.find(s => s.region === rid), r = w.regions.find(r => r.id === g?.sharedRoom?.region), rm = r?.rooms.find(rm => rm.id === g.sharedRoom.room);
        if (!source || !rm) throw Error("旧业力门来源不存在。");
        if (lockReason(r, rm, "rooms")) throw Error(lockReason(r, rm, "rooms"));
        const old = {
            x: rm.x,
            y: rm.y,
            w: rm.w,
            h: rm.h
        };
        if (old.x + source.room.w > r.w || old.y + source.room.h > r.h || r.rooms.some(o => o !== rm && o.layer === rm.layer && intersection(o, {
            ...old,
            w: source.room.w,
            h: source.room.h
        }))) throw Error("此来源尺寸较大，请先为共享房间留出空间。");
        (g.sourceHistory ||= []).push(gateRoomSnapshot(r, rm));
        const keep = {
            id: rm.id,
            layer: rm.layer,
            x: rm.x,
            y: rm.y,
            name: rm.name,
            sharedGateId: g.id
        };
        for (const key of Object.keys(rm)) delete rm[key];
        Object.assign(rm, clone(source.room), keep);
        r.shapes = r.shapes.filter(s => s.roomId !== rm.id);
        for (const s of source.shapes) {
            const next = {
                ...clone(s),
                id: uid(),
                roomId: rm.id,
                layer: rm.layer
            };
            shift(next, rm.x - source.room.x, rm.y - source.room.y);
            r.shapes.push(next);
        }
        for (const p of [ ...r.ports, ...r.markers ]) if (p.roomId === rm.id) {
            p.x = Math.max(rm.x, Math.min(rm.x + rm.w, p.x));
            p.y = Math.max(rm.y, Math.min(rm.y + rm.h, p.y));
        }
        g.selectedLegacySource = rid;
        syncSharedGate(w, g);
        return rm;
    }
    function exportWorkspace(w, sid, regionIds) {
        const source = w.scenes.find(s => s.id === sid);
        if (!source) throw Error("当前地图不存在。");
        const wanted = new Set(regionIds), ids = source.regions.filter(id => wanted.has(id));
        if (!ids.length && (source.regions.some(id => w.regions.some(r => r.id === id && !r.gateStorageOnly)) || !w.gates.some(g => g.scenes.includes(sid) && !g.a.region && !g.b.region) && !w.regions.some(r => r.gateStorageOnly && r.rooms.some(rm => rm.pendingRegionAssignment)))) throw Error("请至少勾选一个区域。");
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
        out.gates = out.gates.filter(g => g.scenes.includes(sid) && (!g.a.region && !g.b.region || selected.has(g.a.region) || selected.has(g.b.region))).map(g => ({
            ...g,
            scenes: [ sid ]
        }));
        const contextRefs = [ ...out.gates.flatMap(g => [ g.a, g.b, g.sharedRoom || {} ]), ...w.regions.filter(r => r.gateStorageOnly && r.rooms.some(rm => rm.pendingRegionAssignment)).map(r => ({
            region: r.id
        })) ];
        for (const side of contextRefs) if (!out.regions.some(r => r.id === side.region)) {
            const original = w.regions.find(r => r.id === side.region);
            if (!original) continue;
            const r = clone(original), rooms = new Set([ ...out.gates.filter(g => g.sharedRoom?.region === r.id).map(g => g.sharedRoom.room), ...r.rooms.filter(rm => r.gateStorageOnly && rm.pendingRegionAssignment).map(rm => rm.id) ]), gateRooms = new Set(rooms), portById = new Map(r.ports.map(p => [ p.id, p ]));
            for (const link of r.links) {
                const a = portById.get(link.a), b = portById.get(link.b);
                if (a && b && (gateRooms.has(a.roomId) || gateRooms.has(b.roomId))) {
                    rooms.add(a.roomId);
                    rooms.add(b.roomId);
                }
            }
            for (const gate of out.gates) for (const link of gate.connections || []) for (const end of [ link.a, link.b ]) if (end.region === r.id) {
                const p = portById.get(end.port);
                if (p?.roomId) rooms.add(p.roomId);
            }
            r.gateContextOnly = true;
            r.gateContextRoomIds = [ ...rooms ];
            r.rooms = r.rooms.filter(rm => rooms.has(rm.id));
            r.shapes = r.shapes.filter(s => s.roomId ? rooms.has(s.roomId) : r.rooms.some(rm => rm.layer === s.layer && intersection(bounds(s), rm)));
            for (const key of [ "ports", "refs" ]) r[key] = r[key].filter(o => rooms.has(o.roomId));
            r.markers = r.markers.filter(m => rooms.has(m.roomId) || m.kind === "gate" && out.gates.some(g => [ g.a, g.b ].some(side => side.region === r.id && side.marker === m.id)));
            const ports = new Set(r.ports.map(p => p.id));
            r.links = r.links.filter(l => ports.has(l.a) && ports.has(l.b));
            out.regions.push(r);
        }
        for (const r of out.regions) {
            const omitted = new Set(r.markers.filter(m => m.kind === "gate" && m.sceneIds?.length && !m.sceneIds.includes(sid)).map(m => m.roomId));
            r.markers = r.markers.filter(m => !m.sceneIds?.length || m.sceneIds.includes(sid)).map(m => ({
                ...m,
                sceneIds: m.sceneIds?.length ? [ sid ] : []
            }));
            for (const rm of r.rooms) if (omitted.has(rm.id) && !r.markers.some(m => m.kind === "gate" && m.roomId === rm.id)) rm.gateMarkerOmitted = true;
        }
        for (const g of out.gates) for (const key of [ "a", "b" ]) {
            const side = g[key], r = out.regions.find(r => r.id === side.region), old = w.regions.find(r => r.id === side.region)?.markers.find(m => m.id === side.marker);
            if (r && !r.markers.some(m => m.id === side.marker) && old?.sceneIds?.length && !old.sceneIds.includes(sid)) side.markerOmitted = true;
        }
        return validate(out);
    }
    function sharedGateExportPlans(w, scene) {
        const selected = new Set(scene.regions), active = w.regions.filter(r => selected.has(r.id) && !r.gateStorageOnly), gates = w.gates.filter(g => g.sharedVersion === 2 && g.sharedRoom && g.scenes.includes(scene.id) && (!g.a.region && !g.b.region || [ g.a, g.b ].some(s => selected.has(s.region)))), diagnostics = [];
        const pendingRegions = w.regions.filter(r => r.gateStorageOnly && r.rooms.some(rm => rm.pendingRegionAssignment));
        if (!gates.length && !pendingRegions.length) return {
            regions: active,
            plans: new Map(active.map(r => [ r.id, prepareRegionShortcuts(r) ])),
            shared: {
                format: "rainoc-shared-gates",
                version: 1,
                gates: []
            },
            diagnostics: diagnostics
        };
        const included = new Map(active.map(r => [ r.id, new Set(r.rooms.map(rm => rm.id)) ])), canonical = new Map, names = new Set, pairNames = new Set;
        for (const r of w.regions.filter(r => r.gateContextOnly)) included.set(r.id, new Set(r.gateContextRoomIds || r.rooms.map(rm => rm.id)));
        for (const r of pendingRegions) {
            if (!included.has(r.id)) included.set(r.id, new Set);
            for (const rm of r.rooms.filter(rm => rm.pendingRegionAssignment)) included.get(r.id).add(rm.id);
        }
        for (const g of gates) {
            const a = w.regions.find(r => r.id === g.a.region && !r.gateStorageOnly), b = w.regions.find(r => r.id === g.b.region && !r.gateStorageOnly), owner = w.regions.find(r => r.id === g.sharedRoom.region), room = owner?.rooms.find(rm => rm.id === g.sharedRoom.room);
            if (!room) throw Error((g.name || "业力门") + "：共享房间缺失，无法导出。");
            if ([ a, b ].some(r => r && !/^[a-z0-9]+$/i.test(r.code))) throw Error("业力门两侧的区域简称只能包含英文字母和数字。");
            const complete = !!(a && b), name = complete ? "GATE_" + a.code.toUpperCase() + "_" + b.code.toUpperCase() : "DRAFT_GATE_" + g.id.toUpperCase(), pair = complete ? [ a.code.toUpperCase(), b.code.toUpperCase() ].sort().join("_") : null;
            if (pair && pairNames.has(pair)) throw Error("同一对区域存在多个业力门：" + name + "。原版游戏不能通过追加编号区分这些门；请先保留一个共享门。");
            if (pair) pairNames.add(pair);
            if (!complete) diagnostics.push({
                code: "SHARED_GATE_UNBOUND",
                severity: "warning",
                gate: g.id,
                message: (g.name || name) + "：尚未绑定两个区域，仅导出可编辑房间工程；未加入正式 world 连接表或锁表。"
            });
            canonical.set(owner.id + "|" + room.id, {
                gate: g,
                owner: owner,
                room: room,
                name: name,
                complete: complete
            });
            if (!included.has(owner.id)) included.set(owner.id, new Set);
            included.get(owner.id).add(room.id);
            if (owner.gateStorageOnly) {
                for (const link of owner.links) {
                    const a = owner.ports.find(p => p.id === link.a), b = owner.ports.find(p => p.id === link.b);
                    if (a && b && (a.roomId === room.id || b.roomId === room.id)) {
                        included.get(owner.id).add(a.roomId);
                        included.get(owner.id).add(b.roomId);
                    }
                }
                for (const link of g.connections || []) for (const end of [ link.a, link.b ]) if (end.region === owner.id) {
                    const p = owner.ports.find(p => p.id === end.port);
                    if (p?.roomId) included.get(owner.id).add(p.roomId);
                }
            }
        }
        const composite = {
            ...clone(active[0] || w.regions[0]),
            id: "shared-gate-export",
            w: Math.max(...w.regions.map(r => r.w)),
            h: Math.max(...w.regions.map(r => r.h)),
            layers: [],
            rooms: [],
            shapes: [],
            ports: [],
            links: [],
            markers: [],
            refs: []
        }, original = new Map, synthetic = new Map, originalRooms = new Map, sourcePort = new Map;
        const id = (rid, value) => rid.length + ":" + rid + ":" + value, remember = (rid, value) => {
            const key = id(rid, value);
            original.set(key, {
                region: rid,
                id: value
            });
            return key;
        };
        for (const r of w.regions) {
            const roomIds = included.get(r.id);
            if (!roomIds) continue;
            const layers = new Set(r.rooms.filter(rm => roomIds.has(rm.id)).map(rm => rm.layer));
            for (const l of r.layers.filter(l => layers.has(l.id))) composite.layers.push({
                ...clone(l),
                id: remember(r.id, l.id)
            });
            for (const room of r.rooms.filter(rm => roomIds.has(rm.id))) {
                const gate = canonical.get(r.id + "|" + room.id), name = gate?.name || room.name;
                if (names.has(name.toUpperCase())) throw Error("存在重名房间：" + name);
                names.add(name.toUpperCase());
                const rm = {
                    ...clone(room),
                    id: remember(r.id, room.id),
                    layer: id(r.id, room.layer),
                    name: name
                };
                composite.rooms.push(rm);
                originalRooms.set(rm.id, {
                    region: r,
                    room: room
                });
                synthetic.set(r.id + "|" + room.id, rm);
            }
            for (const shape of r.shapes.filter(s => layers.has(s.layer) && (!s.roomId || roomIds.has(s.roomId)))) composite.shapes.push({
                ...clone(shape),
                id: remember(r.id, shape.id),
                layer: id(r.id, shape.layer),
                ...shape.roomId ? {
                    roomId: id(r.id, shape.roomId)
                } : {}
            });
            for (const port of r.ports) {
                const owner = portRoomOwner(r, port);
                if (!owner || !roomIds.has(owner.id)) continue;
                const p = {
                    ...clone(port),
                    id: remember(r.id, port.id),
                    layer: id(r.id, port.layer),
                    roomId: id(r.id, owner.id)
                };
                composite.ports.push(p);
                sourcePort.set(p.id, {
                    region: r.id,
                    port: port
                });
            }
        }
        const portIds = new Set(composite.ports.map(p => p.id)), linkKeys = new Set, addLink = (link, a, b) => {
            const key = [ a, b ].sort().join("|");
            if (linkKeys.has(key)) return;
            if (!portIds.has(a) || !portIds.has(b)) {
                diagnostics.push({
                    code: "SHARED_GATE_PARTIAL_CONNECTION",
                    severity: "warning",
                    message: "共享业力门连接的另一端未包含在本次导出中；已保留连接登记，未生成或猜测另一端。",
                    link: clone(link)
                });
                return;
            }
            linkKeys.add(key);
            composite.links.push({
                ...clone(link),
                id: link.id,
                a: a,
                b: b
            });
        };
        for (const r of w.regions) if (included.has(r.id)) for (const link of r.links) addLink({
            ...link,
            id: remember(r.id, link.id)
        }, id(r.id, link.a), id(r.id, link.b));
        for (const g of gates) for (const link of g.connections || []) addLink({
            ...link,
            id: remember("gate-" + g.id, link.id)
        }, id(link.a.region, link.a.port), id(link.b.region, link.b.port));
        const all = prepareRegionShortcuts(composite), ref = value => original.get(value)?.id || value, regionOf = value => original.get(value)?.region || null, ep = e => ({
            ...clone(e),
            region: regionOf(e.room),
            room: ref(e.room),
            port: ref(e.port),
            link: ref(e.link)
        }), rowByRoom = new Map(all.handoff.map(row => [ row.roomId, row ]));
        const mapIssue = d => ({
            ...clone(d),
            region: regionOf(d.room),
            room: ref(d.room),
            port: ref(d.port),
            link: ref(d.link),
            ...d.rooms ? {
                rooms: d.rooms.map(ref)
            } : {},
            ...d.ports ? {
                ports: d.ports.map(ref)
            } : {}
        }), plans = new Map;
        for (const r of active) {
            const own = new Set(r.rooms.filter(rm => canonical.get(r.id + "|" + rm.id)?.complete !== false).map(rm => id(r.id, rm.id))), shared = gates.filter(g => canonical.get(g.sharedRoom.region + "|" + g.sharedRoom.room)?.complete && [ g.a, g.b ].some(s => s.region === r.id));
            for (const g of shared) own.add(id(g.sharedRoom.region, g.sharedRoom.room));
            const states = [ ...all.rooms ].filter(([key]) => own.has(key)).sort((a, b) => a[1].room.name.localeCompare(b[1].room.name)), rooms = new Map, owners = new Map;
            for (const [key, state] of states) {
                const originalRoom = originalRooms.get(key), rm = {
                    ...clone(originalRoom.room),
                    name: state.room.name
                };
                rooms.set(regionOf(key) === r.id ? ref(key) : key, {
                    ...state,
                    room: rm,
                    endpoints: state.endpoints.map(ep),
                    routes: state.routes.map(route => ({
                        ...clone(route),
                        link: ref(route.link),
                        ports: route.ports.map(ref)
                    })),
                    sourceRegion: originalRoom.region.id
                });
            }
            for (const [port, owner] of all.owners) if (own.has(owner.id)) owners.set(ref(port), rooms.get(regionOf(owner.id) === r.id ? ref(owner.id) : owner.id).room);
            const handoff = states.map(([key]) => {
                const row = rowByRoom.get(key);
                return {
                    ...clone(row),
                    roomId: ref(key),
                    exits: row.exits.map(exit => {
                        const target = [ ...all.rooms ].find(([, state]) => state.room.name === exit.target)?.[0], local = target && own.has(target);
                        return {
                            ...clone(exit),
                            port: ref(exit.port),
                            targetPort: local ? ref(exit.targetPort) : null,
                            target: local ? exit.target : "DISCONNECTED",
                            targetNode: local ? exit.targetNode : null,
                            ...!local && exit.target !== "DISCONNECTED" ? {
                                externalTarget: exit.target,
                                externalRegion: regionOf(target)
                            } : {}
                        };
                    })
                };
            });
            const connections = all.connections.filter(c => own.has(c.a.room) || own.has(c.b.room)).map(c => ({
                ...clone(c),
                link: ref(c.link),
                a: ep(c.a),
                b: ep(c.b)
            }));
            plans.set(r.id, {
                ...all,
                rooms: rooms,
                owners: owners,
                connections: connections,
                handoff: handoff,
                diagnostics: all.diagnostics.filter(d => own.has(d.room) || d.rooms?.some(k => own.has(k))).map(mapIssue),
                ownershipRepairs: all.ownershipRepairs.filter(d => regionOf(d.room) === r.id).map(d => ({
                    ...clone(d),
                    port: ref(d.port),
                    room: ref(d.room),
                    previousRoom: ref(d.previousRoom)
                }))
            });
        }
        const shared = {
            format: "rainoc-shared-gates",
            version: 1,
            gates: gates.map(g => {
                const {owner: owner, room: room, name: name, complete: complete} = canonical.get(g.sharedRoom.region + "|" + g.sharedRoom.room), registrations = [ g.a, g.b ].filter(s => complete && selected.has(s.region)).map(s => ({
                    region: s.region,
                    code: w.regions.find(r => r.id === s.region).code,
                    room: name,
                    renderedBounds: rainedRenderedBounds(room),
                    exits: clone(plans.get(s.region).handoff.find(row => row.room === name).exits)
                })), sides = [ "a", "b" ].map(key => ({
                    key: key,
                    region: g[key].region,
                    code: w.regions.find(r => r.id === g[key].region)?.code || null,
                    karma: String(g[key].karma),
                    ports: clone(g[key].ports || [])
                })), portMean = side => {
                    const gateRoomId = id(owner.id, room.id), ports = new Map;
                    for (const connection of all.connections) for (const [entrance, target] of [ [ connection.a, connection.b ], [ connection.b, connection.a ] ]) {
                        const targetRoom = originalRooms.get(target.room), p = sourcePort.get(entrance.port)?.port;
                        if (entrance.room === gateRoomId && targetRoom?.region.id === g[side].region && (!targetRoom.room.roomType || targetRoom.room.roomType === "ROOM") && p?.kind === "exit") ports.set(p.id, p);
                    }
                    const ps = [ ...ports.values() ];
                    return ps.length ? ps.reduce((n, p) => n + p.x - room.x, 0) / ps.length : null;
                }, ax = portMean("a"), bx = portMean("b"), left = ax !== null && bx !== null && ax !== bx ? ax < bx ? "a" : "b" : "a", lockValue = side => String(g[side].karma) === "locked" ? "Forbidden" : String(g[side].karma), locks = complete ? {
                    left: {
                        side: left,
                        requirement: lockValue(left)
                    },
                    right: {
                        side: left === "a" ? "b" : "a",
                        requirement: lockValue(left === "a" ? "b" : "a")
                    },
                    inferred: ax !== null && bx !== null && ax !== bx,
                    swapMapSymbol: left === "b"
                } : null;
                if (locks && !locks.inferred && g.a.karma !== g.b.karma) diagnostics.push({
                    code: "SHARED_GATE_LOCK_ORIENTATION",
                    severity: "warning",
                    gate: g.id,
                    message: name + "：两侧入口尚未能确定左右顺序，业力要求暂按区域 A 在左、区域 B 在右登记，请在 Rained 检查门机构朝向。"
                });
                if (complete && registrations.length < 2) diagnostics.push({
                    code: "SHARED_GATE_PARTIAL_EXPORT",
                    severity: "warning",
                    gate: g.id,
                    message: name + "：本次只导出了一侧区域；共享房间和另一侧信息已保留，需同时安装另一侧区域才能穿门。"
                });
                return {
                    id: g.id,
                    name: g.name,
                    room: name,
                    owner: {
                        region: owner.id,
                        room: room.id
                    },
                    sides: sides,
                    registrations: registrations,
                    locks: locks,
                    connections: clone(g.connections || []),
                    migrationWarnings: clone(g.migrationWarnings || []),
                    complete: complete && registrations.length === 2,
                    bound: complete,
                    renderPath: "rooms/" + name + ".txt",
                    gamePath: complete ? "world/gates/" + name : null
                };
            })
        };
        const standaloneRooms = [ ...all.rooms ].filter(([key]) => {
            const originalRoom = originalRooms.get(key), gate = canonical.get(originalRoom.region.id + "|" + originalRoom.room.id);
            return gate?.complete === false || originalRoom.region.gateStorageOnly && !gate;
        }).map(([key, state]) => {
            const originalRoom = originalRooms.get(key);
            if (originalRoom.room.roomType !== "GATE") diagnostics.push({
                code: "ROOM_REGION_UNASSIGNED",
                severity: "warning",
                room: originalRoom.room.id,
                message: originalRoom.room.name + "：尚未归属区域，仅保留房间工程，未加入正式 world 连接表。"
            });
            return {
                ...state,
                room: {
                    ...clone(originalRoom.room),
                    name: state.room.name
                },
                endpoints: state.endpoints.map(ep),
                sourceRegion: originalRoom.region.id
            };
        });
        const standaloneIds = new Set(standaloneRooms.map(state => id(state.sourceRegion, state.room.id)));
        diagnostics.push(...all.diagnostics.filter(d => standaloneIds.has(d.room) || d.rooms?.some(key => standaloneIds.has(key))).map(mapIssue));
        return {
            regions: active,
            plans: plans,
            shared: shared,
            diagnostics: diagnostics,
            canonical: canonical,
            standaloneRooms: standaloneRooms
        };
    }
    function sanitizeRainedBaseline(value) {
        const out = {
            format: "rainoc-rained-baseline",
            version: 1,
            scenes: {}
        };
        if (value?.format !== out.format || value.version !== 1 || !value.scenes || typeof value.scenes !== "object") return out;
        for (const [sid, scene] of Object.entries(value.scenes)) {
            if (!sid || sid.length > 200 || !scene?.rooms || typeof scene.rooms !== "object") continue;
            const rooms = {};
            for (const [key, record] of Object.entries(scene.rooms)) {
                if (!/^sha256:[a-f0-9]{64}$/.test(record?.signature || "") || typeof record.name !== "string" || record.name.length > 200) continue;
                let ref;
                try {
                    ref = JSON.parse(key);
                } catch {
                    continue;
                }
                if (!Array.isArray(ref) || ref.length !== 2 || ref.some(id => typeof id !== "string" || !id || id.length > 200)) continue;
                rooms[key] = {
                    signature: record.signature,
                    name: record.name,
                    regions: Array.isArray(record.regions) ? record.regions.filter(id => typeof id === "string" && id.length <= 200) : [ ref[0] ]
                };
            }
            out.scenes[sid] = {
                rooms: rooms
            };
        }
        return out;
    }
    function rainedExportSignature(text) {
        const bytes = (new TextEncoder).encode(text), length = bytes.length, size = Math.ceil((length + 9) / 64) * 64, data = new Uint8Array(size);
        data.set(bytes);
        data[length] = 128;
        const view = new DataView(data.buffer);
        view.setUint32(size - 8, Math.floor(length / 536870912));
        view.setUint32(size - 4, length * 8 >>> 0);
        const k = [ 1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298 ], h = new Uint32Array([ 1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225 ]), words = new Uint32Array(64), rotate = (v, n) => v >>> n | v << 32 - n;
        for (let offset = 0; offset < size; offset += 64) {
            for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
            for (let i = 16; i < 64; i++) {
                const x = words[i - 15], y = words[i - 2];
                words[i] = (rotate(x, 7) ^ rotate(x, 18) ^ x >>> 3) + words[i - 16] + (rotate(y, 17) ^ rotate(y, 19) ^ y >>> 10) + words[i - 7];
            }
            let [a, b, c, d, e, f, g, z] = h;
            for (let i = 0; i < 64; i++) {
                const t1 = z + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + k[i] + words[i] >>> 0, t2 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c) >>> 0;
                z = g;
                g = f;
                f = e;
                e = d + t1 >>> 0;
                d = c;
                c = b;
                b = a;
                a = t1 + t2 >>> 0;
            }
            for (const [i, v] of [ a, b, c, d, e, f, g, z ].entries()) h[i] = h[i] + v >>> 0;
        }
        return "sha256:" + Array.from(h, v => v.toString(16).padStart(8, "0")).join("");
    }
    function selectRainedExportRooms(result, options = {}) {
        const state = result._rainedExportState;
        if (!state) throw Error("请先准备 Rained 房间导出。");
        const baseline = sanitizeRainedBaseline(options.baseline ?? state.baseline), previous = baseline.scenes[state.sceneId]?.rooms || {}, keys = options.roomKeys === undefined ? null : new Set(options.roomKeys);
        if (keys && [ ...keys ].some(key => !state.rooms.some(room => room.key === key))) throw Error("所选房间已改变，请重新选择导出房间。");
        const candidates = state.rooms.map(room => {
            const record = previous[room.key], status = !record ? "new" : record.signature === room.signature ? "unchanged" : "changed";
            return {
                ...room,
                status: status,
                selected: (!keys || keys.has(room.key)) && (!options.changedOnly || status !== "unchanged")
            };
        }), selected = candidates.filter(room => room.selected), paths = new Set(selected.map(room => room.path)), files = {
            ...state.files
        };
        for (const room of candidates) if (!paths.has(room.path)) {
            delete files[room.path];
            delete files["original-room-backups/" + room.name + ".txt"];
        }
        const currentNames = new Set(candidates.map(room => room.name)), removedRooms = [];
        for (const [key, record] of Object.entries(previous)) {
            const current = candidates.find(room => room.key === key);
            if (current?.name === record.name || current && !current.selected || currentNames.has(record.name) || !current && !(record.regions || [ JSON.parse(key)[0] ]).some(id => state.regionScope.includes(id))) continue;
            removedRooms.push({
                key: key,
                name: record.name,
                reason: current ? "renamed" : "deleted",
                replacement: current?.name || null,
                files: [ record.name + ".txt", record.name + "_settings.txt", record.name + "_*.png" ]
            });
        }
        const selection = {
            format: "rainoc-rained-room-selection",
            version: 1,
            scene: state.sceneId,
            mode: keys ? "selected" : options.changedOnly ? "changed" : "all",
            engineeringRoomCount: selected.length,
            totalRoomCount: candidates.length,
            rooms: candidates.map(({path: path, ...room}) => room),
            removedRooms: removedRooms,
            unexportedChanges: candidates.filter(room => !room.selected && room.status !== "unchanged").map(room => room.name)
        };
        files["export-selection.json"] = JSON.stringify(selection, null, 2);
        const manifest = JSON.parse(files["design-manifest.json"]);
        manifest.roomSelection = selection;
        files["design-manifest.json"] = JSON.stringify(manifest, null, 2);
        if (selection.mode !== "all") files["README.txt"] = "本次输出 " + selected.length + " 个房间工程；完整区域连接和锁表仍已包含。只需渲染 rooms 文件夹中的房间；未输出的房间请保留之前的渲染结果。首次导出没有比较记录，可手动勾选房间。\n\n" + files["README.txt"];
        if (selection.unexportedChanges.length) files["README.txt"] = "未包含新增或修改的房间工程：" + selection.unexportedChanges.join("、") + "。若尚未另行渲染这些房间，请先补齐对应结果再替换完整区域连接表。\n\n" + files["README.txt"];
        if (removedRooms.length) {
            files["removed-room-files.json"] = JSON.stringify({
                format: "rainoc-obsolete-room-files",
                version: 1,
                rooms: removedRooms
            }, null, 2);
            files["README.txt"] = "旧房间已删除或改名：" + removedRooms.map(room => room.name).join("、") + "。请核对 removed-room-files.json，在安装新导出后清理这些旧 TXT、settings 和相机 PNG；本工具不会直接删除你的文件。\n\n" + files["README.txt"];
        }
        const nextBaseline = clone(baseline);
        nextBaseline.scenes[state.sceneId] ||= {
            rooms: {}
        };
        for (const room of removedRooms) delete nextBaseline.scenes[state.sceneId].rooms[room.key];
        for (const room of selected) nextBaseline.scenes[state.sceneId].rooms[room.key] = {
            signature: room.signature,
            name: room.name,
            regions: room.regions
        };
        return {
            ...result,
            files: files,
            count: selected.length,
            totalCount: candidates.length,
            roomCandidates: candidates,
            nextBaseline: nextBaseline,
            selection: selection,
            removedRooms: removedRooms,
            _rainedExportState: state
        };
    }
    function rainedExportFiles(w, options = {}) {
        const scene = w.scenes.find(s => s.id === w.activeScene), preparedExport = sharedGateExportPlans(w, scene), shortcutPlans = preparedExport.plans, warnings = [ ...new Set([ ...check(w, scene, {
            shortcutPlans: shortcutPlans
        }), ...preparedExport.diagnostics.map(d => d.message) ]) ], files = {}, safeName = name => name.replace(/[^a-z0-9_-]/gi, "_"), manifest = {
            format: "rw-oc-design-manifest",
            version: 1,
            scene: clone(scene),
            regions: clone(w.regions),
            roomTypes: preparedExport.regions.map(r => ({
                region: r.code,
                rooms: [ ...shortcutPlans.get(r.id).rooms.values() ].map(s => ({
                    name: s.room.name,
                    type: s.room.roomType || "ROOM",
                    worldTags: [ "SHELTER", "GATE" ].includes(s.room.roomType) ? [ s.room.roomType ] : [],
                    gateTo: s.room.gateTo || null
                }))
            })),
            gates: clone(w.gates),
            sharedGates: preparedExport.shared,
            dependencies: exportDependencies(w, scene),
            warnings: warnings
        };
        let count = 0;
        const writtenRooms = new Set;
        const roomCandidates = [];
        manifest.shelterRepairs = [];
        manifest.connectionWarnings = [ ...preparedExport.regions.flatMap(r => roomConnectionIssues(r, {
            shortcutPlan: shortcutPlans.get(r.id)
        })), ...preparedExport.diagnostics ];
        manifest.roomWarnings = [ ...preparedExport.regions.flatMap(r => roomWarnings(r, {
            shortcutPlan: shortcutPlans.get(r.id)
        })), ...preparedExport.diagnostics ];
        manifest.shortcutProtocol = {
            format: "rainoc-rained-shortcuts",
            version: 2,
            coordinates: "room-local-top-left-zero-based",
            gameCoordinates: "game-room-local-top-left-zero-based",
            nodeOrder: "exit-nodes: y ascending, then x ascending",
            sharedGates: preparedExport.shared,
            regions: []
        };
        const writeRoom = (state, fallbackRegion) => {
            const rm = state.room, sourceRegion = w.regions.find(rr => rr.id === (state.sourceRegion || fallbackRegion.id)) || fallbackRegion, safe = safeName(rm.name), identity = (state.sourceRegion || fallbackRegion.id) + "|" + rm.id;
            if (writtenRooms.has(identity)) return;
            if (files["rooms/" + safe + ".txt"]) throw Error("存在重名房间：" + safe);
            let geometry = state.geometry;
            if (rm.roomType === "SHELTER") {
                const prepared = protectShelterGeometry(raster(sourceRegion, rm, {
                    unprotected: true
                }), {
                    ...rm,
                    repairInterior: true
                });
                if (prepared.issues.length) throw Error(rm.name + "：庇护所类型异常，无法安全自动补齐。" + prepared.issues.map(p => p.message).join(" "));
                if (prepared.repairs.length) {
                    geometry = prepared.geometry;
                    manifest.shelterRepairs.push({
                        room: rm.name,
                        repairs: prepared.repairs
                    });
                }
            }
            const path = "rooms/" + safe + ".txt", text = rainedText(sourceRegion, rm, {
                geometry: geometry
            }), gate = preparedExport.shared.gates.find(g => g.owner.region === sourceRegion.id && g.owner.room === rm.id), regions = gate ? gate.sides.filter(side => side.region).map(side => side.region) : [ sourceRegion.id ];
            files[path] = text;
            roomCandidates.push({
                key: JSON.stringify([ sourceRegion.id, rm.id ]),
                region: sourceRegion.id,
                regions: regions.length ? regions : scene.regions.slice(),
                room: rm.id,
                name: safe,
                path: path,
                signature: rainedExportSignature(safe + "\n" + text)
            });
            count++;
            writtenRooms.add(identity);
            if (rm.rainedTransformOriginal?.source) files["original-room-backups/" + safe + ".txt"] = rm.rainedTransformOriginal.source;
        };
        for (const r of preparedExport.regions) {
            const plan = shortcutPlans.get(r.id), record = {
                region: r.id,
                code: r.code,
                ownershipRepairs: plan.ownershipRepairs,
                diagnostics: plan.diagnostics,
                rooms: [ ...plan.rooms.values() ].map(s => ({
                    room: s.room.id,
                    name: s.room.name,
                    renderedBounds: rainedRenderedBounds(s.room),
                    endpoints: s.endpoints,
                    internalRoutes: s.routes,
                    sourceRegion: s.sourceRegion || r.id,
                    ...s.room.sharedGateId ? {
                        sharedGate: s.room.sharedGateId
                    } : {}
                })),
                connections: plan.connections,
                worldConnections: plan.handoff
            };
            manifest.shortcutProtocol.regions.push(record);
            for (const repair of plan.ownershipRepairs) {
                const p = manifest.regions.find(rr => rr.id === r.id)?.ports.find(p => p.id === repair.port);
                if (p) p.roomId = repair.room;
            }
            for (const state of plan.rooms.values()) writeRoom(state, r);
            const worldPath = "world-connections/" + safeName(r.code).toLowerCase() + "/world_" + safeName(r.code).toLowerCase() + ".txt";
            if (files[worldPath]) throw Error("区域简称重复，无法生成世界连接交接文件：" + r.code);
            files[worldPath] = "ROOMS\n" + plan.handoff.map(row => safeName(row.room) + " : " + (row.exits.map(e => e.target === "DISCONNECTED" ? "DISCONNECTED" : safeName(e.target)).join(", ") || "DISCONNECTED") + ([ "SHELTER", "GATE" ].includes(row.roomType) ? " : " + row.roomType : "")).join("\n") + "\nEND ROOMS\n\nCREATURES\nEND CREATURES\n";
        }
        for (const state of preparedExport.standaloneRooms || []) writeRoom(state, w.regions.find(r => r.id === state.sourceRegion));
        manifest.shortcutProtocol.unassignedRooms = (preparedExport.standaloneRooms || []).map(state => ({
            room: state.room.id,
            name: state.room.name,
            renderedBounds: rainedRenderedBounds(state.room),
            sourceRegion: state.sourceRegion,
            endpoints: state.endpoints,
            internalRoutes: state.routes,
            reason: state.room.roomType === "GATE" ? "unbound-gate" : "unassigned-region"
        }));
        if (preparedExport.shared.gates.length) {
            const lines = preparedExport.shared.gates.filter(g => g.locks).map(g => g.room + " : " + g.locks.left.requirement + " : " + g.locks.right.requirement + (g.locks.swapMapSymbol ? " : SWAPMAPSYMBOL" : ""));
            files["shared-gates.json"] = JSON.stringify(preparedExport.shared, null, 2);
            if (lines.length) {
                files["world-connections/gates/locks.txt"] = lines.join("\n") + "\n";
                files["mod-fragments/modify/world/gates/locks.txt"] = lines.map(line => "[ADD]" + line).join("\n") + "\n";
            }
            files["world-connections/gates/README.txt"] = "每扇共享业力门只需渲染一份 rooms/GATE_A_B.txt。将编译后的 TXT、全部相机 PNG 及对应 settings 放入模组 world/gates/。两侧 world_*.txt 必须保留同名 GATE 房间及相同出口槽位；另一侧出口的 DISCONNECTED 是正常登记。把 mod-fragments/modify 文件夹合并进模组根目录，以追加本次的锁要求；若已有 modify/world/gates/locks.txt，请合并其中的新增行。不要用这里的锁表片段覆盖原版全部锁表。Forbidden 和 6–10 需要 RegionKit ExtendedGates。\n";
        }
        if (!count) throw Error("所选区域没有房间，请先切分房间。");
        for (const item of manifest.shelterRepairs) if (roomWarningEnabled(w.settings, w.regions.flatMap(r => r.rooms).find(rm => rm.name === item.room), "export")) warnings.push(item.room + "：" + item.repairs.map(p => p.message).join(" "));
        const endpoints = [ ...new Map(manifest.shortcutProtocol.regions.flatMap(r => r.rooms.flatMap(rm => rm.endpoints.map(p => [ JSON.stringify([ rm.sourceRegion || r.region, rm.room, p.port ]), p ])))).values() ], generated = endpoints.filter(p => !p.reused).length, reused = endpoints.length - generated;
        files["shortcut-connections.json"] = JSON.stringify(manifest.shortcutProtocol, null, 2);
        files["design-manifest.json"] = JSON.stringify(manifest, null, 2);
        files["README.txt"] = "RainocTool · Rained 导出\n在 Rained 中打开 rooms/*.txt。这些是可编辑房间工程，仍需渲染并接入游戏区域。\n\n通道转换协议 rainoc-rained-shortcuts / 2\n已生成 " + generated + " 个实际通道入口，保留并关联 " + reused + " 个现有入口。已配对的同房间井生成两端入口及连续路径；跨房间井生成入口、路径和房间出口节点。未配对或不安全的连接保持原样，详见下方诊断。原项目和原绘制内容不变。\n入口位置采用房间内坐标向下取整，保留明确朝向；自动朝向在原位置选择可用方向。旧标记位于边界时，该轴的入口格为 2 或尺寸减 3，为一格路径和一个出口节点留出空间；原标记不移动，映射列入清单。入口按 Rained 的完整 3×3 凹口规则生成：四个角和三面邻格为实体墙，朝室内留一格空气；两格外保留通行空间。路径保留原有地形与非捷径特征，可穿过空气，背景深度不变。\nshortcut-connections.json 将实际入口、路径、出口序号与原始标记和连线 ID 对应。node、entrance 和 path 保留工程坐标；gameNode、gameEntrance 使用去除 extraTiles 后的游戏坐标，renderedBounds 记录裁边与编译尺寸。安装器按游戏坐标核对出口。world-connections/*/world_*.txt 按出口节点从上到下、从左到右的顺序提供 ROOMS 接线段；普通房间的 DISCONNECTED 通常表示目标未确认；共享业力门在每个区域 world 文件中将另一侧出口登记为 DISCONNECTED，这是正常的跨区登记。此目录是交接材料，请合并到区域工程，仍需检查渲染、房间设置、生物配置、业力门及游戏内通行。\n已有 Rained 房间的原始捷径不被覆盖；可在不冲突的基础地形上新增入口，原贴块、效果和物件数据保留，贴块覆盖冲突会列出坐标。original-room-backups（若存在）保存旋转前完整原始工程，可用 Rained 直接打开恢复原装饰。\n\n实心墙按所在绘制层与几何深度导出；Geometry 前景可作为碰撞和地板。淡色和更淡色背景分别导出到第二、第三深度，不产生前景碰撞。水体草稿和游戏标记保留在设计清单，需要配置房间水深和 Dev Tools 放置。显示、锁定和透明度不改变导出地形。\n\n导出诊断：\n" + (warnings.length ? warnings.join("\n") : "没有检测到转换问题。") + (manifest.shelterRepairs.length ? "\n\n导出副本已自动补齐庇护所；原始草稿未修改：\n" + manifest.shelterRepairs.map(o => o.room + "：" + o.repairs.map(p => p.message).join(" ")).join("\n") : "");
        return selectRainedExportRooms({
            files: files,
            count: count,
            repairs: manifest.shelterRepairs,
            connectionWarnings: manifest.connectionWarnings,
            roomWarnings: manifest.roomWarnings,
            shortcutProtocol: manifest.shortcutProtocol,
            sharedGates: preparedExport.shared,
            _rainedExportState: {
                sceneId: scene.id,
                regionScope: scene.regions.slice(),
                baseline: sanitizeRainedBaseline(options.baseline ?? w.exportSettings?.rainedBaseline),
                rooms: roomCandidates,
                files: files
            }
        }, options);
    }
    function exportDependencies(w, scene) {
        const deps = new Set(w.exportSettings?.dependencies || []);
        if (w.regions.some(r => scene.regions.includes(r.id) && r.cameraMode === "sbc")) deps.add("SBCameraScroll");
        if (w.gates.some(g => g.scenes.includes(scene.id) && [ g.a, g.b ].some(s => String(s.karma) === "locked" || Number(s.karma) > 5))) deps.add("RegionKit ExtendedGates");
        return [ ...deps ];
    }
    function check(w, scene, {shortcutPlans: shortcutPlans} = {}) {
        const out = [], muted = w.settings?.roomWarningMode === "off";
        for (const id of scene.regions) {
            const r = w.regions.find(x => x.id === id);
            if (!r) continue;
            for (const problem of roomWarnings(r, {
                shortcutPlan: shortcutPlans?.get(r.id)
            })) {
                const ids = problem.rooms || [ problem.room ];
                if (problem.code.startsWith("SHORTCUT_") || ids.some(id => roomWarningEnabled(w.settings, r.rooms.find(rm => rm.id === id), "export"))) out.push(problem.message);
            }
            if (muted) continue;
            if (!r.rooms.length) out.push(r.name + "：尚未切分房间。");
            if (r.shapes.some(s => s.material === "water")) out.push(r.name + "：水体草稿保留在项目；每个房间需单独填写导出水深。");
            if (r.markers.length) out.push(r.name + "：标记导出为清单，游戏放置需 Dev Tools / 对应模组。");
            for (const room of r.rooms) {
                if (!roomWarningEnabled(w.settings, room, "export")) continue;
                if (room.rainedSource && (room.rainedSize?.w !== room.w || room.rainedSize?.h !== room.h)) out.push(room.name + "：导入后尺寸已改变，本次仅导出基础几何；原 Rained 材质、物件和效果需重新整理。");
                if (room.w < 70 || room.h < 40) out.push(room.name + "：尺寸小于 70×40 渲染框，需在 Rained 检查镜头覆盖。");
            }
        }
        if (!muted && w.gates.some(g => g.scenes.includes(scene.id) && [ g.a, g.b ].some(s => String(s.karma) === "locked" || Number(s.karma) > 5))) out.push("业力 6–10 或永久锁定门需要 RegionKit ExtendedGates；需确认游戏端支持。");
        return out;
    }
    function validate(v) {
        if (!v || v.format !== "rw-oc-region" || v.version !== 1 || !Array.isArray(v.scenes) || !Array.isArray(v.regions) || !Array.isArray(v.gates) || !v.scenes.length) throw Error("这不是受支持的区域项目备份。");
        if (v.regions.length > 500 || v.scenes.length > 100) throw Error("项目规模超出支持上限。");
        const validId = x => typeof x === "string" && /^[a-z0-9_-]{1,160}$/i.test(x) && ![ "__proto__", "constructor", "prototype" ].includes(x), finite = x => typeof x === "number" && Number.isFinite(x), range = (x, a, b) => finite(x) && x >= a && x <= b, ids = new Set, scenes = new Set(v.scenes.map(s => s.id)), safe = clone(v);
        normalizeLegacyMaterials(safe);
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
                if (o.shelterOffsetVersion !== 2) {
                    if ([ "up", "down" ].includes(o.shelterFacing) && Number.isInteger(o.shelterOffset)) o.shelterOffset = o.w - 1 - o.shelterOffset;
                    o.shelterOffsetVersion = 2;
                }
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
            const storageIds = new Set(safe.regions.filter(r => r.gateStorageOnly).map(r => r.id));
            s.regions = s.regions.filter(id => !storageIds.has(id));
            for (const id of storageIds) delete s.placements[id];
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
        const gateIds = new Set;
        for (const g of safe.gates) {
            if (!validId(g.id) || gateIds.has(g.id) || !Array.isArray(g.scenes) || g.scenes.some(id => !scenes.has(id)) || [ g.a, g.b ].some(side => !side || side.region && (!ids.has(side.region) || safe.regions.some(r => r.id === side.region && r.gateStorageOnly)) || ![ "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "locked" ].includes(String(side.karma)))) throw Error("业力门连接无效。");
            gateIds.add(g.id);
            if (g.sharedRoom && (!validId(g.sharedRoom.region) || !validId(g.sharedRoom.room) || !ids.has(g.sharedRoom.region))) throw Error("共享业力门房间引用无效。");
            if (g.connections !== undefined && (!Array.isArray(g.connections) || g.connections.length > 2e4 || g.connections.some(l => !l || !validId(l.id) || [ l.a, l.b ].some(e => !e || !validId(e.region) || !validId(e.port))))) throw Error("共享业力门通道连接无效。");
            for (const key of [ "a", "b" ]) if (g[key].ports !== undefined && (!Array.isArray(g[key].ports) || g[key].ports.length > 2e4 || g[key].ports.some(id => !validId(id)))) throw Error("共享业力门端点无效。");
            for (const key of [ "legacyRooms", "sourceHistory", "legacySharedSources" ]) if (g[key] !== undefined && (!Array.isArray(g[key]) || g[key].length > 1e3 || g[key].some(s => !s || !s.room || !validId(s.region) || !validId(s.room.id) || [ "shapes", "markers", "ports", "refs", "links" ].some(k => !Array.isArray(s[k]))))) throw Error("共享业力门旧来源备份无效。");
        }
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
                if (rm.shelterIcon !== undefined && !Object.hasOwn(shelterIcons, rm.shelterIcon)) delete rm.shelterIcon;
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
            dependencies: [ ...new Set(deps) ],
            rainedBaseline: sanitizeRainedBaseline(safe.exportSettings?.rainedBaseline)
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
        normalizeSharedGates(safe);
        normalizeLegacyPorts(safe);
        return safe;
    }
    function categoryName(k) {
        return {
            rooms: "房间",
            draft: "实心墙",
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
        if (category === "draft") category = "geometry";
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
        delete rm.sharedGateId;
        delete rm.detachedGateBackup;
        r.rooms.push(rm);
        for (const k of kinds) for (const o of items[k]) ids.set(o.id, uid());
        for (const k of kinds) for (const o of items[k]) {
            const next = {
                ...clone(o),
                id: ids.get(o.id),
                roomId: rm.id,
                layer: lid
            };
            delete next.sharedGateId;
            delete next.sharedGateRoom;
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
        for (const gate of [ ...w.gates ]) if (gate.sharedVersion !== 2 && [ "a", "b" ].some(s => gate[s].region === r.id && markers.has(gate[s].marker))) {
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
                locked: false,
                fullDisplay: r.specialDisplay?.gate?.fullDisplay === true,
                opacity: opacity(r.specialDisplay?.gate)
            };
            r.layers.push(layer);
        }
        return layer;
    }
    function gateIcon(w, sid, marker) {
        if (w.settings?.gateKarmaIcons !== true) return "gate";
        const g = w.gates.find(g => g.scenes.includes(sid) && ([ g.a, g.b ].some(s => s.marker === marker.id) || g.ownerMarker === marker.id || marker.sharedGateId === g.id)), side = g && ([ g.a, g.b ].find(s => s.marker === marker.id) || (g.a.region ? g.a : g.b.region ? g.b : g.a));
        return side ? side.karma === "locked" ? "gate-locked" : "karma-" + side.karma : "gate";
    }
    function ensureGateRoom(r, m, to = "") {
        if (m.sharedGateRoom && m.sharedGateRoom.region !== r.id) return null;
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
            if (m.sharedGateRoom && m.sharedGateRoom.region !== r.id) continue;
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
                locked: false,
                fullDisplay: r.specialDisplay?.shelter?.fullDisplay === true,
                opacity: opacity(r.specialDisplay?.shelter)
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
        if (rm.sharedGateId && type !== "GATE") removeSharedGate(w, rm.sharedGateId, {
            deleteRoom: false,
            unregister: true
        });
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
        for (const gate of [ ...w.gates ]) if (gate.sharedVersion !== 2 && [ "a", "b" ].some(side => gate[side].region === r.id && markers.has(gate[side].marker))) {
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
        if (rm.sharedGateId) throw Error("共享业力门房间名随两侧区域简称生成，请修改业力门昵称。");
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
    function lockedShapeForStroke(r, stroke) {
        for (const s of r.shapes) {
            if (!s.locked || s.id === stroke.id || s.layer !== stroke.layer || (s.decoration || 0) !== (stroke.decoration || 0) || s.roomId && stroke.roomId && s.roomId !== stroke.roomId) continue;
            if (!stroke.eraseAll && (s.material === "water" !== (stroke.material === "water") || (s.depth || 0) !== (stroke.depth || 0))) continue;
            let area = intersection(bounds(s), bounds(stroke));
            if (!area) continue;
            const owner = s.roomId ? r.rooms.find(rm => rm.id === s.roomId) : stroke.roomId ? r.rooms.find(rm => rm.id === stroke.roomId) : null;
            if (owner) area = intersection(area, shelterEditableBounds(owner) || owner);
            if (!area) continue;
            const occupied = new Set;
            for (const cell of shapeCells(stroke, area, owner)) occupied.add(cell.x + "," + cell.y);
            for (const cell of shapeCells(s, area, owner)) if (occupied.has(cell.x + "," + cell.y)) return s;
        }
        return null;
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
        const lid = options.layer || r.layers[0].id, layer = r.layers.find(l => l.id === lid), mat = normalizeMaterial(options.material) || "solid";
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
            const category = shape.material === "water" ? "water" : "geometry";
            if (!options.decoration && r.categories[category]?.visible === false) continue;
            const b = intersection(bounds(shape), boundsBox);
            if (!b) continue;
            const uncutBounds = shape.slopeMode === "edge" ? bounds({
                ...shape,
                clip: null
            }) : null, paint = (x, y) => {
                const terrain = cellTerrain(shape, x, y, uncutBounds), material = shape.slopeMode === "edge" && terrain === 1 ? "solid" : normalizeMaterial(shape.material);
                pixels[(y - top) * width + x - left] = shape.erase || shape.material === "crawl" ? 0 : codes[material];
            };
            if (shape.material !== "water") {
                for (const {x: x, y: y} of shapeCells(shape, boundsBox)) paint(x, y);
                continue;
            }
            const shapeBounds = bounds(shape);
            for (let y = Math.max(top, Math.floor(b.y)); y < Math.min(top + height, Math.ceil(b.y + b.h)); y++) for (let x = Math.max(left, Math.floor(b.x)); x < Math.min(left + width, Math.ceil(b.x + b.w)); x++) {
                const coverage = samples.filter(([sx, sy]) => hitShape(shape, {
                    x: x + sx,
                    y: y + sy
                }, shapeBounds)).length / samples.length;
                if (coverage >= threshold) paint(x, y);
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
        const additions = [], rectangles = [], slopeCode = {
            slopeRU: 2,
            slopeLU: 3,
            slopeRD: 4,
            slopeLD: 5
        }[mat], fillMaterial = (x, y) => slopeCode && edgeSlopeCode(slopeCode, (dx, dy) => x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && !!mask[(y + dy) * width + x + dx]) === 1 ? "solid" : mat;
        let count = 0, previous = new Map;
        for (let y = 0; y < height; y++) {
            const current = new Map;
            for (let x = 0; x < width; ) {
                if (!mask[y * width + x]) {
                    x++;
                    continue;
                }
                const begin = x, material = fillMaterial(x, y);
                while (x < width && mask[y * width + x] && fillMaterial(x, y) === material) {
                    count++;
                    x++;
                }
                const key = begin + ":" + x + ":" + material;
                let box = previous.get(key);
                if (box) box.h++; else {
                    box = {
                        x: left + begin,
                        y: top + y,
                        w: x - begin,
                        h: 1,
                        material: material
                    };
                    rectangles.push(box);
                }
                current.set(key, box);
            }
            previous = current;
        }
        for (const box of rectangles) {
            const {material: material, ...frame} = box, base = {
                type: "rect",
                ...frame,
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
                material: material
            });
        }
        if (!count) return 0;
        for (const shape of additions) if (lockedShapeForStroke(r, shape)) throw Error("绘制范围内有已锁定的地形，请先解锁再替换。");
        const cats = new Set(additions.map(s => s.material === "water" ? "water" : "geometry"));
        for (const k of [ "geometry", "water" ]) if (!options.decoration && r.categories[k].locked && r.shapes.some(s => !s.decoration && s.layer === lid && (s.material === "water" ? "water" : "geometry") === k && intersection(bounds(s), boundsBox))) throw Error(categoryName(k) + "已锁定，请先解锁再替换。");
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
            const o = r[ref.list].find(o => o.id === ref.id), reason = lockReason(r, o, ref.list === "shapes" ? o.material === "water" ? "water" : "geometry" : ref.list === "markers" ? o.kind : ref.list);
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
            const reason = lockReason(r, o, ref.list === "shapes" ? o.material === "water" ? "water" : "geometry" : ref.list === "markers" ? o.kind : ref.list);
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
            const [geo, flags] = data.geometry[x][y][0], kind = flags.includes(7) ? "den" : flags.includes(21) ? "scavenger" : geo === 7 ? traceRainedShortcut(data.geometry, [ x, y ]).type === "internal" ? "internal" : "exit" : null;
            if (kind && !r.ports.some(p => {
                const at = rainedPortAnchor(rm, p).entrance;
                return p.roomId === id && at[0] === x && at[1] === y && (p.kind === kind || [ "exit", "internal" ].includes(kind) && [ "exit", "internal" ].includes(p.kind));
            })) r.ports.push({
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
        moveSharedGateToStorage: moveSharedGateToStorage,
        assignPendingRoomRegion: assignPendingRoomRegion,
        gateStorageRegion: gateStorageRegion,
        detachSharedGateBindings: detachSharedGateBindings,
        moveGateCompanionToRegion: moveGateCompanionToRegion,
        sanitizeRainedBaseline: sanitizeRainedBaseline,
        rainedExportSignature: rainedExportSignature,
        selectRainedExportRooms: selectRainedExportRooms,
        normalizeSharedGates: normalizeSharedGates,
        sharedGateNormalizationSummary: sharedGateNormalizationSummary,
        resolveSharedGateRoom: resolveSharedGateRoom,
        sharedGateForRoom: sharedGateForRoom,
        sharedGateConnections: sharedGateConnections,
        createSharedGate: createSharedGate,
        connectSharedGatePorts: connectSharedGatePorts,
        removeSharedGateConnection: removeSharedGateConnection,
        removeSharedGate: removeSharedGate,
        chooseSharedGateSource: chooseSharedGateSource,
        lockedShapeForStroke: lockedShapeForStroke,
        normalizeMaterial: normalizeMaterial,
        normalizeLegacyMaterials: normalizeLegacyMaterials,
        materialNormalizationSummary: materialNormalizationSummary,
        shelterIcons: shelterIcons,
        shelterIcon: shelterIcon,
        shelterIconSource: shelterIconSource,
        setShelterIcon: setShelterIcon,
        normalizeLegacyPorts: normalizeLegacyPorts,
        portNormalizationSummary: portNormalizationSummary,
        suggestPortPlacement: suggestPortPlacement,
        applyPortPlacement: applyPortPlacement,
        rainedPortAnchor: rainedPortAnchor,
        rainedPlacementCandidates: rainedPlacementCandidates,
        validateRainedShortcut: validateRainedShortcut,
        slopeVertices: slopeVertices,
        shapeCells: shapeCells,
        cellTerrain: cellTerrain,
        needsNativeGeometryResize: needsNativeGeometryResize,
        prepareRegionShortcuts: prepareRegionShortcuts,
        traceRainedShortcut: traceRainedShortcut,
        portRoomOwner: portRoomOwner,
        transformRooms: transformRooms,
        needsNativeGeometryTransform: needsNativeGeometryTransform,
        shelterMinimumSize: shelterMinimumSize,
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
