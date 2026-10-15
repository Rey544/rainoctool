(function() {
    "use strict";
    const C = window.OCMapCore, $ = id => document.getElementById(id), copy = C.clone;
    let cleanPreview = false, importing = false, bridge, host, canvas, ctx, w, projectKey = "", regionId = null, roomId = null, layerId = null, sceneId = null, selection = null, tool = "select", material = "solid", markerKind = "pearl", portKind = "exit", brush = 3, depth = 0, sidebar = "tools", active = false, world = true, history = [], future = [], saveTimer, saveChain = Promise.resolve(), revision = 0, saved = true, saveError = "", loadSerial = 0, cam = {
        x: 0,
        y: 0,
        z: 2
    }, preview = null, drag = null, connectStart = null, imageCache = new Map, iconCache = new Map, spaceHeld = false, editShared = false, lastTap = {}, touches = new Map, gesture = null, polygon = [], libraryDocs = [], touchSession = null;
    let pendingRoomType = null, pendingRoomPreset = null, pendingGateConnection = null;
    let batchPlacement = null;
    function batchCreateEnabled() {
        return w?.settings?.batchCreate === true;
    }
    function setBatchCreate(value) {
        cancelDrag();
        batchPlacement = null;
        change(() => w.settings.batchCreate = !!value);
        renderTools();
        toast(value ? "批量新建已开启：连续放置；拖动已有对象可调整位置。Esc 结束当前放置。" : "批量新建已关闭。");
    }
    function restoreBatchMove(d) {
        if (!d?.batchRestore) return;
        layerId = d.batchRestore.layerId;
        roomId = d.batchRestore.roomId;
        renderLayerSwitch();
        renderTools();
        renderSide();
    }
    function batchCreationKind() {
        if (!batchCreateEnabled()) return null;
        if (world) return batchPlacement?.kind === "region" && batchPlacement.sceneId === sceneId ? "region" : null;
        if (batchPlacement?.kind === "reference" && batchPlacement.regionId === regionId) return "reference";
        if (tool === "split" && cutIntent === "create") return "room";
        if (tool === "marker" && markerKind !== "shelter") return "marker";
        if (tool === "port") return "port";
        return null;
    }
    function batchPointerDown(wp, p, e) {
        const kind = batchCreationKind();
        if (!kind) return false;
        if (kind === "region") {
            const id = worldRegionAt(wp) || hitRegionLabel(wp)?.id;
            if (id) {
                selection = {
                    list: "world",
                    id: id
                };
                if (!worldMovementEnabled()) {
                    toast("区域位置已锁定，请先解锁移动区域。");
                    return true;
                }
                drag = {
                    mode: "world",
                    id: id,
                    p: wp,
                    before: copy(w),
                    batchMove: true
                };
            } else drag = {
                mode: "batch-place",
                kind: kind,
                p: wp
            };
            draw();
            return true;
        }
        if (kind === "room" && cutMethod === "frame" && cutFrame && C.hitRoomHandle(cutFrame, wp, (e.pointerType === "touch" ? 18 : 8) / cam.z)) return false;
        let chosen = hit(wp, kind === "port");
        if (kind === "room") {
            if (chosen?.list === "markers") {
                const m = reg().markers.find(o => o.id === chosen.id);
                chosen = C.isRoomMarker(m) && m.roomId ? {
                    list: "rooms",
                    id: m.roomId
                } : null;
            }
            if (chosen?.list !== "rooms") {
                const rm = editRooms().find(o => C.inside(wp, o));
                chosen = rm ? {
                    list: "rooms",
                    id: rm.id
                } : null;
            }
        } else if (kind === "reference" && chosen?.list !== "refs") chosen = null; else if (kind === "marker" && ![ "markers", "ports", "refs" ].includes(chosen?.list)) chosen = null; else if (kind === "port" && chosen?.list !== "ports") chosen = null;
        if (chosen) {
            const o = reg()[chosen.list].find(o => o.id === chosen.id), category = chosen.list === "markers" ? o.kind : chosen.list, reason = C.lockReason(reg(), o, category, o.layer);
            selection = chosen;
            if (reason) {
                toast(reason + "；请先解锁。");
                renderSide();
                draw();
                return true;
            }
            const resume = {
                layerId: layerId,
                roomId: roomId
            };
            layerId = o.layer || layerId;
            drag = {
                mode: "move",
                p: wp,
                before: copy(w),
                selection: copy(selection),
                allowed: false,
                batchMove: true,
                batchRestore: resume
            };
            renderSide();
            draw();
            return true;
        }
        if (!C.inside(wp, {
            x: 0,
            y: 0,
            w: reg().w,
            h: reg().h
        })) return true;
        selection = null;
        requireEdit(() => {
            if (downPointer !== e.pointerId || touches.size > 1) return;
            if (kind === "port") {
                updatePortPlacement(wp);
                drag = {
                    mode: "port-place",
                    p: wp
                };
            } else {
                drag = {
                    mode: "batch-place",
                    kind: kind,
                    p: wp,
                    frameBefore: cutFrame ? copy(cutFrame) : null
                };
                if (kind === "room") placeCutFrame(wp);
            }
            draw();
        });
        return true;
    }
    function finishBatchPlacement(d, p) {
        if (d.moved) return;
        if (d.kind === "region") {
            const config = batchPlacement;
            if (!config || config.sceneId !== sceneId) return;
            change(() => {
                let n = 1, name = config.name, english = config.english, code = config.code;
                while (w.regions.some(r => r.name === name || r.english === english || r.code === code)) {
                    n++;
                    name = config.name + " " + n;
                    english = config.english + " " + n;
                    code = config.code + n;
                }
                const r = C.region(name, english, config.w, config.h);
                Object.assign(r, {
                    code: code,
                    codeAuto: false
                });
                w.regions.push(r);
                scene().regions.push(r.id);
                scene().placements[r.id] = {
                    x: Math.round(p.x - config.w / 2),
                    y: Math.round(p.y - config.h / 2)
                };
                selection = {
                    list: "world",
                    id: r.id
                };
            });
            return;
        }
        if (d.kind === "room") {
            placeCutFrame(p);
            confirmCutFrame();
            return;
        }
        if (d.kind === "marker") {
            placeNewMarker(bounded(p));
            return;
        }
        if (d.kind === "reference") {
            const config = batchPlacement;
            if (!config || config.regionId !== regionId) return;
            change(() => {
                const r = reg(), owner = room() || roomAt(p), reason = C.lockReason(r, owner, "refs", layerId);
                if (reason) throw Error(reason + "；请先解锁。");
                const limits = owner || {
                    x: 0,
                    y: 0,
                    w: r.w,
                    h: r.h
                }, scale = Math.min(1, limits.w / config.w, limits.h / config.h), ww = config.w * scale, hh = config.h * scale, ref = {
                    ...copy(config.ref),
                    id: C.uid(),
                    x: Math.max(limits.x, Math.min(limits.x + limits.w - ww, Math.round(p.x - ww / 2))),
                    y: Math.max(limits.y, Math.min(limits.y + limits.h - hh, Math.round(p.y - hh / 2))),
                    w: ww,
                    h: hh,
                    roomId: owner?.id || null,
                    layer: layerId
                };
                r.refs.push(ref);
                selection = {
                    list: "refs",
                    id: ref.id
                };
            });
        }
    }
    function placeNewMarker(at) {
        const r = reg(), kind = markerKind;
        if (r.categories[kind].locked) {
            toast(C.categoryName(kind) + "已锁定；可点右下角“全部解锁”。");
            return;
        }
        let created;
        const ok = change(() => {
            const rm = roomAt(at);
            if (rm?.locked) throw Error("房间“" + rm.name + "”已锁定。");
            created = {
                id: C.uid(),
                x: at.x,
                y: at.y,
                kind: kind,
                name: C.categories[kind],
                layer: layerId,
                roomId: rm?.id || null,
                color: "#cccccc",
                sceneIds: [],
                ...copy(pendingMarker)
            };
            r.categories[kind].visible = true;
            if (kind === "creature") {
                created.creatureType ||= "Lizard";
                created.name = creatureTypes[created.creatureType] || "生物刷新";
            }
            r.markers.push(created);
            selection = {
                list: "markers",
                id: created.id
            };
        });
        if (ok) {
            if (!batchCreateEnabled()) {
                tool = "select";
                pendingMarker = {};
            }
            sidebar = "tools";
            renderTools();
            renderSide();
            draw();
            ensureMarkerRecord(created);
        }
    }
    let shelterSafetyCache = new WeakMap, shelterRequest = 0;
    const dismissedRoomWarnings = new Set, notifiedRoomWarnings = new Set;
    function warningKey(r, rm) {
        return r.id + ":" + rm.id;
    }
    function shelterSafety(r, rm) {
        if (!rm) return [];
        let cached = shelterSafetyCache.get(r);
        if (!cached || cached.sceneId !== sceneId) {
            cached = {
                sceneId: sceneId,
                issues: C.roomWarnings(r, {
                    phase: "edit",
                    workspace: w,
                    sceneId: sceneId
                })
            };
            shelterSafetyCache.set(r, cached);
        }
        return cached.issues.filter(p => p.room === rm.id || p.rooms?.includes(rm.id));
    }
    function warningEnabled(r, rm, phase = "edit") {
        return rm && C.roomWarningEnabled(w.settings, rm, phase) && !dismissedRoomWarnings.has(warningKey(r, rm));
    }
    function warningNote(message) {
        const n = note(message);
        n.classList.add("map-warning-text");
        return n;
    }
    function muteRoomWarning(r, rm, permanent) {
        if (permanent) change(() => rm.warningsDisabled = true); else dismissedRoomWarnings.add(warningKey(r, rm));
        renderSide();
        updateWarningControl();
        draw();
    }
    function shelterProblemDialog(r, rm) {
        return dialog("房间检查 · " + rm.name, (b, a, close) => {
            for (const p of shelterSafety(r, rm)) b.append(warningNote(p.message));
            b.append(note("关闭警告不改变地形。庇护所的门机构和封闭墙体始终受保护；无法安全修复的文件仍会阻止导出。"));
            a.append(button("本次关闭此房间警告", () => {
                muteRoomWarning(r, rm, false);
                close();
            }), button("此房间永久不再警告", () => {
                muteRoomWarning(r, rm, true);
                close();
            }), button("继续编辑", close, "primary"));
        });
    }
    function shelterWarning(r, rm) {
        if (!warningEnabled(r, rm)) return null;
        const issues = shelterSafety(r, rm);
        if (!issues.length) return null;
        const box = el("div", "map-shelter-warning");
        box.setAttribute("role", "status");
        box.append(el("strong", "", "房间检查 · " + issues.length + " 项"), ...issues.map(p => warningNote(p.message)), button("查看问题 / 关闭警告", () => shelterProblemDialog(r, rm)));
        return box;
    }
    function notifyShelterProblem() {
        updateWarningControl();
    }
    function warningControls(b) {
        b.append(select("显示警告", w.settings.roomWarningMode || "always", {
            always: "编辑时及导出时",
            export: "仅导出 Rained 时",
            off: "关闭警告"
        }, v => {
            change(() => w.settings.roomWarningMode = v);
            renderSide();
            updateWarningControl();
            draw();
        })[0], note("编辑时检查庇护所、底部、通道井标记及房间连接；导出 Rained 时另行检查实际捷径结构。关闭提示不会取消庇护所结构保护。"), button("恢复所有房间的警告", () => {
            dismissedRoomWarnings.clear();
            notifiedRoomWarnings.clear();
            change(() => {
                for (const r of w.regions) for (const rm of r.rooms) delete rm.warningsDisabled;
            });
            renderSide();
            updateWarningControl();
            draw();
            toast("已恢复所有房间警告。");
        }));
    }
    function warningDialog() {
        dialog("房间警告", (b, a, close) => {
            warningControls(b);
            const list = el("div", "map-warning-list");
            b.append(list);
            const show = () => {
                list.replaceChildren();
                for (const r of world ? w.regions.filter(r => scene().regions.includes(r.id)) : [ reg() ].filter(Boolean)) for (const rm of r.rooms) {
                    if (!warningEnabled(r, rm)) continue;
                    const issues = shelterSafety(r, rm);
                    if (!issues.length) continue;
                    const group = el("div", "map-shelter-warning");
                    group.append(button(rm.name, () => {
                        close();
                        if (reg()?.id !== r.id || world) openRegion(r.id);
                        focusRoom(rm);
                    }), ...issues.map(p => warningNote(p.message)), button("此房间警告设置", () => shelterProblemDialog(r, rm).addEventListener("close", show)));
                    list.append(group);
                }
                if (!list.children.length) list.append(note(w.settings.roomWarningMode === "off" ? "警告已关闭，可在上方重新开启。" : w.settings.roomWarningMode === "export" ? "仅在导出 Rained 时检查并显示警告。" : "当前没有待处理的房间警告。"));
            };
            b.querySelector("select").addEventListener("change", show);
            b.querySelectorAll("button")[0].addEventListener("click", show);
            show();
            a.append(button("完成", close, "primary"));
        });
    }
    function updateWarningControl() {
        const button = $("mapWarnings");
        if (!button || !w) return;
        button.hidden = cleanPreview;
        $("mapWarningCorner").hidden = cleanPreview;
        const mode = w.settings.roomWarningMode || "always", regions = world ? w.regions.filter(r => scene()?.regions.includes(r.id)) : [ reg() ].filter(Boolean);
        let count = 0;
        if (mode === "always") for (const r of regions) for (const rm of r.rooms) if (warningEnabled(r, rm) && shelterSafety(r, rm).length) count++;
        button.textContent = "房间警告" + (mode === "off" ? " · 关闭" : mode === "export" ? " · 仅导出" : count ? " · " + count : " · 无");
        button.classList.toggle("has-warnings", count > 0);
        button.title = "房间警告设置与问题列表";
        button.onclick = warningDialog;
    }
    function drawRoomWarnings(r, line, point) {
        for (const rm of r.rooms) {
            if (!warningEnabled(r, rm) || !C.roomVisible(r, rm) || r.layers.find(l => l.id === rm.layer)?.visible === false || !contentShown(r, rm)) continue;
            const issues = shelterSafety(r, rm);
            if (!issues.length) continue;
            const p = point(rm);
            line("rect", {
                x: p.x,
                y: p.y,
                width: rm.w * cam.z,
                height: rm.h * cam.z,
                fill: "none",
                stroke: w.settings.invert ? "#00acac" : "#ff5353",
                "stroke-width": 2,
                "pointer-events": "none"
            }, "map-room-warning");
            if (issues.some(p => p.code === "ROOM_OPEN_BOTTOM")) line("line", {
                x1: p.x,
                y1: p.y + rm.h * cam.z,
                x2: p.x + rm.w * cam.z,
                y2: p.y + rm.h * cam.z,
                stroke: w.settings.invert ? "#00acac" : "#ff5353",
                "stroke-width": 4,
                "pointer-events": "none"
            }, "map-room-warning map-bottom-warning");
        }
    }
    let downPointer = null, snapGuides = [];
    let regionTitleModal = null, roomPaintLayer = 0, labelLayoutCache = null;
    let dockCollapsed = false, previewCollapsed = false, selectedGateId = null, multiSelection = [], selectionBox = null, marqueeTarget = "contents", contentSelectionScope = "visible", selectionMessage = "", selectionMoveArmed = false;
    let fillOptions = {
        sampleAll: false,
        tolerance: 0,
        expansion: 0,
        antialias: true
    }, strokeOwner = null;
    const markerRecordPending = new Map;
    const presentationCache = new Map, presentationSources = new WeakMap;
    let exportingImage = false;
    const foldStates = new Map, projectDrafts = new Map;
    let dirtyReminderShown = false, lastPointerType = "mouse", lastObjectTap = null, worldMoveUnlocked = null, hoverRegionId = null;
    function foldKey(title) {
        return [ projectKey, sceneId, world ? "world" : regionId, sidebar, title ].join(":");
    }
    let toolsCollapsed = false, cutFrame = null, cutMethod = "frame", cutIntent = "partition", splitVertical = true, playerScale = false, cursorPoint = null;
    let brushExpanded = false, lastDrawTool = "brush", pendingMarker = {}, hoverRoomId = null, hoverRegionTitleId = null;
    const el = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    };
    function button(text, fn, cls = "") {
        const e = el("button", cls, text);
        e.type = "button";
        e.onclick = fn;
        return e;
    }
    function input(label, value, type = "text", onchange) {
        const box = el("label", "", label), e = el("input");
        e.type = type;
        e.value = value ?? "";
        box.append(e);
        if (onchange) e.onchange = () => onchange(type === "number" ? Number(e.value) : e.value);
        return [ box, e ];
    }
    function select(label, value, values, onchange) {
        const box = el("label", "", label), e = el("select");
        for (const [v, t] of Object.entries(values)) e.add(new Option(t, v));
        e.value = value ?? "";
        box.append(e);
        if (onchange) e.onchange = () => onchange(e.value);
        return [ box, e ];
    }
    function check(label, value, fn) {
        const box = el("label", "map-check"), e = el("input");
        e.type = "checkbox";
        e.checked = value;
        e.onchange = () => fn(e.checked);
        box.append(e, document.createTextNode(label));
        return box;
    }
    function row(...items) {
        const e = el("div", "map-row");
        e.append(...items.filter(Boolean));
        return e;
    }
    function note(text) {
        return el("p", "", text);
    }
    function toast(text, warning = false) {
        $("mapToast").classList.toggle("map-warning-text", warning);
        $("mapToast").textContent = text;
        $("mapToast").hidden = false;
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => $("mapToast").hidden = true, 4400);
    }
    function dialog(title, build) {
        const parent = [ ...document.querySelectorAll("dialog[open]") ].at(-1);
        if (parent) parent.style.visibility = "hidden";
        const d = el("dialog", "map-dialog"), h = el("h2", "", title), body = el("div", "map-dialog-body"), err = el("p", "map-error"), actions = el("div", "map-actions");
        const close = () => {
            d.close();
            d.remove();
        };
        const x = button("×", close, "map-dialog-close");
        x.setAttribute("aria-label", "关闭");
        d.append(h, x, body, err, actions);
        document.body.append(d);
        d.addEventListener("close", () => {
            d.remove();
            if (parent?.isConnected) parent.style.visibility = "";
        });
        build(body, actions, close, e => err.textContent = e.message || e);
        d.showModal();
        return d;
    }
    function scene() {
        return w?.scenes.find(s => s.id === sceneId) || w?.scenes[0];
    }
    function reg() {
        return w?.regions.find(r => r.id === regionId);
    }
    function room() {
        return reg()?.rooms.find(r => r.id === roomId);
    }
    function layer() {
        return reg()?.layers.find(l => l.id === layerId);
    }
    function selected() {
        const r = reg();
        if (!selection || !r) return null;
        return r[selection.list]?.find(o => o.id === selection.id);
    }
    function req(request) {
        return new Promise((ok, no) => {
            request.onsuccess = () => ok(request.result);
            request.onerror = () => no(request.error);
        });
    }
    async function read(key) {
        return OCStandalone.transaction("readonly", async (a, b, s) => await req(s.get("region:" + key)) || null);
    }
    function scheduleSave() {
        shelterSafetyCache = new WeakMap;
        saved = false;
        updateStatus();
        clearTimeout(saveTimer);
        if (!dirtyReminderShown) saveTimer = setTimeout(() => {
            if (!saved) {
                dirtyReminderShown = true;
                toast("有未保存的修改，请点保存；换设备前请导出备份。");
            }
        }, 12e3);
    }
    function rememberDraft() {
        if (w && projectKey && !saved) projectDrafts.set(projectKey, {
            value: copy(w),
            revision: revision
        });
    }
    function projectMenu() {
        if (saved) return bridge.projectMenu();
        dialog("地图未保存", (b, a, close, err) => {
            b.append(note("切换项目前请保存。需要在其他设备打开时，请导出 RainOC 项目备份。"));
            a.append(button("取消", close), button("导出备份", () => {
                close();
                exportDialog();
            }), button("保存并切换", async () => {
                if (await manualSave()) {
                    close();
                    bridge.projectMenu();
                } else err("保存未完成，请导出备份。");
            }, "primary"));
        });
    }
    function flush() {
        clearTimeout(saveTimer);
        if (!w || !projectKey || saved) return saveChain;
        const key = projectKey, data = copy(w);
        saveChain = saveChain.catch(() => {}).then(async () => {
            try {
                const next = await OCStandalone.transaction("readwrite", async (a, b, s) => {
                    const old = await req(s.get("region:" + key));
                    if (key === projectKey && (old?.revision || 0) !== revision) throw Error("另一窗口已修改区域。请先导出备份，再重新打开。");
                    const next = (old?.revision || 0) + 1;
                    await req(s.put({
                        id: "region:" + key,
                        value: data,
                        revision: next,
                        updated: (new Date).toISOString()
                    }));
                    return next;
                });
                if (key === projectKey) {
                    revision = next;
                    saveError = "";
                    saved = JSON.stringify(w) === JSON.stringify(data);
                    if (saved) {
                        dirtyReminderShown = false;
                        projectDrafts.delete(key);
                    }
                }
            } catch (e) {
                if (key === projectKey) {
                    saveError = e.message;
                    saved = false;
                }
                toast("保存未完成：" + e.message);
            }
            updateStatus();
        });
        return saveChain;
    }
    async function loadProject() {
        if (!bridge || !active) return;
        const p = bridge.getProject();
        if (!p) return;
        libraryDocs = p.documents || [];
        const key = p.uid || p.id;
        $("mapProject").textContent = p.name;
        if (key === projectKey) {
            synchronizeRecords();
            iconCache.clear();
            renderSide();
            draw();
            return;
        }
        const token = ++loadSerial;
        rememberDraft();
        const pending = projectDrafts.get(key), data = pending || await read(key);
        if (token !== loadSerial) return;
        projectKey = key;
        connectStart = null;
        batchPlacement = null;
        dismissedRoomWarnings.clear();
        notifiedRoomWarnings.clear();
        shelterSafetyCache = new WeakMap;
        portPlacementCache = null;
        revision = data?.revision || 0;
        w = data?.value ? C.validate(data.value) : C.workspace();
        const normalized = C.portNormalizationSummary(w);
        favoriteBrushIndex = favoriteMaterialIndex = 0;
        const first = C.brushFavorites(w.settings.favorites);
        brush = first.brushes[0].width;
        lastDrawTool = first.brushes[0].tool;
        material = first.materials[0];
        pendingGateConnection = null;
        sceneId = w.activeScene;
        regionId = null;
        roomId = null;
        world = true;
        history = [];
        future = [];
        selection = null;
        saveError = "";
        saved = !pending;
        dirtyReminderShown = false;
        if (normalized?.changed || C.materialNormalizationSummary(w)?.changed || C.sharedGateNormalizationSummary?.(w)?.changed) scheduleSave();
        synchronizeRecords();
        refresh();
        fit();
        loadMapFont();
        if (pending) toast("此项目有未保存的修改，请保存或导出备份。");
    }
    function reconcile() {
        if (connectStart && !sharedGateConnectionPose(connectStart)) connectStart = null;
        if (!w.scenes.some(s => s.id === sceneId)) sceneId = w.scenes[0].id;
        if (regionId && !scene().regions.includes(regionId) && !reg()?.gateStorageOnly) {
            regionId = null;
            world = true;
        }
        if (reg() && !reg().layers.some(l => l.id === layerId)) layerId = reg().layers[0].id;
        if (roomId && !reg()?.rooms.some(r => r.id === roomId)) roomId = null;
        if (selection && !selected()) selection = null;
        multiSelection = reg() ? multiSelection.filter(ref => reg()[ref.list]?.some(o => o.id === ref.id)) : [];
    }
    function change(fn) {
        const before = copy(w);
        try {
            fn();
            if (JSON.stringify(w) === JSON.stringify(before)) return false;
            portPlacementCache = null;
            preserveRegionView(before);
            history.push(before);
            while (history.length > 1 && (history.length > 45 || history.reduce((a, v) => a + JSON.stringify(v).length, 0) > 24e6)) history.shift();
            future = [];
            reconcile();
            scheduleSave();
            refresh();
            notifyShelterProblem();
            return true;
        } catch (e) {
            w = before;
            portPlacementCache = null;
            reconcile();
            toast(e.message);
            refresh();
            return false;
        }
    }
    function undo() {
        if (!history.length) return;
        portPlacementCache = null;
        future.push(copy(w));
        w = history.pop();
        preserveRegionView(future.at(-1));
        reconcile();
        scheduleSave();
        refresh();
    }
    function redo() {
        if (!future.length) return;
        portPlacementCache = null;
        history.push(copy(w));
        w = future.pop();
        preserveRegionView(history.at(-1));
        reconcile();
        scheduleSave();
        refresh();
    }
    function requireEdit(fn, {regionScope: regionScope = false, region: editingRegion = reg(), object: editingObject, category: editingCategory} = {}) {
        if (!editingRegion) {
            toast("先进入一个区域。");
            return;
        }
        const category = editingCategory ?? (selected() ? selection.list === "shapes" ? cat(selected()) : selection.list === "markers" ? selected().kind : selection.list : null), object = editingObject === undefined ? selected() || room() : editingObject;
        const reason = C.lockReason(editingRegion, object, category, object?.layer || (editingRegion.id === regionId ? layerId : null));
        if (!regionScope && reason) {
            toast(reason + "；可点右下角“全部解锁”。");
            return;
        }
        const count = w.scenes.filter(s => s.regions.includes(editingRegion.id)).length;
        if (count > 1 && !editShared) {
            dialog("这是共用区域", (b, a, close) => {
                b.append(note("此区域用于 " + count + " 张地图。请选择本次编辑的作用范围。"), button("修改共用区域", () => {
                    editShared = true;
                    close();
                    fn();
                }, "map-choice"), button("为当前地图创建独立副本", () => {
                    close();
                    change(() => {
                        const r = C.forkRegion(w, scene(), editingRegion.id);
                        regionId = r.id;
                        roomId = null;
                        layerId = r.layers[0].id;
                        selection = null;
                        connectStart = null;
                    });
                    editShared = true;
                    document.querySelectorAll("dialog.map-dialog").forEach(d => d.close());
                    toast("已创建独立副本，请继续编辑。");
                }, "map-choice"));
            });
        } else fn();
    }
    function dropdown(anchor, items) {
        closeDropdown();
        const box = el("div", "map-dropdown");
        box.setAttribute("role", "menu");
        document.body.append(box);
        const close = () => {
            box.remove();
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("keydown", keys, true);
        };
        const outside = e => {
            if (!box.contains(e.target) && !anchor?.contains(e.target)) close();
        };
        const keys = e => {
            if (e.key === "Escape") close();
        };
        box.close = close;
        for (const item of items) {
            const [label, fn, graphic] = item, btn = button("", () => {
                close();
                fn();
            });
            btn.setAttribute("role", "menuitem");
            if (graphic) btn.append(typeof graphic === "string" ? icon(graphic, "#cccccc") : graphic);
            btn.append(document.createTextNode(label));
            box.append(btn);
        }
        const scale = window.OCUIPreferences?.pageScale || 1, viewport = window.OCUIPreferences?.viewport?.() || {
            width: innerWidth,
            height: innerHeight,
            left: 0,
            top: 0
        }, ww = viewport.width / scale, hh = viewport.height / scale, raw = anchor?.getBoundingClientRect() || {
            left: innerWidth - 220,
            right: innerWidth - 10,
            top: 60,
            bottom: 60
        }, a = Object.fromEntries([ "left", "right", "top", "bottom" ].map(k => [ k, raw[k] / scale ]));
        const h = Math.min(box.scrollHeight, hh * .65, 440);
        box.style.left = Math.max(8, Math.min(a.left, ww - box.offsetWidth - 8)) + "px";
        box.style.top = (a.bottom + h + 8 < hh ? a.bottom + 4 : Math.max(8, a.top - h - 4)) + "px";
        queueMicrotask(() => {
            document.addEventListener("pointerdown", outside, true);
            document.addEventListener("keydown", keys, true);
        });
        box.querySelector("button")?.focus();
        return box;
    }
    function closeDropdown() {
        document.querySelectorAll(".map-dropdown").forEach(n => n.close?.());
    }
    function currentAnchor() {
        return $("mapCreate") || $("mapMenu");
    }
    const brushSizeMax = 100;
    function updateBrushSize(value) {
        const next = Math.round(Number(value));
        if (!Number.isFinite(next)) return;
        brush = Math.max(1, Math.min(brushSizeMax, next));
        const rail = $("mapStage").querySelector(".map-brush-size");
        if (rail) {
            rail.querySelector("input").value = String(brush);
            rail.querySelector("output").textContent = String(brush);
            rail.querySelector("input").setAttribute("aria-valuetext", brush + " 格");
        }
        const number = $("mapSideContent").querySelector("input[data-brush-width]");
        if (number) number.value = String(brush);
    }
    function brushWidthControl() {
        const box = fieldNumber("笔宽 / 格", brush, updateBrushSize, 1, brushSizeMax);
        box.querySelector("input").dataset.brushWidth = "true";
        return box;
    }
    function updateBrushSizeRail() {
        const stage = $("mapStage");
        if (!stage) return;
        let rail = stage.querySelector(".map-brush-size");
        if (!rail) {
            rail = el("div", "map-brush-size");
            rail.id = "mapBrushSize";
            const title = el("span", "", "笔宽"), value = el("output"), slider = el("input");
            slider.type = "range";
            slider.min = "1";
            slider.max = String(brushSizeMax);
            slider.step = "1";
            slider.setAttribute("aria-label", "笔宽 / 格");
            slider.setAttribute("aria-orientation", "vertical");
            slider.oninput = () => updateBrushSize(slider.value);
            slider.onchange = () => renderSide();
            rail.onpointerdown = e => e.stopPropagation();
            rail.onpointermove = e => e.stopPropagation();
            rail.onpointerup = e => e.stopPropagation();
            rail.append(title, value, slider);
            stage.append(rail);
        }
        rail.hidden = world || cleanPreview || !reg() || ![ "brush", "line", "erase" ].includes(tool);
        updateBrushSize(brush);
        if (!rail.hidden) {
            positionBrushSizeRail();
            queueMicrotask(positionBrushSizeRail);
        }
    }
    function positionBrushSizeRail() {
        const stage = $("mapStage"), rail = stage?.querySelector(".map-brush-size");
        if (!rail || world || cleanPreview || ![ "brush", "line", "erase" ].includes(tool)) return;
        const scale = window.OCUIPreferences?.pageScale || 1, frame = stage.getBoundingClientRect(), height = frame.height / scale, width = frame.width / scale, safe = Math.max(0, parseFloat(window.getComputedStyle?.(stage).getPropertyValue("--ui-safe-left")) || 0), left = safe + 8, right = left + 44;
        let gaps = [ [ 8, height - 8 ] ];
        const obstacles = [ "mapWarningCorner", "mapUndo", "mapLayerSwitch", "mapDock", "mapRoomSelectionActions", "mapZoom" ].map($);
        const side = $("mapSide");
        if (side?.classList.contains("panel-open")) obstacles.push(side);
        const popover = $("mapTools")?.querySelector("div.map-brush-popover");
        if (popover) obstacles.push(popover);
        for (const node of obstacles) {
            if (!node || node.hidden) continue;
            const box = node.getBoundingClientRect(), x = (box.left - frame.left) / scale, x2 = (box.right - frame.left) / scale, y = (box.top - frame.top) / scale, y2 = (box.bottom - frame.top) / scale;
            if (x2 <= left || x >= right || y2 <= 8 || y >= height - 8) continue;
            const start = Math.max(8, y - 8), end = Math.min(height - 8, y2 + 8);
            gaps = gaps.flatMap(([a, b]) => end <= a || start >= b ? [ [ a, b ] ] : [ [ a, Math.min(b, start) ], [ Math.max(a, end), b ] ].filter(([a, b]) => b > a));
        }
        const gap = gaps.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0], available = gap ? gap[1] - gap[0] : 0;
        rail.hidden = width < right + 16 || available < 112;
        if (rail.hidden) return;
        const size = Math.min(220, available);
        rail.style.height = Math.floor(size) + "px";
        rail.style.top = Math.round(gap[0] + (available - size) / 2) + "px";
    }
    function renderTools() {
        updateBrushSizeRail();
        updateRoomSelectionActions();
        $("mapCrossRoomControl").hidden = world || cleanPreview;
        renderLayerCreate();
        const n = $("mapTools");
        n.replaceChildren();
        host?.classList.toggle("tools-collapsed", toolsCollapsed && !world);
        const create = button(batchCreateEnabled() ? "批量新建 ▾" : "新建 ▾", newMenu);
        create.id = "mapCreate";
        create.setAttribute("aria-pressed", String(batchCreateEnabled()));
        create.title = batchCreateEnabled() ? "批量新建已开启；Esc 结束当前放置" : "新建内容与批量开关";
        if (world || !toolsCollapsed) n.append(create);
        if (world) {
            const link = button("", () => setTool(tool === "link" ? "select" : "link"));
            link.append(toolGraphic("link"), el("span", "map-tool-label", "连接"));
            link.setAttribute("aria-label", "连接");
            link.setAttribute("aria-pressed", String(tool === "link"));
            n.append(renderWorldMoveControl(), link, button("区域连接", regionConnections));
            return;
        }
        const drawings = [ "brush", "line", "rect", "ellipse", "polygon", "erase", "fill" ];
        if (drawings.includes(tool)) lastDrawTool = tool;
        const toolButton = (k, label) => {
            const b = button("", () => setTool(k));
            b.append(toolGraphic(k), el("span", "map-tool-label", label));
            b.setAttribute("aria-label", label);
            b.title = label + (k === "room-resize" ? " · R" : k === "split" ? " · C" : "");
            const selectionTool = k === "marquee" || k === "room-select";
            b.setAttribute("aria-pressed", String(selectionTool ? tool === "marquee" && marqueeTarget === (k === "room-select" ? "rooms" : "contents") : tool === k));
            if (selectionTool) {
                b.id = k === "room-select" ? "mapSelectRooms" : "mapSelectContents";
                b.classList.add("map-selection-tool");
                b.title = k === "room-select" ? "框选房间，整体移动或合并" : "选区 · M：框选绘制内容、标记和图片，可移动、翻转及复制到图层";
            }
            return b;
        };
        if (!toolsCollapsed || tool === "select" || tool === "marquee") n.append(toolButton("select", "移动"), toolButton("marquee", "选区"), toolButton("room-select", "框选房间"));
        if (!toolsCollapsed || drawings.includes(tool)) {
            const b = button("", () => {
                brushExpanded = !brushExpanded;
                renderTools();
            });
            b.append(toolGraphic(lastDrawTool), el("span", "map-tool-label", toolsList.find(t => t[0] === lastDrawTool)[2] + (brushExpanded ? " ▴" : " ▾")));
            b.title = "画笔";
            b.setAttribute("aria-label", "画笔");
            b.setAttribute("aria-expanded", String(brushExpanded));
            b.setAttribute("aria-pressed", String(drawings.includes(tool)));
            n.append(b);
            if (brushExpanded) {
                const palette = el("div", "map-brush-popover");
                for (const k of drawings) {
                    const btn = button("", () => {
                        setTool(k);
                        brushExpanded = false;
                        renderTools();
                    });
                    btn.append(toolGraphic(k), document.createTextNode(toolsList.find(t => t[0] === k)[2]));
                    btn.setAttribute("aria-pressed", String(tool === k));
                    palette.append(btn);
                }
                renderFavorites(palette);
                palette.append(button("笔刷设置", () => {
                    sidebar = "tools";
                    $("mapSide").classList.add("panel-open");
                    renderSide();
                    resize();
                }));
                n.append(palette);
            }
        }
        if (!toolsCollapsed || tool === "split") n.append(toolButton("split", "分割房间"));
        if (!toolsCollapsed || [ "room-resize", "region-resize" ].includes(tool)) {
            const on = [ "room-resize", "region-resize" ].includes(tool), adjust = button("", () => adjustMenu(adjust));
            adjust.append(toolGraphic(tool === "region-resize" ? "region-resize" : "room-resize"), el("span", "map-tool-label", "调整 ▾"));
            adjust.setAttribute("aria-label", "调整");
            adjust.setAttribute("aria-haspopup", "menu");
            adjust.setAttribute("aria-pressed", String(on));
            adjust.title = tool === "region-resize" ? "调整区域范围" : tool === "room-resize" ? "调整房间 · R" : "调整";
            n.append(adjust);
        }
        if (toolsCollapsed && ![ "select", "marquee", "split", "room-resize", "region-resize", ...drawings ].includes(tool)) n.append(toolButton(tool, toolsList.find(t => t[0] === tool)?.[2] || "工具"));
        const cross = lockButton(w.settings.crossRoomEdit === false, () => change(() => w.settings.crossRoomEdit = w.settings.crossRoomEdit === false), "跨房间编辑");
        cross.append(el("span", "", "跨房间"));
        cross.id = "mapCrossRoomEdit";
        const crossSlot = $("mapCrossRoomControl");
        crossSlot.hidden = tool === "port";
        crossSlot.replaceChildren(...tool === "port" ? [] : tool === "marquee" ? [ renderMarqueeControls(), ...marqueeTarget === "contents" ? [ cross ] : [] ] : [ cross ]);
        const fold = button(toolsCollapsed ? "‹" : "›", () => {
            toolsCollapsed = !toolsCollapsed;
            brushExpanded = false;
            renderTools();
        });
        fold.className = "map-tools-fold";
        fold.title = toolsCollapsed ? "展开工具栏" : "收起工具栏";
        fold.setAttribute("aria-label", fold.title);
        fold.setAttribute("aria-expanded", String(!toolsCollapsed));
        n.append(fold);
        if (tool === "region-resize") {
            const options = el("div", "map-tool-options map-range-options");
            options.append(fieldNumber("宽 / 格", reg().w, v => resizeRegionValue("w", v), Math.min(20, reg().w), 4096), fieldNumber("高 / 格", reg().h, v => resizeRegionValue("h", v), Math.min(20, reg().h), 4096), button("完成", () => setTool("select")));
            n.append(options);
        }
        if (tool === "split") {
            const options = el("div", "map-tool-options"), [label, sel] = select("", cutMethod, {
                frame: "划定房间",
                line: "切开房间"
            }, v => {
                cutMethod = v;
                cutFrame = null;
                preview = null;
                renderTools();
                draw();
            });
            sel.setAttribute("aria-label", "分割方式");
            options.append(sel);
            if (cutMethod === "frame") {
                options.append(button(pendingRoomPreset ? pendingRoomPreset.w + " × " + pendingRoomPreset.h : "70 × 40", () => {
                    const center = cutFrame ? {
                        x: cutFrame.x + cutFrame.w / 2,
                        y: cutFrame.y + cutFrame.h / 2
                    } : {
                        x: reg().w / 2,
                        y: reg().h / 2
                    };
                    placeCutFrame(center);
                    renderTools();
                    draw();
                }));
                const done = button(pendingRoomType === "SHELTER" ? "创建庇护所" : pendingRoomType === "ITERATOR" ? "创建演算室" : pendingRoomType === "GATE" ? "创建业力门" : "确认", confirmCutFrame);
                done.disabled = !cutFrame;
                options.append(done);
                if (cutFrame) options.append(button("取消", () => {
                    cutFrame = null;
                    snapGuides = [];
                    renderTools();
                    draw();
                }));
            } else {
                options.append(button(splitVertical ? "纵向 ▾" : "横向 ▾", () => {
                    splitVertical = !splitVertical;
                    renderTools();
                }));
            }
            n.append(options);
        }
    }
    function newMenu() {
        const items = world ? [ [ "区域", () => regionDialog() ], [ "业力门", () => gateDialog(), "gate" ] ] : [];
        if (!world && reg()) items.push([ "房间 ▸", () => dropdown(currentAnchor(), [ [ "普通房间", startNormalRoom, toolGraphic("room") ], [ "庇护所", startShelterRoom, "shelter" ], [ "迭代器演算室", iteratorRoomDialog, "iterator" ] ]), toolGraphic("room") ], [ "通道井 ▸", () => dropdown(currentAnchor(), Object.entries(C.portKinds).map(([k, label]) => [ label, () => {
            portKind = k;
            setTool("port");
        }, portImage(k) ])), portImage("exit") ], [ "珍珠 ▸", () => recordNewMenu("pearl"), "pearl" ], [ "广播 ▸", () => recordNewMenu("broadcast"), "broadcast" ], [ "竞技场代币 ▸", () => dropdown(currentAnchor(), [ [ "竞技场解锁", () => placeMarker("token", {
            tokenType: "arena",
            color: "#ffc533"
        }), icon("token", "#ffc533") ], [ "沙盒解锁", () => placeMarker("token", {
            tokenType: "sandbox",
            color: "#408dff"
        }), icon("token", "#408dff") ] ]), "token" ], [ "业力门", () => placeMarker("gate"), "gate" ], [ "回响 ▸", () => recordNewMenu("echo"), "echo" ], [ "其他标记 ▸", () => dropdown(currentAnchor(), [ "shop", "toll", "creature", "iterator" ].map(k => [ C.categories[k], () => placeMarker(k), k ])) ], [ "通道井连接", () => setTool("link"), toolGraphic("link") ], [ "参考图", referenceDialog ]);
        items.unshift([ batchCreateEnabled() ? "✓ 批量新建 · 开启" : "批量新建 · 关闭", () => setBatchCreate(!batchCreateEnabled()) ]);
        dropdown(currentAnchor(), items);
    }
    function mainMenu() {
        dropdown($("mapMenu"), [ [ "新建地图", newSceneDialog ], [ "地图设置", sceneDialog ], [ "绘图辅助", editAssistMenu ], [ cleanPreview ? "返回编辑" : "预览", () => $("mapPreview").click() ], [ "导入", importMenu ], [ "导出", exportDialog ], [ "设置", settingsDialog ] ]);
    }
    function placeMarker(kind, options = {}) {
        if (kind === "gate") {
            startGateRoom();
            return;
        }
        markerKind = kind;
        pendingMarker = {
            color: "#cccccc",
            ...options
        };
        setTool("marker");
        toast("点击地图放置" + C.categories[kind]);
    }
    function recordNewMenu(kind) {
        const items = kind === "pearl" ? [ [ "无色珍珠", () => placeMarker(kind, {
            recordMode: "plain",
            color: "#cccccc"
        }) ], [ "无对话彩色珍珠", () => newColoredRecord(kind) ] ] : [ [ "新建" + C.categories[kind], () => placeMarker(kind, {
            recordMode: "blank"
        }) ] ];
        items.push([ "绑定已有" + C.categories[kind], () => bindingPicker(kind, doc => placeMarker(kind, {
            docId: doc.id,
            recordMode: "bound",
            name: doc.title,
            appearance: copy(doc.details?.appearance || {}),
            color: doc.details?.appearance?.baseColor || "#cccccc"
        })) ]);
        dropdown(currentAnchor(), items);
    }
    function newColoredRecord(kind) {
        dialog("新建" + C.categories[kind], (b, a, close) => {
            const [nf, ni] = input("名称", "彩色珍珠"), [cf, ci] = input("颜色", "#cccccc", "color");
            b.append(nf, cf);
            a.append(button("放置", () => {
                placeMarker(kind, {
                    name: ni.value || "彩色珍珠",
                    color: ci.value,
                    recordMode: "colored"
                });
                close();
            }, "primary"));
        });
    }
    function bindingPicker(kind, fn, query = "") {
        return dialog("绑定文字词条", (b, a, close) => {
            const [sf, si] = input("搜索文字词条", query), list = el("div", "map-record-results"), [scopeField, scope] = select("词条范围", "same", {
                same: "同类词条",
                all: "全部文字词条"
            });
            si.placeholder = "名称、英文名、标签或正文";
            b.append(sf, scopeField, list);
            const render = () => {
                list.replaceChildren();
                const docs = C.searchRecords(libraryDocs, si.value, kind).filter(d => scope.value === "all" || C.recordKind(d) === kind || kind === "region" && C.recordKind(d) === "text");
                if (!docs.length) list.append(note("没有匹配的词条"));
                for (const doc of docs) {
                    const item = button("", () => {
                        close();
                        fn(doc);
                    }, "map-record-result");
                    item.append(el("strong", "", doc.title || "未命名词条"), el("small", "", [ doc.category || C.categories[doc.kind] || "文字", doc.details?.english, doc.details?.synopsis ].filter(Boolean).join(" · ").slice(0, 120)));
                    list.append(item);
                }
            };
            si.oninput = scope.onchange = render;
            render();
            a.append(button("取消", close));
        });
    }
    function showRecordCard(o) {
        $("mapRecordCard")?.remove();
        if (!o) return;
        const doc = libraryDocs.find(d => d.id === (o.iteratorDocId || o.docId)), card = el("div", "map-pearl-card");
        card.id = "mapRecordCard";
        const dismiss = button("×", () => card.remove());
        dismiss.setAttribute("aria-label", "关闭标记信息");
        card.append(row(el("strong", "", doc?.title || o.name || C.categories[o.kind]), dismiss));
        if ([ "pearl", "broadcast", "echo" ].includes(o.kind)) card.append(note(doc?.details?.synopsis || o.synopsis || (o.docId && !doc ? "绑定词条未找到" : "暂无简介")));
        card.append(button("编辑", () => {
            card.remove();
            activateMarker(o, true);
        }));
        if (doc) card.append(button("文字详情", () => {
            card.remove();
            exit();
            bridge.openRecord(doc.id);
        }));
        if (o.kind === "gate") {
            const gate = w.gates.find(g => [ g.a, g.b ].some(s => s.region === regionId && s.marker === o.id));
            if (gate) {
                const other = gate.a.region === regionId && gate.a.marker === o.id ? gate.b : gate.a, target = w.regions.find(r => r.id === other.region);
                card.append(target ? button("前往 " + target.name, () => {
                    card.remove();
                    openRegion(other.region);
                    activateMarker(reg().markers.find(m => m.id === other.marker));
                }) : button("设置两侧区域", () => {
                    card.remove();
                    gateDialog(gate);
                }));
            }
        }
        const v = viewSize();
        card.style.left = Math.max(8, Math.min(v.w - 248, o.x * cam.z + cam.x + 16)) + "px";
        card.style.top = Math.max(8, Math.min(v.h - 190, o.y * cam.z + cam.y + 12)) + "px";
        $("mapStage").append(card);
    }
    async function openMarkerRecord(o, err) {
        try {
            if (markerRecordPending.has(o.id)) await markerRecordPending.get(o.id);
            let doc = libraryDocs.find(d => d.id === o.docId);
            if (!doc) {
                const record = C.makeRegionRecord(o.kind, o.name, reg());
                record.details.appearance = copy(o.appearance || {
                    baseColor: o.color || "#cccccc"
                });
                doc = await bridge.createRecord(record);
                libraryDocs = bridge.getProject().documents || [];
                change(() => C.bindRecord(o, doc));
            }
            document.querySelectorAll("dialog.map-dialog").forEach(d => d.close());
            exit();
            bridge.openRecord(doc.id);
        } catch (e) {
            err(e);
        }
    }
    function renderLayerCreate() {
        const n = $("mapLayerCreate");
        if (!n) return;
        n.replaceChildren();
        n.hidden = world || cleanPreview || !reg();
        if (n.hidden) return;
        const create = button("新建层", () => newLayerDialog());
        create.setAttribute("aria-label", "新建层");
        const more = button("▾", () => dropdown(more, [ [ "复制当前层", () => newLayerDialog(layerId) ] ]));
        more.setAttribute("aria-label", "复制层");
        more.setAttribute("aria-haspopup", "menu");
        more.title = "复制当前层";
        n.append(create, more);
    }
    function newLayerDialog(sourceId = null) {
        if (!reg()) return;
        if (C.isDedicatedLayer(reg().layers.find(l => l.id === sourceId))) {
            requireEdit(() => change(() => C.duplicateLayer(w, reg(), sourceId)), {
                regionScope: true
            });
            return;
        }
        const source = sourceId ? reg().layers.find(l => l.id === sourceId) : null;
        if (sourceId && !source) return;
        dialog(source ? "复制层" : "新建层", (b, a, close, err) => {
            const [f, i] = input("名称", C.nextLayerName(reg(), source ? source.name + " 副本" : "新层"));
            b.append(f);
            a.append(button(source ? "复制" : "创建", () => {
                const name = i.value.trim();
                if (!name) {
                    err("请填写图层名称。");
                    return;
                }
                if (reg().layers.some(l => l.name === name)) {
                    err("图层名称已存在。");
                    return;
                }
                requireEdit(() => {
                    cancelDrag();
                    let problem;
                    const ok = change(() => {
                        try {
                            const next = source ? C.duplicateLayer(w, reg(), sourceId, name) : C.addLayer(reg(), name);
                            layerId = next.id;
                            roomId = null;
                            selection = null;
                            hoverRoomId = null;
                            cutFrame = null;
                            polygon = [];
                            connectStart = null;
                        } catch (e) {
                            problem = e;
                            throw e;
                        }
                    });
                    if (ok) {
                        close();
                        renderLayerSwitch();
                        renderLayerCreate();
                    } else if (problem) err(problem);
                }, {
                    regionScope: true
                });
            }, "primary"));
        });
    }
    function setLayer(id) {
        cancelDrag();
        selectionMessage = "";
        selectionMoveArmed = false;
        multiSelection = [];
        selectionBox = null;
        layerId = id;
        roomId = null;
        selection = null;
        hoverRoomId = null;
        cutFrame = null;
        polygon = [];
        if (tool !== "link") connectStart = null;
        renderLayerSwitch();
        renderTools();
        renderSide();
        draw();
    }
    function cycleLayer() {
        if (world || !reg()) return;
        const list = reg().layers.filter(l => l.visible !== false);
        if (!list.length) return;
        setLayer(list[(list.findIndex(l => l.id === layerId) + 1) % list.length].id);
    }
    function renderLayerSwitch() {
        const n = $("mapLayerSwitch");
        n.replaceChildren();
        n.hidden = world || !reg();
        if (n.hidden) return;
        const prev = button("‹", () => {
            const ls = reg().layers.filter(l => l.visible !== false);
            if (ls.length) setLayer(ls[(ls.findIndex(l => l.id === layerId) - 1 + ls.length) % ls.length].id);
        });
        prev.title = "上一层";
        prev.setAttribute("aria-label", "上一层");
        const current = button(layer()?.name || "层级", () => dropdown(current, reg().layers.map(l => [ l.name + (l.id === layerId ? " ✓" : ""), () => setLayer(l.id) ])));
        current.title = "置顶层级";
        const next = button("›", cycleLayer);
        next.title = "下一层 · Shift Z";
        next.setAttribute("aria-label", "下一层");
        n.append(prev, current, next);
    }
    function fold(title, parent, key = title, initial = false) {
        const d = el("details", "map-fold map-section"), id = foldKey(key);
        d.dataset.foldKey = id;
        d.open = foldStates.has(id) ? foldStates.get(id) : initial;
        d.append(el("summary", "", title));
        d.ontoggle = () => foldStates.set(id, d.open);
        parent.append(d);
        return d;
    }
    function displayOptions(n, regions, onChange = () => {}) {
        const rs = (Array.isArray(regions) ? regions : [ regions ]).filter(Boolean), categoryToggle = (k, title) => {
            const values = rs.map(r => r.categories[k].visible), all = values.every(Boolean), box = check(title, all, v => {
                change(() => rs.forEach(r => {
                    r.categories[k].visible = v;
                    if (v && [ "ports", "connections" ].includes(k)) r.detailsVisible = true;
                }));
                onChange();
            });
            box.querySelector("input").indeterminate = values.some(Boolean) && !all;
            return box;
        };
        if (rs.length) {
            const values = rs.map(r => r.detailsVisible !== false && (r.categories.ports.visible || r.categories.connections.visible)), all = values.every(Boolean), master = check("通道井与细节", all, v => {
                change(() => rs.forEach(r => {
                    r.detailsVisible = v;
                    if (v && !r.categories.ports.visible && !r.categories.connections.visible) {
                        r.categories.ports.visible = true;
                        r.categories.connections.visible = true;
                    }
                }));
                onChange();
            });
            master.querySelector("input").indeterminate = values.some(Boolean) && !all;
            n.append(master);
        }
        const draw = fold("全区域绘制内容", n);
        for (const [key, label] of [ [ "geometry", "地形" ], [ "water", "水体" ] ]) {
            const on = rs.every(r => r.categories[key].visible !== false), locked = rs.every(r => r.categories[key].locked === true);
            const line = row(visibilityButton(on, () => {
                change(() => rs.forEach(r => r.categories[key].visible = !on));
                onChange();
            }, label), lockButton(locked, () => {
                change(() => rs.forEach(r => r.categories[key].locked = !locked));
                onChange();
            }, label), el("span", "name", label));
            line.classList.toggle("is-locked", locked);
            if (key === "geometry") {
                const hidden = rs.flatMap(r => r.shapes.filter(o => !o.decoration && cat(o) === "geometry" && o.visible === false));
                if (hidden.length) line.append(button("显示隐藏地形 · " + hidden.length, () => {
                    change(() => hidden.forEach(o => o.visible = true));
                    onChange();
                }, "small"));
            }
            draw.append(line);
        }
        const names = fold("区域名称", n);
        regionLabelControls(names, onChange);
        const bd = fold("边界与名称", n);
        bd.append(check("区域边界", w.settings.showRegionBounds, v => change(() => w.settings.showRegionBounds = v)));
        if (rs.length) for (const [k, label] of [ [ "rooms", "房间边界" ], [ "roomNames", "房间名称" ], [ "cameras", "镜头边界" ] ]) bd.append(categoryToggle(k, label));
        bd.append(check("放大时显示像素格", w.settings.grid, v => change(() => w.settings.grid = v)));
        if (rs.length) {
            const marks = fold("标记", n);
            for (const [k, title] of Object.entries(C.categories)) marks.append(categoryToggle(k, title));
            const more = fold("通道与参考", n);
            for (const [k, title] of [ [ "ports", "通道井 / 生物井" ], [ "connections", "连接虚线" ], [ "refs", "参考图" ] ]) more.append(categoryToggle(k, title));
        }
    }
    function specialDisplayControls(n, regions) {
        const rs = (Array.isArray(regions) ? regions : [ regions ]).filter(Boolean), root = el("section", "map-special-display");
        root.setAttribute("aria-label", "庇护所与业力门");
        for (const [kind, label] of [ [ "shelter", "庇护所" ], [ "gate", "业力门" ] ]) {
            const gates = kind === "gate" ? w.gates.filter(g => g.sharedRoom && g.scenes.includes(sceneId) && (world || room() && C.sharedGateForRoom(w, regionId, roomId)?.id === g.id || !room() && [ g.a, g.b ].some(s => rs.some(r => r.id === s.region)))) : [], gateRooms = gates.map(sharedGateRoom).filter(Boolean), targets = kind === "gate" ? [ ...new Map([ ...rs, ...gateRooms.map(t => t.region) ].map(r => [ r.id, r ])).values() ] : rs, values = kind === "gate" && gateRooms.length ? gateRooms.map(t => ({
                fullDisplay: t.room.fullDisplay ?? C.gateLayer(t.region)?.fullDisplay,
                opacity: C.opacity(t.room) * C.opacity(C.gateLayer(t.region))
            })) : targets.flatMap(r => {
                const layers = r.layers.filter(l => l.kind === kind);
                return layers.length ? layers : [ r.specialDisplay?.[kind] || {} ];
            }), apply = patch => change(() => {
                for (const r of targets) {
                    r.specialDisplay ||= {};
                    r.specialDisplay[kind] = {
                        ...r.specialDisplay[kind],
                        ...patch
                    };
                    for (const l of r.layers.filter(l => l.kind === kind)) {
                        if (kind === "gate" && gateRooms.some(t => t.region.id === r.id)) {
                            if (patch.fullDisplay === true) l.visible = true;
                        } else Object.assign(l, patch, patch.fullDisplay === true ? {
                            visible: true
                        } : {});
                    }
                }
                for (const t of gateRooms) {
                    if ("fullDisplay" in patch) t.room.fullDisplay = patch.fullDisplay;
                    if ("opacity" in patch) t.room.opacity = Math.min(1, patch.opacity / (C.opacity(C.gateLayer(t.region)) || 1));
                }
            }), full = check(label + "完整预览", values.length > 0 && values.every(v => v.fullDisplay === true), v => apply({
                fullDisplay: v
            })), checkbox = full.querySelector("input"), opacity = el("label", "map-opacity"), slider = el("input"), value = el("output", "", Math.round(C.opacity(values[0]) * 100) + "%");
            checkbox.indeterminate = values.some(v => v.fullDisplay === true) && !checkbox.checked;
            checkbox.disabled = !targets.length;
            slider.type = "range";
            slider.min = 0;
            slider.max = 100;
            slider.step = 1;
            slider.value = Math.round(C.opacity(values[0]) * 100);
            slider.disabled = !targets.length;
            slider.setAttribute("aria-label", label + "完整预览不透明度");
            slider.oninput = () => value.textContent = slider.value + "%";
            slider.onchange = () => apply({
                opacity: Math.max(0, Math.min(100, +slider.value)) / 100
            });
            opacity.append(el("span", "", "不透明度"), slider, value);
            const line = el("div", "map-special-display-row");
            line.append(full, opacity);
            root.append(line);
        }
        root.append(el("p", "map-muted", rs.length ? "同时影响预览与 PNG，并用于本区域之后新建的同类房间。编辑中的房间保持展开。" : "创建区域后可设置完整预览。"));
        n.append(root);
    }
    function viewDialog() {
        const d = dialog("显示", (b, a, close) => {
            const populate = () => {
                b.replaceChildren();
                specialDisplayControls(b, world ? scene().regions.map(id => w.regions.find(r => r.id === id)) : reg());
                b.append(button("房间警告 · 开关与问题列表", () => {
                    close();
                    warningDialog();
                }, "map-full"), iconScaleControl(), input("通道方向箭头颜色", portArrowColor(), "color", v => {
                    change(() => w.settings.portArrowColor = v);
                    drawOverlay();
                })[0]);
                const fonts = fold("字体", b, "display-font");
                fonts.append(select("地图字体", w.settings.mapFont || "pixel", {
                    pixel: "像素 · 原有字体",
                    narrow: "细窄 · 仿官风格"
                }, v => {
                    change(() => w.settings.mapFont = v);
                    sample.style.fontFamily = mapFontFamily();
                    loadMapFont();
                })[0]);
                const sample = el("div", "map-font-sample", "工业区 · INDUSTRIAL COMPLEX");
                sample.style.fontFamily = mapFontFamily();
                fonts.append(sample, el("div", "map-muted", "用于地图标题和导出图片。仿官风格调整英文字体，中文保留原有像素字体。"));
                const detail = fold("房间背景细节", b, "background-detail", true);
                detail.append(check("缩小时隐藏阴影层", (w.settings.backgroundHideBelow ?? 2) > 0, v => change(() => w.settings.backgroundHideBelow = v ? 2 : 0)), fieldNumber("低于此缩放比例隐藏 / %", Math.round((w.settings.backgroundHideBelow ?? 2) * 50), v => change(() => w.settings.backgroundHideBelow = Math.max(0, Math.min(2e3, v)) / 50), 0, 2e3), el("div", "map-muted", "取消勾选即始终显示阴影层；百分比与画布缩放显示一致。"));
                displayOptions(b, world ? scene().regions.map(id => w.regions.find(r => r.id === id)) : reg(), populate);
                b.append(check("缩放控件", w.settings.showZoom, v => change(() => w.settings.showZoom = v)));
            };
            populate();
            a.append(button("完成", close, "primary"));
        });
        d.addEventListener("close", draw);
    }
    function backgroundDialog() {
        dialog("背景", (b, a, close) => {
            if (!world && reg()) {
                const r = reg(), rm = room() || (selection?.list === "rooms" ? selected() : null);
                b.append(backgroundControl(rm ? "房间空气底色" : "区域空气底色", rm?.background || r.air || "#ffffff", v => requireEdit(() => change(() => {
                    if (rm) rm.background = v; else {
                        r.air = v;
                        r.rooms.forEach(o => o.background = v);
                    }
                }))));
            }
            const aux = fold("画布底色", b);
            aux.append(backgroundControl("底色", mapBackground(), v => change(() => {
                if (world) w.settings.canvasBackground = v; else reg().bg = v;
            })));
            b.append(check("整体反相", !!w.settings.invert, v => change(() => w.settings.invert = v)));
            a.append(button("完成", close, "primary"));
        });
    }
    function lockButton(locked, fn, label = "图层") {
        const b = button("", () => {
            if (fn() !== false) {
                locked = !locked;
                paint();
            }
        }, "map-lock-button"), svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("class", "map-tool-svg");
        svg.setAttribute("aria-hidden", "true");
        svg.append(p);
        b.append(svg);
        function paint() {
            p.setAttribute("d", (locked ? "M7 10V7a5 5 0 0 1 10 0v3" : "M7 10V5H11V2H17V6") + "M5 10h14v11H5zM12 14v3");
            const state = locked ? "已锁定" : "未锁定", action = locked ? "解锁" : "锁定";
            b.title = state + " · 点击" + action + " " + label;
            b.setAttribute("aria-label", state + "：" + label + "，点击" + action);
            b.setAttribute("aria-pressed", String(locked));
            b.dataset.lockState = locked ? "locked" : "unlocked";
        }
        paint();
        return b;
    }
    function visibilityButton(visible, fn, label) {
        const b = button("", () => {
            if (fn() !== false) {
                visible = !visible;
                paint();
            }
        }, "map-visibility-button"), svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("class", "map-tool-svg");
        svg.setAttribute("aria-hidden", "true");
        svg.append(p);
        b.append(svg);
        function paint() {
            p.setAttribute("d", "M2 12Q12 0 22 12Q12 24 2 12ZM15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0" + (visible ? "" : "M3 3L21 21"));
            b.title = (visible ? "隐藏" : "显示") + label;
            b.setAttribute("aria-label", b.title);
            b.setAttribute("aria-pressed", String(visible));
        }
        paint();
        return b;
    }
    function opacityControl(o, label = "不透明度") {
        const box = el("label", "map-opacity"), name = el("span", "", "不透明度"), value = el("output", "", Math.round(C.opacity(o) * 100) + "%"), slider = el("input");
        slider.type = "range";
        slider.min = 0;
        slider.max = 100;
        slider.step = 1;
        slider.value = Math.round(C.opacity(o) * 100);
        slider.setAttribute("aria-label", label);
        slider.oninput = () => value.textContent = slider.value + "%";
        slider.onchange = () => change(() => o.opacity = Math.max(0, Math.min(100, +slider.value)) / 100);
        box.append(name, slider, value);
        return box;
    }
    function renameLayerDialog(l) {
        if (C.isDedicatedLayer(l)) return;
        dialog("图层名称", (b, a, close, err) => {
            const [f, i] = input("名称", l.name);
            b.append(f);
            a.append(button("保存", () => {
                const name = i.value.trim();
                if (!name) {
                    err("请填写图层名称。");
                    return;
                }
                if (reg().layers.some(o => o.id !== l.id && o.name === name)) {
                    err("图层名称已存在。");
                    return;
                }
                requireEdit(() => {
                    change(() => l.name = name);
                    close();
                }, {
                    regionScope: true
                });
            }, "primary"));
        });
    }
    function roomProperties(o) {
        setTool("select");
        selection = {
            list: "rooms",
            id: o.id
        };
        layerId = o.layer;
        sidebar = "tools";
        $("mapSide").classList.add("panel-open");
        $("mapPanel").setAttribute("aria-expanded", "true");
        renderSide();
        renderLayerSwitch();
        draw();
    }
    function renameRoomDialog(o) {
        const shared = C.sharedGateForRoom?.(w, regionId, o.id);
        if (shared) {
            gateDialog(shared);
            return;
        }
        dialog("房间名称", (b, a, close, err) => {
            const [f, i] = input("名称", o.name);
            b.append(f);
            a.append(button("保存", () => requireEdit(() => {
                let issue;
                const ok = change(() => {
                    try {
                        C.renameRoom(reg(), o, i.value);
                    } catch (e) {
                        issue = e;
                        throw e;
                    }
                });
                if (ok) close(); else if (issue) err(issue);
            }), "primary"));
        });
    }
    function copyRoomDialog(o) {
        dialog("复制房间", (b, a, close, err) => {
            const r = reg(), [lf, li] = select("目标层", o.layer, Object.fromEntries(r.layers.filter(l => o.roomType === "SHELTER" ? l.kind === "shelter" : o.roomType === "GATE" ? l.kind === "gate" : !C.isDedicatedLayer(l)).map(l => [ l.id, l.name ]))), p = C.roomCopyPosition(r, o) || {
                x: o.x,
                y: o.y
            }, [xf, xi] = input("X", p.x, "number"), [yf, yi] = input("Y", p.y, "number");
            xi.min = yi.min = 0;
            xi.step = yi.step = 1;
            li.onchange = () => {
                const next = C.roomCopyPosition(r, o, li.value);
                if (next) {
                    xi.value = next.x;
                    yi.value = next.y;
                }
            };
            b.append(lf, row(xf, yf));
            a.append(button("复制", () => requireEdit(() => {
                let issue;
                const ok = change(() => {
                    try {
                        const rm = C.duplicateRoom(w, reg(), o.id, {
                            layer: li.value,
                            x: +xi.value,
                            y: +yi.value
                        });
                        selection = {
                            list: "rooms",
                            id: rm.id
                        };
                        layerId = rm.layer;
                        roomId = null;
                    } catch (e) {
                        issue = e;
                        throw e;
                    }
                });
                if (ok) {
                    close();
                    renderLayerSwitch();
                    renderSide();
                    draw();
                    if (o.roomType === "GATE") toast("已复制业力门，请重新选择两侧区域登记。");
                } else if (issue) err(issue);
            }, {
                regionScope: true
            }), "primary"));
        });
    }
    function unlockAll() {
        if (!reg() || world) return;
        cancelDrag();
        const changed = change(() => C.unlockRegion(reg()));
        renderSide();
        draw();
        toast(changed ? "已全部解锁" : "当前区域没有锁定内容");
    }
    function renderLayers(n, r) {
        for (const l of [ ...r.layers ].reverse()) {
            const tree = fold(l.name, n, "space:" + l.id, l.id === layerId);
            tree.classList.add("map-space-tree");
            tree.classList.toggle("is-locked", l.locked === true);
            const summary = tree.querySelector("summary");
            summary.replaceChildren();
            const arrow = el("span", "map-tree-arrow", "▸"), name = button(l.name, e => {
                e?.preventDefault?.();
                setLayer(l.id);
            }, "name");
            const more = button("⋯", e => {
                e?.preventDefault?.();
                dropdown(more, [ ...C.isDedicatedLayer(l) ? [] : [ [ "重命名", () => renameLayerDialog(l) ], [ "合并到其他层", () => mergeLayerDialog(l) ] ], [ "复制层", () => newLayerDialog(l.id) ], [ "上移", () => change(() => {
                    const i = r.layers.indexOf(l);
                    if (i < r.layers.length - 1) [r.layers[i], r.layers[i + 1]] = [ r.layers[i + 1], r.layers[i] ];
                }) ], [ "下移", () => change(() => {
                    const i = r.layers.indexOf(l);
                    if (i > 0) [r.layers[i], r.layers[i - 1]] = [ r.layers[i - 1], r.layers[i] ];
                }) ] ]);
            });
            summary.append(arrow, visibilityButton(l.visible !== false, () => change(() => l.visible = l.visible === false), "层 " + l.name), lockButton(l.locked, () => change(() => l.locked = !l.locked), "层 " + l.name), name, more);
            summary.querySelectorAll("button").forEach(b => b.addEventListener("click", e => e.preventDefault()));
            tree.append(opacityControl(l, l.name + "不透明度"));
            if (C.isDedicatedLayer(l)) tree.append(check("完整显示 · 预览 / PNG", r.rooms.filter(rm => rm.layer === l.id).every(rm => (rm.fullDisplay ?? l.fullDisplay) === true), v => change(() => {
                l.fullDisplay = v;
                for (const rm of r.rooms.filter(rm => rm.layer === l.id && rm.roomType === "GATE")) rm.fullDisplay = v;
            })));
            renderRoomList(tree, r, l.id);
        }
        const extra = Object.entries(r.categories).filter(([k, v]) => v.locked), objects = [ "shapes", "markers", "ports", "refs" ].flatMap(k => r[k].filter(o => o.locked).map(o => ({
            o: o,
            k: k
        })));
        if (extra.length || objects.length) {
            const locks = fold("其他锁定", n, "other-locks");
            for (const [k, v] of extra) locks.append(row(lockButton(true, () => change(() => v.locked = false), C.categoryName(k)), el("span", "name", C.categoryName(k))));
            for (const {o: o, k: k} of objects) locks.append(row(lockButton(true, () => change(() => o.locked = false), o.name || C.categoryName(k)), el("span", "name", o.name || C.categoryName(k))));
        }
    }
    function renderRoomList(n, r, lid = layerId) {
        const list = el("div", "map-room-tree");
        n.append(list);
        for (const rm of r.rooms.filter(o => o.layer === lid)) {
            const parent = r.layers.find(l => l.id === lid), locked = rm.locked || parent?.locked || r.categories.rooms.locked, li = el("div", "map-layer" + (selection?.list === "rooms" && selection.id === rm.id ? " active" : "") + (locked ? " is-locked" : "")), more = button("⋯", () => dropdown(more, [ [ "编辑房间", () => focusRoom(rm) ], [ "房间属性", () => roomProperties(rm) ], [ "重命名", () => renameRoomDialog(rm) ], [ "复制房间", () => copyRoomDialog(rm) ] ]));
            li.append(visibilityButton(rm.visible !== false, () => change(() => {
                rm.visible = rm.visible === false;
                if (!rm.visible && roomId === rm.id) {
                    roomId = null;
                    selection = null;
                }
            }), "房间 " + rm.name), roomLockButton(rm), button(rm.name, () => {
                selection = {
                    list: "rooms",
                    id: rm.id
                };
                roomId = rm.id;
                roomPaintLayer = 0;
                layerId = rm.layer;
                renderSide();
                draw();
            }, "name"), more);
            if (warningEnabled(r, rm) && shelterSafety(r, rm).length) {
                const warning = button("!", () => shelterProblemDialog(r, rm), "map-shelter-badge map-warning-pulse");
                warning.title = shelterSafety(r, rm).map(p => p.message).join("\n");
                warning.setAttribute("aria-label", rm.name + "：房间检查警告");
                li.append(warning);
            }
            list.append(li);
            if (selection?.list === "rooms" && selection.id === rm.id) list.append(opacityControl(rm, rm.name + "不透明度"), roomPaintControls(rm));
        }
        for (const m of r.markers.filter(m => m.layer === lid && m.kind === "gate" && m.sharedGateRoom && m.sharedGateRoom.region !== r.id)) {
            const g = w.gates.find(g => g.id === m.sharedGateId);
            if (g && g.scenes.includes(sceneId)) list.append(row(visibilityButton(g.visible !== false, () => change(() => g.visible = g.visible === false), "共享业力门 " + g.name), button((sharedGateRoom(g)?.room.name || g.name) + " · 共享", () => openSharedGate(g), "name")));
        }
        if (!list.children.length) list.append(el("span", "map-muted", "暂无房间"));
    }
    function roomLockButton(rm) {
        const parent = reg().layers.find(l => l.id === rm.layer), global = reg().categories.rooms, source = parent?.locked ? "图层“" + parent.name + "”" : global?.locked ? "房间图层" : null;
        if (source) {
            const button = lockButton(true, () => false, "房间 " + rm.name);
            button.disabled = true;
            button.dataset.inherited = "true";
            button.title = source + "已锁定；请在图层列表解锁" + source;
            button.setAttribute("aria-label", "已锁定：房间 " + rm.name + "，来自" + source);
            return button;
        }
        return lockButton(rm.locked, () => change(() => rm.locked = !rm.locked), "房间 " + rm.name);
    }
    function roomPaintControls(rm) {
        const box = el("div", "map-room-paint-layers");
        box.setAttribute("aria-label", "房间绘制层");
        for (const [i, p] of C.roomPaintLayers(rm).entries()) {
            const name = button(C.paintLayerNames[i], () => {
                roomId = rm.id;
                roomPaintLayer = i;
                layerId = rm.layer;
                selection = null;
                if (i) material = "solid";
                if (![ "brush", "line", "rect", "ellipse", "polygon", "erase", "fill" ].includes(tool)) setTool("brush");
                renderSide();
                renderTools();
                draw();
            }, "name" + (roomId === rm.id && roomPaintLayer === i ? " active" : ""));
            name.setAttribute("aria-pressed", String(roomId === rm.id && roomPaintLayer === i));
            const edit = fn => change(() => {
                rm.paintLayers ||= C.roomPaintLayers(rm);
                fn(rm.paintLayers[i]);
            });
            box.append(row(visibilityButton(p.visible !== false, () => edit(l => l.visible = l.visible === false), C.paintLayerNames[i]), lockButton(p.locked, () => edit(l => l.locked = !l.locked), C.paintLayerNames[i]), name));
        }
        return box;
    }
    function activePaintLayer() {
        return room() ? roomPaintLayer : 0;
    }
    const nativeResizeConsents = new Map;
    function hasNativeResizeConsent(rm) {
        return nativeResizeConsents.get(rm.id) === rm.rainedSource;
    }
    function requestNativeResize(rm, apply) {
        let needs;
        try {
            needs = C.needsNativeGeometryResize(rm);
        } catch (error) {
            toast(error.message);
            return;
        }
        if (!needs || hasNativeResizeConsent(rm)) {
            apply(needs);
            return;
        }
        const rid = reg().id, source = rm.rainedSource;
        dialog("调整原生房间尺寸", (b, a, close) => {
            b.append(note(rm.name + " 含有 Rained 装饰。修改边界会只保留地形、背景和通道结构，材质、贴块、效果和物件需要在 Rained 中重新整理。原始工程会保存在项目中，并随 Rained 导出提供备份。"));
            a.append(button("取消", () => {
                close();
                renderSide();
            }), button("保留原始备份并仅调整地形", () => {
                if (reg()?.id !== rid || reg().rooms.find(o => o.id === rm.id)?.rainedSource !== source) {
                    close();
                    toast("房间已改变，请重新操作。");
                    return;
                }
                nativeResizeConsents.set(rm.id, source);
                close();
                apply(true);
            }, "primary"));
        });
    }
    function resizeSelectionObject(o, ww, hh, edit) {
        if (selection?.list !== "rooms" || ww === o.w && hh === o.h) {
            edit(() => resizeObject(o, ww, hh));
            return;
        }
        requestNativeResize(o, geometryOnly => edit(() => resizeObject(o, ww, hh, {
            geometryOnly: geometryOnly
        })));
    }
    function transformRoomSelection(ids, options) {
        if (!reg() || !ids.length) return;
        if ((options.rotation || 0) % 360 === 0 && !options.flipX && !options.flipY) {
            toast("旋转 360° 后保持原方向。");
            return;
        }
        const rid = reg().id, targets = [ ...ids ], native = reg().rooms.filter(rm => targets.includes(rm.id) && C.needsNativeGeometryTransform?.(rm));
        const apply = geometryOnly => {
            if (reg()?.id !== rid) {
                toast("当前区域已切换，请重新选择房间。");
                return;
            }
            requireEdit(() => {
                cancelDrag();
                const changed = change(() => C.transformRooms(reg(), targets, {
                    ...options,
                    geometryOnly: geometryOnly
                }));
                if (changed) {
                    selectionBox = null;
                    renderSide();
                    draw();
                }
            }, {
                regionScope: true
            });
        };
        if (native.length) dialog("旋转 / 翻转原生房间", (b, a, close) => {
            b.append(note(native.map(rm => rm.name).join("、") + " 含有 Rained 材质、贴块、效果或物件。本次仅转换地形、背景、通道井和地图标记，这些装饰需要在 Rained 中重新整理。原始工程会保存在项目中，并随 Rained 导出提供备份。"));
            a.append(button("取消", close), button("保留原始备份并仅转换地形", () => {
                close();
                apply(true);
            }, "primary"));
        }); else apply(false);
    }
    function roomTransformControls(ids) {
        const box = el("div", "map-room-transform-controls"), run = options => transformRoomSelection(ids, options), more = button("旋转 / 翻转 ▾", () => dropdown(more, [ [ "旋转 180°", () => run({
            rotation: 180
        }) ], [ "右转 270°", () => run({
            rotation: 270
        }) ], [ "旋转 360°", () => run({
            rotation: 360
        }) ], [ "左右翻转", () => run({
            flipX: true
        }) ], [ "上下翻转", () => run({
            flipY: true
        }) ] ]));
        more.setAttribute("aria-haspopup", "menu");
        box.append(button("左转 90°", () => run({
            rotation: -90
        })), button("右转 90°", () => run({
            rotation: 90
        })), more);
        return box;
    }
    function rotatePortDirection(r, o, turn, edit) {
        const facing = o.facing && o.facing !== "auto" ? o.facing : C.portPose(r, o).direction, order = [ "up", "right", "down", "left" ], index = order.indexOf(facing);
        edit(() => o.facing = order[((index < 0 ? 1 : index) + turn + 4) % 4]);
        renderSide();
    }
    function normalizeEditedGate(r, rm, {keepRegion: keepRegion = false, draft: draft = null} = {}) {
        if (rm.roomType !== "GATE") return;
        C.normalizeSharedGates(w);
        let g = w.gates.find(g => g.sharedRoom?.room === rm.id);
        if (g) {
            if (draft) g = C.saveGateConnection(w, sceneId, draft, g.id);
            if (keepRegion) {
                roomId = null;
                const side = [ g.a, g.b ].find(side => side.region === r.id);
                selection = side ? {
                    list: "markers",
                    id: side.marker
                } : null;
                return;
            }
            const target = sharedGateRoom(g);
            regionId = target.region.id;
            roomId = target.room.id;
            layerId = target.room.layer;
            world = false;
            selection = {
                list: "rooms",
                id: target.room.id
            };
            requestAnimationFrame(fit);
        }
    }
    function roomNameControls(s, r, o, edit) {
        const shared = C.sharedGateForRoom?.(w, r.id, o.id);
        if (shared) s.append(el("p", "map-shared-gate-caption", "共享业力门 · " + [ shared.a, shared.b ].map(side => w.regions.find(rr => rr.id === side.region)?.name || "未绑定").join(" ↔ ")));
        s.append(roomTransformControls([ o.id ]));
        if (o.roomType === "SHELTER") s.append(shelterIconControls(r, o, edit), note("固定庇护所：门机构和四周墙体受保护，红框内可编辑。可调整长宽、朝向和出口位置。"), button("门与出口设置", () => shelterLayoutDialog(o), "map-full"));
        if (o.warningsDisabled || dismissedRoomWarnings.has(warningKey(r, o))) s.append(button("恢复此房间警告", () => {
            dismissedRoomWarnings.delete(warningKey(r, o));
            change(() => o.warningsDisabled = false);
            renderSide();
        }));
        const warning = shelterWarning(r, o);
        if (warning) s.append(warning);
        s.append(roomPaintControls(o));
        s.append(select("房间类型", o.roomType || "ROOM", {
            ROOM: "普通房间",
            SHELTER: "庇护所",
            GATE: "业力门",
            ITERATOR: "迭代器演算室"
        }, v => {
            if (v === "GATE") {
                dialog("业力门房间", (b, a, close, err) => {
                    const [f, i] = input("另一侧区域代码", o.gateTo || "");
                    b.append(f);
                    a.append(button("确定", () => {
                        if (!/^[A-Z0-9]+$/i.test(i.value)) {
                            err("请填写区域代码。");
                            return;
                        }
                        edit(() => {
                            C.setRoomKind(w, r, o, v, i.value.toUpperCase());
                            normalizeEditedGate(r, o);
                        });
                        close();
                    }, "primary"));
                });
            } else edit(() => C.setRoomKind(w, r, o, v));
        })[0], row(visibilityButton(o.visible !== false, () => change(() => o.visible = o.visible === false), "房间"), roomLockButton(o)), opacityControl(o, "房间不透明度"));
    }
    function roomPresetDialog() {
        dialog("房间预设", (b, a, close, err) => {
            for (const preset of (window.OCRoomPresets?.entries || []).filter(p => ![ "GATE", "SHELTER" ].includes(p.type))) {
                const btn = button(preset.name + " · " + preset.w + " × " + preset.h, async () => {
                    btn.disabled = true;
                    try {
                        const data = await window.OCRoomPresets.read(preset.id);
                        if (data.w > reg().w || data.h > reg().h) {
                            err("请先扩大区域至至少 " + data.w + " × " + data.h + " 格。");
                            return;
                        }
                        requireEdit(() => {
                            beginRoomPreset(preset.type, data);
                            close();
                        }, {
                            regionScope: true
                        });
                    } catch (e) {
                        err(e.message);
                    } finally {
                        btn.disabled = false;
                    }
                }, "map-full");
                b.append(btn);
            }
            a.append(button("取消", close));
        });
    }
    function iteratorRoomDialog() {
        if (!reg()) return;
        dialog("迭代器演算室", (b, a, close, err) => {
            const [wf, wi] = input("宽 / 格", 70, "number"), [hf, hi] = input("高 / 格", 40, "number"), [tf, ti] = input("墙体厚度 / 格", 2, "number"), [nf, ni] = input("标记名称", "迭代器演算室");
            for (const i of [ wi, hi, ti ]) {
                i.min = 1;
                i.step = 1;
            }
            wi.max = reg().w;
            hi.max = reg().h;
            let walls = true, src = "", iteratorChoice = null;
            const imageButton = button("选择迭代器图标", () => {
                if (window.OCIteratorIcons) window.OCIteratorIcons.pick({
                    project: bridge.getProject(),
                    onChoose: (model, doc) => {
                        iteratorChoice = {
                            iteratorIcon: model,
                            iteratorDocId: doc?.id || "",
                            iteratorColorMode: "white"
                        };
                        src = "";
                        imageButton.textContent = doc?.title || "替换迭代器图标";
                    }
                }); else chooseImage(value => {
                    src = value;
                    imageButton.textContent = "替换迭代器图标";
                });
            }, "map-full");
            b.append(row(wf, hf), check("生成四周墙体", true, v => {
                walls = v;
                tf.hidden = !v;
            }), tf, nf, imageButton);
            a.append(button("放置框架", () => {
                const ww = +wi.value, hh = +hi.value, thickness = walls ? +ti.value : 0;
                if (![ ww, hh, thickness ].every(Number.isInteger) || ww < 4 || hh < 4 || ww > reg().w || hh > reg().h || thickness < 0 || thickness * 2 >= Math.min(ww, hh)) {
                    err("请使用区域范围内的整数尺寸；墙体厚度须小于短边的一半。");
                    return;
                }
                startNormalRoom();
                pendingRoomType = "ITERATOR";
                pendingRoomPreset = {
                    w: ww,
                    h: hh,
                    thickness: thickness,
                    walls: walls,
                    name: ni.value.trim() || "迭代器演算室",
                    icon: src,
                    ...iteratorChoice
                };
                const p = cutFrame ? {
                    x: cutFrame.x + cutFrame.w / 2,
                    y: cutFrame.y + cutFrame.h / 2
                } : {
                    x: reg().w / 2,
                    y: reg().h / 2
                };
                cutFrame = {
                    x: Math.round(Math.max(0, Math.min(reg().w - ww, p.x - ww / 2))),
                    y: Math.round(Math.max(0, Math.min(reg().h - hh, p.y - hh / 2))),
                    w: ww,
                    h: hh,
                    layer: layerId
                };
                close();
                renderTools();
                draw();
            }, "primary"));
        });
    }
    function startNormalRoom() {
        if (C.isDedicatedLayer(layer())) setLayer(reg().layers.find(l => !C.isDedicatedLayer(l)).id);
        cutMethod = "frame";
        setTool("split");
        cutIntent = "create";
    }
    function beginRoomPreset(type, data, position) {
        if (type === "SHELTER" && !data?.shelterOptions) data = C.shelterPresetData();
        if (data.w > reg().w || data.h > reg().h) throw Error("请先扩大区域至至少 " + data.w + " × " + data.h + " 格，避免截断预设墙体。");
        if (type === "SHELTER" && C.shelterGeometryIssues(data.geometry).length) throw Error("庇护所预设结构异常，不能创建。");
        if (type === "SHELTER" || type === "GATE") {
            const get = type === "SHELTER" ? C.ensureShelterLayer : C.ensureGateLayer;
            change(() => get(reg()));
            const target = get(reg());
            if (target.locked) throw Error(target.name + "已锁定。");
            setLayer(target.id);
        } else if (C.isDedicatedLayer(layer())) setLayer(reg().layers.find(l => !C.isDedicatedLayer(l)).id);
        cutMethod = "frame";
        setTool("split");
        cutIntent = "create";
        pendingRoomType = type;
        pendingRoomPreset = {
            w: data.w,
            h: data.h,
            rained: data
        };
        placeCutFrame(position || {
            x: reg().w / 2,
            y: reg().h / 2
        });
        renderTools();
        draw();
    }
    function shelterIconChoices(value, onChange) {
        const group = el("div", "map-shelter-icon-options"), choices = el("div", "map-shelter-icon-choices"), title = el("div", "map-muted"), buttons = [];
        value = value === null ? null : value === "outer-expanse" ? value : "original";
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", "庇护所图标");
        group.append(title, choices);
        const sync = () => {
            title.textContent = value === null ? "庇护所图标 · 当前使用自定义图标" : "庇护所图标";
            buttons.forEach(([key, b]) => {
                b.setAttribute("aria-pressed", String(value === key));
                b.classList.toggle("is-selected", value === key);
            });
        };
        for (const [key, label] of Object.entries(C.shelterIcons)) {
            const image = el("img"), b = button("", () => {
                if (value === key) return;
                value = key;
                sync();
                onChange(key);
            }, "map-shelter-icon-choice");
            image.src = "rainworld-icons/" + C.shelterIcon(null, {
                roomType: "SHELTER",
                shelterIcon: key
            }) + ".png";
            image.alt = "";
            b.append(image, el("span", "", label));
            choices.append(b);
            buttons.push([ key, b ]);
        }
        sync();
        return group;
    }
    function shelterIconSelection(r, rm) {
        return rm.shelterIcon || (C.shelterIconSource(r, rm) !== "rainworld-icons/shelter-map.png" ? null : "original");
    }
    function shelterIconControls(r, rm, edit) {
        return shelterIconChoices(shelterIconSelection(r, rm), value => {
            edit(() => C.setShelterIcon(r, rm, value));
            renderSide();
            draw();
        });
    }
    function shelterLayoutDialog(existing = null, position = null) {
        if (!reg()) return;
        const r = reg(), target = r.id;
        dialog(existing ? "庇护所 · 图标、尺寸、门与出口" : "新建庇护所", (b, a, close, err) => {
            let shelterIcon = existing ? existing.shelterIcon : "original";
            const options = {
                left: "左侧",
                up: "上侧",
                right: "右侧",
                down: "下侧"
            }, [ff, fi] = select("入口所在侧", existing?.shelterFacing || "left", options), [wf, wi] = input("宽 / 格", existing?.w || 70, "number"), [hf, hi] = input("高 / 格", existing?.h || 40, "number"), [of, oi] = input("出口位置 / 格", existing ? C.shelterLayout(existing).position + 1 : Math.floor(40 / 2) + 1, "number");
            const sync = () => {
                const vertical = [ "up", "down" ].includes(fi.value);
                wi.min = vertical ? 7 : 14;
                hi.min = vertical ? 14 : 7;
                wi.max = r.w;
                hi.max = r.h;
                wi.step = hi.step = oi.step = 1;
                oi.min = 4;
                oi.max = (vertical ? +wi.value : +hi.value) - 3;
                oi.value = Math.max(4, Math.min(+oi.max, +oi.value || 4));
            };
            fi.onchange = wi.onchange = hi.onchange = sync;
            sync();
            b.append(shelterIconChoices(existing ? shelterIconSelection(r, existing) : shelterIcon, value => shelterIcon = value), ff, row(wf, hf), of, note("标准尺寸为 70 × 40 格。可修改长宽；四周实体墙随尺寸同步。入口侧仅调整门机构和内部通道，不旋转已有绘画。左／右侧出口位置从上往下数，上／下侧从左往右数。"));
            a.append(button("取消", close), button(existing ? "应用" : "放置庇护所", () => {
                if (reg()?.id !== target) {
                    err("当前区域已切换，请重新打开。");
                    return;
                }
                const values = {
                    w: +wi.value,
                    h: +hi.value,
                    shelterFacing: fi.value,
                    shelterOffset: +oi.value - 1,
                    shelterIcon: shelterIcon
                };
                if (![ values.w, values.h, values.shelterOffset ].every(Number.isInteger) || values.w < +wi.min || values.h < +hi.min || values.w > r.w || values.h > r.h || +oi.value < 4 || +oi.value > +oi.max) {
                    err("请填写区域范围内的整数尺寸和安全出口位置。");
                    return;
                }
                const apply = geometryOnly => requireEdit(() => {
                    try {
                        if (existing) {
                            let error;
                            const ok = change(() => {
                                try {
                                    C.configureShelter(reg(), existing, {
                                        ...values,
                                        geometryOnly: geometryOnly
                                    });
                                } catch (e) {
                                    error = e;
                                    throw e;
                                }
                            });
                            if (!ok && error) {
                                err(error);
                                return;
                            }
                        } else beginRoomPreset("SHELTER", C.shelterPresetData(values), position?.x !== undefined ? position : null);
                        close();
                        renderSide();
                        draw();
                    } catch (e) {
                        err(e);
                    }
                }, {
                    regionScope: !existing
                });
                if (existing && (values.w !== existing.w || values.h !== existing.h)) requestNativeResize(existing, apply); else apply(false);
            }, "primary"));
        });
    }
    function startShelterRoom(position) {
        shelterLayoutDialog(null, position);
    }
    function startGateRoom() {
        if (!reg()) return;
        gateDialog(null, null, {
            a: {
                region: reg().gateStorageOnly ? "" : reg().id
            },
            b: {
                region: ""
            }
        });
    }
    function portAsset(kind) {
        return "rainworld-icons/" + ({
            exit: "shortcut-room.png",
            internal: "shortcut-internal.png",
            den: "den.png",
            creature: "npc-transport.png",
            scavenger: "scavenger.png"
        }[kind] || "shortcut-room.png");
    }
    function portImage(kind) {
        const im = el("img");
        im.src = portAsset(kind);
        im.alt = "";
        return im;
    }
    const creatureTypes = {
        Lizard: "蜥蜴",
        GreenLizard: "绿蜥蜴",
        Salamander: "蝾螈",
        Vulture: "秃鹫",
        Scavenger: "拾荒者",
        Fly: "蝙蝠蝇"
    };
    const creatureIcons = {
        Lizard: "lizard",
        GreenLizard: "green-lizard",
        Salamander: "salamander",
        Vulture: "vulture",
        Scavenger: "scavenger",
        Fly: "batfly"
    };
    function icon(kind, color = "#cccccc", appearance, custom) {
        const e = el("canvas");
        e.width = e.height = 26;
        const c = e.getContext("2d");
        c.imageSmoothingEnabled = false;
        if (kind === "token") {
            c.fillStyle = color === "#cccccc" ? "#ffc533" : color;
            for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
                const dx = Math.abs(x - 5), dy = Math.abs(y - 5);
                if (dx + dy === 5 || dx <= 1 && dy <= 1) c.fillRect(2 + x * 2, 2 + y * 2, 2, 2);
            }
        } else if (kind === "pearl") OCStudioIcons.pearlMarker(e, {
            ...appearance || {},
            baseColor: appearance?.baseColor || color
        }); else if (kind === "broadcast") OCStudioIcons.broadcast(e, color); else {
            const filename = {
                shelter: "shelter-map",
                gate: "gate",
                echo: "echo-symbol",
                toll: "toll",
                shop: "shop",
                iterator: "iterator",
                creature: custom || "lizard"
            }[kind] || kind;
            const img = getImage("rainworld-icons/" + filename + ".png");
            const paint = () => {
                if (!img.naturalWidth) return;
                const z = Math.min(24 / img.naturalWidth, 24 / img.naturalHeight);
                c.clearRect(0, 0, 26, 26);
                c.drawImage(img, (26 - img.naturalWidth * z) / 2, (26 - img.naturalHeight * z) / 2, img.naturalWidth * z, img.naturalHeight * z);
            };
            if (img.complete) paint(); else img.addEventListener("load", paint, {
                once: true
            });
        }
        return e;
    }
    function iteratorDialog(marker) {
        const icons = window.OCIteratorIcons;
        if (!icons) return;
        const draft = copy(marker);
        dialog("迭代器图标", (b, a, close, err) => {
            const preview = button("", () => icons.pick({
                project: bridge.getProject(),
                color: icons.resolve(draft, libraryDocs).model.color,
                onChoose: (model, doc) => {
                    draft.iteratorIcon = model;
                    draft.iteratorDocId = doc?.id || "";
                    draft.bindingDismissed = !doc;
                    delete draft.icon;
                    refreshIcon();
                }
            }), "map-full"), name = el("span"), image = el("canvas"), editText = button("编辑文字图标", () => {
                const doc = libraryDocs.find(d => d.id === draft.iteratorDocId);
                if (!doc) return;
                apply(() => {
                    close();
                    exit();
                    bridge.openRecord(doc.id);
                });
            }, "map-full");
            image.style.width = "42px";
            image.style.height = "38px";
            image.style.objectFit = "contain";
            image.style.imageRendering = "pixelated";
            preview.setAttribute("aria-label", "更换迭代器图标");
            preview.append(image, name);
            function refreshIcon() {
                const resolved = icons.resolve(draft, libraryDocs), source = icons.mapCanvas(draft, libraryDocs, refreshIcon);
                image.width = source.width;
                image.height = source.height;
                image.getContext("2d").drawImage(source, 0, 0);
                name.textContent = resolved.doc?.title || "更换图标";
                editText.hidden = !resolved.doc;
            }
            function apply(after) {
                const reason = C.lockReason(reg(), marker, "iterator");
                if (reason) {
                    err(reason);
                    return;
                }
                requireEdit(() => {
                    change(() => {
                        marker.iteratorDocId = draft.iteratorDocId || "";
                        marker.bindingDismissed = !!draft.bindingDismissed;
                        marker.iteratorColorMode = draft.iteratorColorMode || "white";
                        if (draft.iteratorIcon) marker.iteratorIcon = copy(draft.iteratorIcon); else delete marker.iteratorIcon;
                        if (draft.icon) marker.icon = draft.icon; else delete marker.icon;
                    });
                    after();
                });
            }
            const binding = el("div", "map-record-binding");
            binding.append(button("检索迭代器词条", () => bindingPicker("iterator", d => {
                if (C.recordKind(d) !== "iterator") {
                    err("请选择迭代器分类中的词条");
                    return;
                }
                draft.iteratorDocId = d.id;
                draft.bindingDismissed = false;
                refreshIcon();
            })), button("解除绑定", () => {
                draft.iteratorDocId = "";
                draft.bindingDismissed = true;
                refreshIcon();
            }));
            b.append(binding, preview, select("地图颜色", draft.iteratorColorMode || "white", {
                white: "白色",
                own: "迭代器自身颜色"
            }, v => {
                draft.iteratorColorMode = v;
                refreshIcon();
            })[0], editText);
            a.append(button("取消", close), button("保存", () => apply(close), "primary"));
            refreshIcon();
        });
    }
    function cachedIcon(o) {
        const d = libraryDocs.find(d => d.id === o.docId), appearance = d?.details?.appearance || o.appearance, color = appearance?.baseColor || o.color || (o.kind === "token" ? o.tokenType === "sandbox" ? "#408dff" : "#ffc533" : "#cccccc");
        let kind = o.kind;
        if (kind === "gate") kind = C.gateIcon(w, sceneId, o);
        const custom = o.kind === "creature" ? creatureIcons[o.creatureType] || "lizard" : null, key = JSON.stringify([ kind, color, appearance, custom ]);
        if (!iconCache.has(key)) iconCache.set(key, icon(kind, color, appearance, custom));
        return iconCache.get(key);
    }
    function mapSymbolImage(o, r = reg()) {
        if (o.kind === "shelter") return getImage(C.shelterIconSource(r, o));
        if ([ "pearl", "broadcast", "token" ].includes(o.kind)) return cachedIcon(o);
        const kind = o.kind === "gate" ? C.gateIcon(w, sceneId, o) : o.kind;
        const file = {
            shelter: C.shelterIcon(r, o),
            gate: "gate",
            echo: "echo-symbol",
            toll: "toll",
            shop: "shop",
            iterator: "iterator",
            creature: creatureIcons[o.creatureType] || "lizard"
        }[kind] || kind;
        return getImage("rainworld-icons/" + file + ".png");
    }
    function getImage(src) {
        if (imageCache.has(src)) return imageCache.get(src);
        const i = new Image;
        i.onload = () => {
            iconCache.clear();
            drawSymbol.clear();
            paintTerrain.clear?.();
            draw();
        };
        i.src = src;
        imageCache.set(src, i);
        return i;
    }
    function symmetryState() {
        return C.symmetryFor(reg(), room());
    }
    function symmetryHit(p, touch = false) {
        if (!reg()) return false;
        const s = symmetryState();
        return (s.x || s.y) && Math.hypot(p.x - s.axisX, p.y - s.axisY) <= (touch ? 20 : 11) / cam.z;
    }
    function editRooms() {
        const r = reg();
        return [ ...r.rooms.filter(o => o.layer !== layerId), ...r.rooms.filter(o => o.layer === layerId) ].reverse().filter(o => canHit(o, "rooms"));
    }
    function regionBox() {
        return drag?.mode === "region-resize" && preview?.type === "region-range" ? preview : {
            x: 0,
            y: 0,
            w: reg().w,
            h: reg().h
        };
    }
    function adjustMenu(anchor) {
        dropdown(anchor, [ [ "房间" + (tool === "room-resize" ? " ✓" : ""), () => setTool("room-resize"), toolGraphic("room-resize") ], [ "区域范围" + (tool === "region-resize" ? " ✓" : ""), () => setTool("region-resize"), toolGraphic("region-resize") ] ]);
    }
    function resizeRegionValue(key, value) {
        requireEdit(() => change(() => C.resizeRegion(w, reg(), {
            x: 0,
            y: 0,
            w: reg().w,
            h: reg().h,
            [key]: value
        })), {
            regionScope: true
        });
    }
    function preserveRegionView(previous) {
        if (world || !reg()) return;
        const old = previous.regions.find(r => r.id === regionId);
        if (!old) return;
        cam.x += ((reg().origin?.x || 0) - (old.origin?.x || 0)) * cam.z;
        cam.y += ((reg().origin?.y || 0) - (old.origin?.y || 0)) * cam.z;
    }
    function resizeHit(p, touch = false) {
        for (const rm of editRooms()) {
            const handle = C.hitRoomHandle(rm, p, (touch ? 18 : 8) / cam.z);
            if (handle) return {
                rm: rm,
                handle: handle
            };
        }
        return null;
    }
    function roomCursor(handle) {
        return {
            nw: "nwse-resize",
            se: "nwse-resize",
            ne: "nesw-resize",
            sw: "nesw-resize",
            n: "ns-resize",
            s: "ns-resize",
            e: "ew-resize",
            w: "ew-resize"
        }[handle] || "default";
    }
    function alignmentMenuItem() {
        return [ "对齐吸附" + (w.settings.snapAlignment !== false ? " ✓" : ""), () => {
            snapGuides = [];
            change(() => w.settings.snapAlignment = w.settings.snapAlignment === false);
            drawOverlay();
        } ];
    }
    function alignBox(box, {handle: handle = "move", excludeId: excludeId = null, excludeContents: excludeContents = false, frame: frame = false, region: region = false, owner: owner = null} = {}) {
        snapGuides = [];
        if (w.settings.snapAlignment === false) return box;
        const r = reg(), options = {
            excludeId: excludeId,
            excludeContents: excludeContents,
            includeRegion: !region,
            sceneId: sceneId,
            symmetry: symmetryState(),
            isDisplayed: o => C.isRoomMarker(o) || contentShown(r, o)
        }, key = [ excludeId, excludeContents, region ].join("|");
        let targets;
        if (drag) {
            drag.snapCache ||= {};
            targets = drag.snapCache[key] || (drag.snapCache[key] = C.snapTargets(r, options));
        } else targets = C.snapTargets(r, options);
        const valid = b => {
            if (![ "x", "y", "w", "h" ].every(k => Number.isInteger(b[k]))) return false;
            if (region) {
                const content = C.regionContentBounds(r);
                return b.w >= Math.min(20, r.w) && b.h >= Math.min(20, r.h) && b.w <= 4096 && b.h <= 4096 && (!content || b.x <= content.x && b.y <= content.y && b.x + b.w >= content.x + content.w && b.y + b.h >= content.y + content.h);
            }
            const bounds = owner || {
                x: 0,
                y: 0,
                w: r.w,
                h: r.h
            };
            if (b.w < 0 || b.h < 0 || b.x < bounds.x || b.y < bounds.y || b.x + b.w > bounds.x + bounds.w || b.y + b.h > bounds.y + bounds.h) return false;
            const source = r.rooms.find(rm => rm.id === excludeId);
            if (source) {
                if (b.w < 1 || b.h < 1 || !C.isDedicatedLayer(r.layers.find(l => l.id === source.layer)) && r.rooms.some(rm => rm.id !== source.id && rm.layer === source.layer && C.intersection(rm, b))) return false;
                if (handle !== "move" && [ ...r.markers, ...r.ports ].some(o => o.roomId === source.id && !C.isRoomMarker(o) && !C.inside(o, b))) return false;
            }
            if (frame && (b.w < 1 || b.h < 1)) return false;
            const shelter = source?.roomType === "SHELTER" ? source : frame && pendingRoomType === "SHELTER" ? {
                shelterFacing: pendingRoomPreset?.rained?.shelterOptions?.shelterFacing || "left"
            } : null;
            if (shelter && handle !== "move") {
                const min = C.shelterMinimumSize(shelter);
                if (b.w < min.w || b.h < min.h) return false;
            }
            return true;
        };
        const result = C.snapBox(box, targets, (touches.size ? 12 : 8) / cam.z, {
            handle: handle,
            valid: valid
        });
        snapGuides = result.guides;
        return result.box;
    }
    function placeCutFrame(p) {
        const r = reg(), ww = Math.min(pendingRoomPreset?.w || 70, r.w), hh = Math.min(pendingRoomPreset?.h || 40, r.h);
        cutFrame = {
            x: Math.round(Math.max(0, Math.min(r.w - ww, p.x - ww / 2))),
            y: Math.round(Math.max(0, Math.min(r.h - hh, p.y - hh / 2))),
            w: ww,
            h: hh,
            layer: layerId,
            ...pendingRoomType === "SHELTER" ? {
                roomType: "SHELTER",
                shelterFacing: pendingRoomPreset?.rained?.shelterOptions?.shelterFacing || "left"
            } : {}
        };
        cutFrame = alignBox(cutFrame, {
            frame: true
        });
    }
    function confirmCutFrame() {
        if (!cutFrame) return;
        if (cutIntent === "create" && (pendingRoomType === "SHELTER" || layer()?.kind === "shelter") && !pendingRoomPreset?.rained) {
            startShelterRoom({
                x: cutFrame.x + cutFrame.w / 2,
                y: cutFrame.y + cutFrame.h / 2
            });
            return;
        }
        const box = copy(cutFrame), hits = reg().rooms.filter(rm => rm.layer === box.layer && C.intersection(rm, box)), finish = merge => requireEdit(() => {
            let accepted = false;
            change(() => {
                const type = layer()?.kind === "shelter" ? "SHELTER" : layer()?.kind === "gate" ? "GATE" : pendingRoomType, rm = cutIntent === "partition" ? C.partitionRoom(reg(), box) : merge ? C.mergeRoomFrame(reg(), box) : C.addRoom(reg(), box);
                if (type === "SHELTER" && pendingRoomPreset?.rained?.shelterOptions) Object.assign(rm, pendingRoomPreset.rained.shelterOptions);
                if (type) C.setRoomKind(w, reg(), rm, type);
                if (pendingRoomPreset?.rained) {
                    let data = pendingRoomPreset.rained;
                    if (type === "SHELTER") data = C.shelterPresetData({
                        ...data.shelterOptions,
                        w: box.w,
                        h: box.h
                    }); else if (box.w !== data.w || box.h !== data.h) throw Error("请保持预设尺寸放置；放置后可用调整工具改变大小。");
                    C.replaceRoomFromRained(w, reg(), rm.id, data);
                }
                if (pendingRoomType === "ITERATOR") C.iteratorRoomFrame(reg(), rm, pendingRoomPreset || {});
                selection = {
                    list: "rooms",
                    id: rm.id
                };
                if (type === "GATE" && cutIntent === "create") normalizeEditedGate(reg(), rm, {
                    keepRegion: batchCreateEnabled(),
                    draft: pendingRoomPreset?.sharedGateDraft
                });
                accepted = true;
            });
            if (accepted) {
                cutFrame = null;
                snapGuides = [];
                if (batchCreateEnabled() && cutIntent === "create" && !pendingGateConnection) {
                    pendingRoomPreset = {
                        ...pendingRoomPreset,
                        w: box.w,
                        h: box.h
                    };
                    tool = "split";
                } else {
                    pendingRoomType = null;
                    pendingRoomPreset = null;
                    tool = "select";
                }
                renderTools();
                renderSide();
                draw();
                if (pendingGateConnection) {
                    const m = reg().markers.find(m => m.roomId === selection.id && m.kind === "gate");
                    if (m) resumeGateConnection(m);
                }
            }
        });
        if (cutIntent === "partition" || !hits.length) {
            finish(false);
            return;
        }
        if (batchCreateEnabled()) {
            toast("新房间与已有房间重叠，请换一个位置；拖动已有房间可调整位置。");
            return;
        }
        const plan = C.roomFrameMergePlan(reg(), box);
        dialog("合并重叠房间", (b, a, close) => {
            b.append(note(plan.hits.map(rm => rm.name).join("、")));
            a.append(button("取消", close), button("合并", () => {
                close();
                finish(true);
            }, "primary"));
        });
    }
    function splitPreview(rm, p) {
        const vertical = splitVertical, size = vertical ? rm.w : rm.h;
        if (size < 2) return null;
        return {
            type: "split",
            roomId: rm.id,
            vertical: vertical,
            at: Math.max(1, Math.min(size - 1, Math.round(vertical ? p.x - rm.x : p.y - rm.y)))
        };
    }
    function cancelDrag() {
        restoreBatchMove(drag);
        resetPortPlacement();
        if (drag?.refs) multiSelection = copy(drag.refs);
        hoverRegionTitleId = null;
        downPointer = null;
        snapGuides = [];
        if (drag?.before) w = drag.before;
        if (drag?.frameBefore) cutFrame = drag.frameBefore;
        drag = null;
        preview = null;
    }
    function uiTextScale() {
        return window.OCUIPreferences?.scale || 1;
    }
    function mapFontFamily() {
        return OCMapExport.fontFamily(w?.settings);
    }
    function loadMapFont() {
        return document.fonts?.load("18px " + mapFontFamily(), "区域 INDUSTRIAL COMPLEX").then(() => {
            labelLayoutCache = null;
            draw();
        }).catch(() => toast("地图字体加载失败，请确认离线包已完整解压。"));
    }
    function rawRegionLabelMetrics(c, r, z) {
        const scale = Math.min(uiTextScale(), compactUI() ? 1.15 : 1.5), title = (compactUI() ? 16 : 18) * scale / z, english = (compactUI() ? 11 : 12) * scale / z;
        c.font = title + "px " + mapFontFamily();
        const a = c.measureText(r.name).width;
        c.font = english + "px " + mapFontFamily();
        const b = c.measureText(r.english || "").width, width = Math.max(a, b, 40 * scale / z);
        let bottom = -8 / z;
        for (const marker of r.markers) {
            if (!visible(r, marker, marker.kind)) continue;
            const half = markerSize(marker, true, z) / z / 2;
            if (marker.x + half >= 0 && marker.x - half <= width) bottom = Math.min(bottom, marker.y - half - 8 / z);
        }
        const height = 42 * scale / z;
        return {
            title: title,
            english: english,
            width: width,
            top: bottom - height,
            bottom: bottom,
            shift: bottom - 2 * scale / z,
            scale: scale
        };
    }
    function worldLabelLayout(c, z) {
        c.font = "12px " + mapFontFamily();
        const regions = scene().regions.map(id => w.regions.find(r => r.id === id)).filter(Boolean), key = JSON.stringify([ sceneId, z, uiTextScale(), compactUI(), iconScale(), mapFontFamily(), c.measureText("Map").width, scene().placements ]);
        if (labelLayoutCache?.workspace === w && labelLayoutCache.key === key) return labelLayoutCache.value;
        const obstacles = [], result = new Map, placed = [], gap = 4 / z;
        for (const r of regions) {
            const at = scene().placements[r.id] || {
                x: 0,
                y: 0
            };
            for (const rm of r.rooms) if (rm.visible !== false && r.layers.find(l => l.id === rm.layer)?.visible !== false && ![ "GATE", "SHELTER" ].includes(rm.roomType)) obstacles.push({
                x: at.x + rm.x - gap,
                y: at.y + rm.y - gap,
                w: rm.w + gap * 2,
                h: rm.h + gap * 2
            });
            for (const marker of r.markers) if (visible(r, marker, marker.kind)) {
                const half = markerSize(marker, true, z) / z / 2;
                obstacles.push({
                    x: at.x + marker.x - half - gap,
                    y: at.y + marker.y - half - gap,
                    w: half * 2 + gap * 2,
                    h: half * 2 + gap * 2
                });
            }
            if (!r.rooms.length) for (const shape of r.shapes) {
                const b = C.bounds(shape);
                obstacles.push({
                    x: at.x + b.x - gap,
                    y: at.y + b.y - gap,
                    w: b.w + gap * 2,
                    h: b.h + gap * 2
                });
            }
        }
        const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        for (const r of [ ...regions ].sort((a, b) => (scene().placements[a.id]?.y || 0) - (scene().placements[b.id]?.y || 0))) {
            const at = scene().placements[r.id] || {
                x: 0,
                y: 0
            }, m = rawRegionLabelMetrics(c, r, z), box = {
                x: at.x - gap,
                y: at.y + m.top - gap,
                w: m.width + gap * 2,
                h: m.bottom - m.top + gap * 2
            };
            let offset = 0;
            const blockers = [ ...obstacles, ...placed ];
            for (let n = 0; n <= blockers.length; n++) {
                const hits = blockers.filter(b => overlaps({
                    ...box,
                    y: box.y + offset
                }, b));
                if (!hits.length) break;
                offset = Math.min(...hits.map(b => b.y - box.y - box.h - gap));
            }
            const adjusted = {
                ...m,
                top: m.top + offset,
                bottom: m.bottom + offset,
                shift: m.shift + offset
            };
            placed.push({
                ...box,
                y: box.y + offset
            });
            result.set(r.id, adjusted);
        }
        labelLayoutCache = {
            workspace: w,
            key: key,
            value: result
        };
        return result;
    }
    function regionLabelMetrics(c, r, z) {
        return world ? worldLabelLayout(c, z).get(r.id) || rawRegionLabelMetrics(c, r, z) : rawRegionLabelMetrics(c, r, z);
    }
    function paintRegionLabel(c, r, z) {
        c.save();
        const m = regionLabelMetrics(c, r, z), scale = m.scale, offset = scale / z, shadow = C.regionLabelColor(w, r);
        c.translate(0, m.shift);
        const label = (text, font, y) => {
            c.font = font + "px " + mapFontFamily();
            if (r.labelShadow !== false) {
                c.fillStyle = shadow;
                c.fillText(text, offset, y + offset);
            }
            c.fillStyle = "#ffffff";
            c.fillText(text, 0, y);
        };
        label(r.name, m.title, -24 * scale / z);
        label(r.english || "", m.english, -7 * scale / z);
        c.globalAlpha = .6;
        c.lineWidth = 1 / z;
        for (const [color, shift] of r.labelShadow === false ? [ [ "#ffffff", 0 ] ] : [ [ shadow, offset ], [ "#ffffff", 0 ] ]) {
            c.strokeStyle = color;
            c.beginPath();
            c.moveTo(shift, -2 * scale / z + shift);
            c.lineTo(m.width + shift, -2 * scale / z + shift);
            c.stroke();
        }
        c.restore();
    }
    function styleRegionTitle(node, r) {
        node.classList.add("map-region-title");
        node.style.color = "#ffffff";
        node.style.setProperty("--region-title-shadow", r.labelShadow === false ? "transparent" : C.regionLabelColor(w, r));
        node.style.fontFamily = mapFontFamily();
        return node;
    }
    function fillRegionTitle(node, r) {
        styleRegionTitle(node, r);
        node.replaceChildren(el("span", "map-region-chinese", r.name), el("small", "map-region-english", r.english || ""));
        return node;
    }
    function setRegionTitleHover(id) {
        if (id === hoverRegionTitleId) return;
        hoverRegionTitleId = id;
        drawOverlay();
    }
    function drawRegionTitleHover(svg) {
        if (!hoverRegionTitleId || !ctx) return;
        const r = w.regions.find(r => r.id === hoverRegionTitleId);
        if (!r || !scene().regions.includes(r.id)) return;
        const p = scene().placements[r.id] || {
            x: 0,
            y: 0
        };
        ctx.save();
        const m = regionLabelMetrics(ctx, r, cam.z);
        ctx.restore();
        const x = (p.x - 4 / cam.z) * cam.z + cam.x, y = (p.y + m.top - 2 / cam.z) * cam.z + cam.y, width = m.width * cam.z + 10, height = (m.bottom - m.top) * cam.z + 4, k = 7, path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M" + (x + k) + " " + y + "H" + x + "V" + (y + k) + " M" + (x + width - k) + " " + y + "H" + (x + width) + "V" + (y + k) + " M" + x + " " + (y + height - k) + "V" + (y + height) + "H" + (x + k) + " M" + (x + width - k) + " " + (y + height) + "H" + (x + width) + "V" + (y + height - k));
        path.setAttribute("class", "map-title-hover");
        svg.append(path);
    }
    function paintWorldLabels(c, z) {
        for (const id of scene().regions) {
            const r = w.regions.find(r => r.id === id), p = scene().placements[id] || {
                x: 0,
                y: 0
            };
            c.save();
            c.translate(p.x, p.y);
            paintRegionLabel(c, r, z);
            c.restore();
        }
    }
    function hitRegionLabel(p) {
        if (!world || !ctx) return null;
        ctx.save();
        try {
            for (const id of [ ...scene().regions ].reverse()) {
                const r = w.regions.find(r => r.id === id), at = scene().placements[id] || {
                    x: 0,
                    y: 0
                }, m = regionLabelMetrics(ctx, r, cam.z);
                if (C.inside(p, {
                    x: at.x - 4 / cam.z,
                    y: at.y + m.top,
                    w: m.width + 8 / cam.z,
                    h: m.bottom - m.top
                })) return r;
            }
            return null;
        } finally {
            ctx.restore();
        }
    }
    function regionLabelControls(n, update) {
        n.append(select("阴影配色", w.settings.regionLabelMode || "color", {
            color: "独立颜色",
            uniform: "统一颜色"
        }, v => {
            change(() => w.settings.regionLabelMode = v);
            update();
        })[0]);
        if (w.settings.regionLabelMode === "uniform") n.append(input("统一阴影颜色", w.settings.regionLabelColor || "#ffffff", "color", v => {
            change(() => w.settings.regionLabelColor = v);
            update();
        })[0]);
    }
    function regionRecordPicker(r, done) {
        return bindingPicker("region", doc => {
            change(() => {
                r.textDocId = doc.id;
                r.bindingDismissed = false;
            });
            synchronizeRecords();
            done();
        });
    }
    let portPlacement = null, portPlacementCache = null;
    function resetPortPlacement() {
        portPlacement = null;
        portPlacementCache = null;
    }
    function portPlacementOptions() {
        return {
            snap: true,
            searchRadius: Math.max(1, Math.min(4, 14 / Math.max(.1, cam.z)))
        };
    }
    function suggestEditorPort(p, existing = null) {
        const r = reg(), kind = existing?.kind || portKind, rm = existing ? C.portRoomOwner(r, existing) : roomAt(p), proposal = {
            ...existing || {},
            x: p.x,
            y: p.y,
            kind: kind,
            layer: existing?.layer || layerId,
            roomId: rm?.id || null,
            facing: "auto"
        };
        if (!rm || !C.inside(p, rm)) return {
            valid: false,
            reason: "请在房间内放置通道井。",
            position: p
        };
        const locked = C.lockReason(r, existing || rm, "ports", rm.layer);
        if (locked) return {
            valid: false,
            reason: locked,
            position: p,
            roomId: rm.id
        };
        if (rm.roomType === "SHELTER" && kind === "exit") return {
            valid: false,
            reason: "庇护所的出口请在门与出口设置中调整。",
            position: p
        };
        if (![ "exit", "internal" ].includes(kind)) return {
            valid: true,
            position: {
                x: rm.x + Math.floor(p.x - rm.x) + .5,
                y: rm.y + Math.floor(p.y - rm.y) + .5
            },
            facing: proposal.facing,
            roomId: rm.id,
            preview: null,
            reason: "此类型的游戏逻辑需在 Rained 中设置。"
        };
        let result;
        try {
            if (!portPlacementCache || portPlacementCache.revision !== revision || portPlacementCache.room.id !== rm.id) {
                portPlacementCache = {
                    revision: revision,
                    room: rm,
                    geometry: C.raster(r, rm)
                };
            }
            result = C.suggestPortPlacement(r, proposal, {
                ...portPlacementOptions(),
                geometry: portPlacementCache.geometry
            });
        } catch (error) {
            portPlacementCache = null;
            return {
                valid: false,
                position: p,
                roomId: rm.id,
                reason: "无法预览通道井：" + (error?.message || "请检查房间地形。")
            };
        }
        return result;
    }
    function updatePortPlacement(p) {
        portPlacement = suggestEditorPort(p);
        drawOverlay();
        return portPlacement;
    }
    function placeSuggestedPort() {
        const suggestion = portPlacement;
        if (!suggestion?.valid) {
            toast(suggestion?.reason || "没有可用的入口位置。");
            return;
        }
        const r = reg(), rm = r.rooms.find(o => o.id === suggestion.roomId);
        const ok = change(() => {
            const reason = C.lockReason(r, rm, "ports", rm?.layer || layerId);
            if (reason) throw Error(reason);
            if (!rm) throw Error("请先选择房间。");
            if (r.ports.some(p => p.roomId === rm.id && Math.floor(p.x - rm.x) === Math.floor(suggestion.position.x - rm.x) && Math.floor(p.y - rm.y) === Math.floor(suggestion.position.y - rm.y))) throw Error("这一格已经有通道井。");
            const p = {
                id: C.uid(),
                ...suggestion.position,
                kind: portKind,
                name: C.portKinds[portKind],
                layer: rm.layer,
                roomId: rm.id,
                facing: suggestion.facing || "auto",
                color: "#cccccc",
                sceneIds: []
            };
            r.ports.push(p);
            C.applyPortPlacement(r, p, suggestion);
            r.categories.ports.visible = true;
            r.detailsVisible = true;
            selection = {
                list: "ports",
                id: p.id
            };
        });
        if (ok) {
            resetPortPlacement();
            if (!batchCreateEnabled()) tool = "select";
            sidebar = "tools";
            renderTools();
            renderSide();
            draw();
        }
    }
    function alignExistingPort(r, o, edit) {
        const suggestion = suggestEditorPort(o, o);
        if (!suggestion.valid) {
            toast(suggestion.reason);
            return;
        }
        edit(() => C.applyPortPlacement(r, o, suggestion));
        resetPortPlacement();
        renderSide();
        draw();
        toast("已按实际入口格和朝向对齐。");
    }
    function finishPortDrag(d, p) {
        w = d.before;
        const r = reg(), o = selected(), origin = C.portPose(r, o), suggestion = suggestEditorPort({
            x: origin.x + p.x - d.p.x,
            y: origin.y + p.y - d.p.y
        }, o);
        if (suggestion.valid) change(() => C.applyPortPlacement(r, o, suggestion)); else toast(suggestion.reason);
        resetPortPlacement();
        renderSide();
        draw();
    }
    function portArrowColor() {
        return /^#[\da-f]{6}$/i.test(w?.settings.portArrowColor || "") ? w.settings.portArrowColor : "#65e4d0";
    }
    function drawPortFacing(line, point, pose, radius = portSize() / 2) {
        if (!pose || !pose.dx && !pose.dy) return;
        const p = point(pose), gap = Math.max(radius + 8, cam.z / 2 + 6), start = {
            x: p.x + pose.dx * gap,
            y: p.y + pose.dy * gap
        }, rows = [ "....#....", "....##...", "....###..", "########.", "#########", "########.", "....###..", "....##...", "....#...." ], cells = [], border = new Set, color = portArrowColor(), rgb = color.slice(1).match(/../g).map(n => parseInt(n, 16)), outline = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 < 90 ? "#ffffff" : "#000000";
        rows.forEach((row, y) => [ ...row ].forEach((v, x) => {
            if (v !== "#") return;
            cells.push([ x, y - 4 ]);
            for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) border.add(x + a + "," + (y - 4 + b));
        }));
        const path = cells => cells.map(([x, y]) => {
            const cx = start.x + pose.dx * (x * 2 + 1) - pose.dy * y * 2, cy = start.y + pose.dy * (x * 2 + 1) + pose.dx * y * 2;
            return "M" + Math.round(cx - 1) + " " + Math.round(cy - 1) + "h2v2h-2z";
        }).join(""), attrs = {
            "shape-rendering": "crispEdges",
            "pointer-events": "none",
            "aria-hidden": "true"
        };
        line("path", {
            ...attrs,
            d: path([ ...border ].map(v => v.split(",").map(Number))),
            fill: outline
        }, "map-port-facing-outline");
        line("path", {
            ...attrs,
            d: path(cells),
            fill: color
        }, "map-port-facing-arrow");
    }
    function drawPortPlacement(line, point) {
        if (tool !== "port" || !portPlacement?.valid) return;
        const q = point({
            x: portPlacement.position.x - .5,
            y: portPlacement.position.y - .5
        });
        line("rect", {
            x: q.x,
            y: q.y,
            width: cam.z,
            height: cam.z,
            fill: "#ffffff66",
            stroke: "#65e4d0",
            "stroke-width": 1,
            "pointer-events": "none"
        }, "map-port-placement-cell");
        const rm = reg().rooms.find(r => r.id === portPlacement.roomId);
        drawPortFacing(line, point, C.portPose(reg(), {
            ...portPlacement.position,
            kind: portKind,
            roomId: rm?.id,
            layer: rm?.layer,
            facing: portPlacement.facing
        }));
    }
    function drawEditOverlay(line, point) {
        const r = reg(), stroke = w.settings.selectionColor || "#ffffff";
        const outline = (box, handles, cls = "map-room-edit") => {
            const stroke = [ "map-cut-frame", "map-region-edit" ].includes(cls) ? "#ffff00" : w.settings.selectionColor || "#ffffff", p = point(box), attrs = {
                x: p.x,
                y: p.y,
                width: box.w * cam.z,
                height: box.h * cam.z,
                fill: "none"
            };
            line("rect", {
                ...attrs,
                stroke: "#000000",
                "stroke-width": 4
            }, cls);
            line("rect", {
                ...attrs,
                stroke: stroke,
                "stroke-width": 1.5
            }, cls);
            if (handles) for (const p of Object.values(C.roomHandlePoints(box))) {
                const q = point(p);
                line("rect", {
                    x: q.x - 4,
                    y: q.y - 4,
                    width: 8,
                    height: 8,
                    fill: "#000000",
                    stroke: stroke,
                    "stroke-width": 1.5
                }, "map-room-handle");
            }
        };
        if (tool === "room-resize") for (const rm of editRooms()) outline(rm, true);
        if (tool === "region-resize") outline(regionBox(), true, "map-region-edit");
        if (cutFrame && tool === "split") outline(cutFrame, true, "map-cut-frame");
        if (preview?.type === "split") {
            const rm = r.rooms.find(o => o.id === preview.roomId);
            if (rm) {
                const a = point({
                    x: rm.x + (preview.vertical ? preview.at : 0),
                    y: rm.y + (preview.vertical ? 0 : preview.at)
                }), b = point({
                    x: preview.vertical ? rm.x + preview.at : rm.x + rm.w,
                    y: preview.vertical ? rm.y + rm.h : rm.y + preview.at
                });
                line("line", {
                    x1: a.x,
                    y1: a.y,
                    x2: b.x,
                    y2: b.y,
                    stroke: "#000000",
                    "stroke-width": 4
                });
                line("line", {
                    x1: a.x,
                    y1: a.y,
                    x2: b.x,
                    y2: b.y,
                    stroke: stroke,
                    "stroke-width": 2,
                    "stroke-dasharray": "6 4"
                }, "map-cut-line");
            }
        }
        const sizeBox = (tool === "region-resize" ? regionBox() : null) || cutFrame || ([ "room-resize" ].includes(drag?.mode) ? selected() : null);
        if (sizeBox) {
            const p = point(sizeBox);
            const text = line("text", {
                x: p.x + sizeBox.w * cam.z / 2,
                y: p.y - 10,
                "text-anchor": "middle",
                fill: stroke,
                stroke: "#000000",
                "stroke-width": 3,
                "paint-order": "stroke",
                "font-size": 12
            }, "map-room-size");
            text.textContent = sizeBox.w + " × " + sizeBox.h + " 格";
        }
        const s = symmetryState(), box = room() || {
            x: 0,
            y: 0,
            w: r.w,
            h: r.h
        };
        if (s.x || s.y) {
            const axis = (a, b) => {
                const p = point(a), q = point(b), attrs = {
                    x1: p.x,
                    y1: p.y,
                    x2: q.x,
                    y2: q.y,
                    "stroke-dasharray": "7 5"
                };
                line("line", {
                    ...attrs,
                    stroke: "#000000",
                    "stroke-width": s.axisWidth + 2
                });
                line("line", {
                    ...attrs,
                    stroke: s.axisColor,
                    "stroke-width": s.axisWidth
                }, "map-symmetry-axis");
            };
            if (s.x) axis({
                x: box.x,
                y: s.axisY
            }, {
                x: box.x + box.w,
                y: s.axisY
            });
            if (s.y) axis({
                x: s.axisX,
                y: box.y
            }, {
                x: s.axisX,
                y: box.y + box.h
            });
            const p = point({
                x: s.axisX,
                y: s.axisY
            });
            line("circle", {
                cx: p.x,
                cy: p.y,
                r: 8,
                fill: "#000000",
                stroke: s.axisColor,
                "stroke-width": s.axisWidth
            }, "map-symmetry-grip");
            line("path", {
                d: "M" + (p.x - 4) + " " + p.y + "h8M" + p.x + " " + (p.y - 4) + "v8",
                stroke: s.axisColor,
                "stroke-width": 1.5
            });
        }
        if (playerScale && cursorPoint) {
            const p = point(cursorPoint);
            line("image", {
                href: "rainworld-icons/player-scale.png",
                x: p.x - 20 * cam.z / 20,
                y: p.y - 36 * cam.z / 20,
                width: 40 * cam.z / 20,
                height: 40 * cam.z / 20
            }, "map-player-scale");
        }
    }
    function drawOverlay() {
        updateRoomSelectionActions();
        const svg = $("mapOverlay");
        if (!svg) return;
        svg.replaceChildren();
        if (cleanPreview) return;
        drawLinkOverlay(svg);
        if (world) {
            drawRegionTitleHover(svg);
            drawRegionHover(svg);
            drawWorldSelection(svg);
            return;
        }
        if (!reg()) return;
        const r = reg(), line = (tag, attrs, cls) => {
            const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
            for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
            if (cls) e.setAttribute("class", cls);
            svg.append(e);
            return e;
        };
        const point = p => ({
            x: p.x * cam.z + cam.x,
            y: p.y * cam.z + cam.y
        });
        if (r.detailsVisible !== false && r.categories.connections.visible) {
            for (const link of r.links) {
                if (selection?.list === "links" && selection.id === link.id) continue;
                const a = r.ports.find(p => p.id === link.a), b = r.ports.find(p => p.id === link.b);
                if (!a || !b || !C.roomVisible(r, a) || !C.roomVisible(r, b)) continue;
                const va = r.layers.find(l => l.id === a.layer)?.visible !== false, vb = r.layers.find(l => l.id === b.layer)?.visible !== false;
                if (!va && !vb) continue;
                const p = point(C.portPose(r, a)), q = point(C.portPose(r, b)), mid = (p.x + q.x) / 2;
                line("path", {
                    d: "M" + p.x + " " + p.y + " C" + mid + " " + p.y + " " + mid + " " + q.y + " " + q.x + " " + q.y,
                    opacity: (va && vb ? 1 : .35) * Math.min(C.objectOpacity(r, a), C.objectOpacity(r, b))
                }, "map-flow");
            }
        }
        if (tool !== "region-resize" && hoverRoomId && selection?.id !== hoverRoomId) {
            const rm = r.rooms.find(o => o.id === hoverRoomId);
            if (rm && rm.visible !== false) {
                const p = point(rm);
                line("rect", {
                    x: p.x,
                    y: p.y,
                    width: rm.w * cam.z,
                    height: rm.h * cam.z
                }, "map-room-hover");
            }
        }
        drawEditOverlay(line, point);
        drawPortPlacement(line, point);
        drawActiveSelection(line, point);
        drawRoomWarnings(r, line, point);
        const shelterRoom = room() || (selection?.list === "rooms" ? selected() : null), editable = shelterRoom && C.shelterEditableBounds(shelterRoom);
        if (editable) {
            const p = point(editable);
            line("rect", {
                x: p.x,
                y: p.y,
                width: editable.w * cam.z,
                height: editable.h * cam.z,
                fill: "none",
                stroke: w.settings.invert ? "#00acac" : "#ff5353",
                "stroke-width": 2,
                "pointer-events": "none"
            });
        }
        if (w.settings.snapAlignment !== false) for (const g of snapGuides) {
            const a = point(g.axis === "x" ? {
                x: g.value,
                y: g.lo
            } : {
                x: g.lo,
                y: g.value
            }), b = point(g.axis === "x" ? {
                x: g.value,
                y: g.hi
            } : {
                x: g.hi,
                y: g.value
            }), attrs = {
                x1: a.x,
                y1: a.y,
                x2: b.x,
                y2: b.y,
                "stroke-dasharray": "4 4"
            };
            line("line", {
                ...attrs,
                stroke: "#000000",
                "stroke-width": 3
            });
            line("line", {
                ...attrs,
                stroke: "#ffffff",
                "stroke-width": 1
            }, "map-snap-guide");
        }
    }
    function section(title) {
        const e = el("section", "map-section");
        e.append(el("h3", "", title));
        return e;
    }
    function mount() {
        if (host || !window.OCMapBridge) return;
        bridge = window.OCMapBridge;
        host = el("section");
        host.id = "mapEditor";
        host.hidden = true;
        host.innerHTML = `<header class="map-top"><button id="mapProject" class="project-switcher" title="切换项目"></button><div class="map-header-actions"><span id="mapSaved">已保存</span><button id="mapSave" title="手动保存 · Ctrl+S">保存</button><button id="mapDisplaySettings" class="pixel-display-settings" aria-label="界面设置" aria-haspopup="dialog"></button><button id="mapSearch" aria-label="检索">检索</button><button id="mapPanel" aria-expanded="false" aria-controls="mapSide">面板</button><button id="mapMenu" class="more-button" aria-label="区域菜单" aria-haspopup="dialog">⋯</button></div></header><div class="map-subbar"><div class="map-crumb"><button id="mapTimeline" title="切换地图"></button><span>/</span><button id="mapWorld">世界地图</button><span id="mapRegionDivider">/</span><button id="mapRegionCrumb"></button><button id="mapRoomCrumb"></button></div></div><div class="map-body"><div class="map-stage" id="mapStage"><canvas id="mapCanvas" tabindex="0" role="img" aria-label="地图画布"></canvas><div id="mapWarningCorner" class="map-warning-corner"><button id="mapWarnings" aria-haspopup="dialog">房间警告</button></div><div id="mapRoomSelectionActions" class="map-room-selection-actions" hidden><button id="mapMergeRooms">合并房间</button><div id="mapContentSelectionActions" hidden></div><span id="mapMergeReason" class="map-muted" hidden></span></div><div class="map-float" id="mapUndo"><span class="handle" id="mapUndoHandle" title="拖动撤回恢复栏">⠿</span><button id="mapUndoBtn" aria-label="撤回" title="Ctrl Z">↶</button><button id="mapRedoBtn" aria-label="恢复" title="Ctrl Y">↷</button></div><div class="map-zoom" id="mapZoom" hidden><button id="mapZoomOut" aria-label="缩小">−</button><span id="mapZoomValue">100%</span><button id="mapZoomIn" aria-label="放大">＋</button><button id="mapFit">显示全图</button></div><svg id="mapOverlay" aria-hidden="true"></svg><div id="mapLayerSwitch" class="map-layer-switch"></div><div class="map-dock" id="mapDock"><button id="mapDockFold" aria-label="收起工具栏" aria-expanded="true">▸</button><nav id="mapTools" aria-label="绘图工具"></nav><div id="mapCrossRoomControl"></div><button id="mapBackground">背景</button><div id="mapLayerCreate" class="map-layer-create" aria-label="图层操作"></div><button id="mapDisplay">显示</button><button id="mapUnlockAll" title="解锁当前区域全部图层、房间和对象" aria-label="全部解锁">解锁</button><button id="mapAssist" aria-label="绘图辅助" title="绘图辅助">⋯</button></div><div class="map-empty" id="mapEmpty" hidden><button id="mapFirstRegion">新建区域</button></div></div><aside class="map-side" id="mapSide"><button id="mapSideResize" aria-label="拖动调整面板大小" aria-valuemin="20" aria-valuemax="70" aria-valuenow="30" role="slider"><span></span></button><nav class="map-side-tabs"><button data-side="tools">属性</button><button data-side="layers">图层</button><button data-side="objects">对象</button><button id="mapSideClose" aria-label="关闭面板">×</button></nav><div class="map-side-content" id="mapSideContent"></div></aside></div><div hidden><select id="mapScene"></select><button id="mapScenes"></button><button id="mapReference"></button><button id="mapMore"></button><button id="mapExport"></button><button id="mapPreview"></button><button id="mapNew"></button><button id="mapProperties"></button><span id="mapCanvasLabel"></span><span id="mapHint"></span></div><div id="mapToast" class="map-toast" role="status" hidden></div>`;
        const tabs = $("bottomTabs");
        tabs.before(host);
        $("regionsTab").onclick = () => enter();
        for (const id of [ "imagesTab", "textsTab" ]) $(id).addEventListener("click", exit);
        $("mapProject").onclick = projectMenu;
        $("mapMenu").onclick = mainMenu;
        $("mapSearch").onclick = searchFeatures;
        $("mapSave").onclick = manualSave;
        $("mapDisplaySettings").append(window.OCUIPreferences.gear());
        $("mapDisplaySettings").onclick = () => window.OCUIPreferences.open();
        $("mapBackground").onclick = backgroundDialog;
        $("mapDisplay").onclick = viewDialog;
        $("mapUnlockAll").onclick = unlockAll;
        $("mapAssist").onclick = () => {
            const items = [ [ "玩家比例" + (playerScale ? " ✓" : ""), () => {
                playerScale = !playerScale;
                cursorPoint = null;
                canvas.style.cursor = playerScale ? "none" : "default";
                drawOverlay();
            } ], [ "对称", openSymmetry ], alignmentMenuItem(), [ "参考图", referenceDialog ] ];
            dropdown($("mapAssist"), items);
        };
        $("mapTimeline").onclick = timelinePicker;
        $("mapRoomCrumb").onclick = () => roomSettingsDialog(room());
        $("mapScene").onchange = e => switchScene(e.target.value);
        $("mapScenes").onclick = sceneDialog;
        $("mapReference").onclick = referenceDialog;
        $("mapMore").onclick = settingsDialog;
        $("mapExport").onclick = exportDialog;
        $("mapWorld").onclick = () => {
            world = true;
            roomId = null;
            selection = null;
            refresh();
            fit();
        };
        $("mapRegionCrumb").onclick = $("mapRegionCrumb").ondblclick = () => {
            if (reg()) regionTitleDialog(reg());
        };
        $("mapNew").onclick = () => world ? regionDialog() : newMenu();
        $("mapFirstRegion").onclick = () => regionDialog();
        $("mapProperties").onclick = () => reg() ? regionDialog(reg()) : regionDialog();
        $("mapSideClose").onclick = () => {
            $("mapSide").classList.remove("panel-open");
            $("mapPanel").setAttribute("aria-expanded", "false");
            resize();
        };
        $("mapPanel").onclick = () => {
            const open = !$("mapSide").classList.contains("panel-open");
            if (world) sidebar = "tools";
            renderSide();
            $("mapSide").classList.toggle("panel-open", open);
            $("mapPanel").setAttribute("aria-expanded", String(open));
            resize();
        };
        $("mapPreview").onclick = () => {
            cancelDrag();
            cutFrame = null;
            cleanPreview = !cleanPreview;
            preview = null;
            polygon = [];
            drag = null;
            refresh();
            resize();
        };
        host.querySelectorAll("[data-side]").forEach(e => e.onclick = () => {
            sidebar = e.dataset.side;
            renderSide();
        });
        $("mapUndoBtn").onclick = undo;
        $("mapRedoBtn").onclick = redo;
        $("mapZoomIn").onclick = () => zoom(1.3);
        $("mapZoomOut").onclick = () => zoom(1 / 1.3);
        $("mapFit").onclick = fit;
        canvas = $("mapCanvas");
        ctx = canvas.getContext("2d");
        new ResizeObserver(() => {
            resize();
        }).observe($("mapStage"));
        new ResizeObserver(() => {
            $("mapStage").style.setProperty("--dock-clearance", Math.ceil($("mapDock").getBoundingClientRect().height / (window.OCUIPreferences?.pageScale || 1)) + 28 + "px");
            clampMapFloats();
        }).observe($("mapDock"));
        new ResizeObserver(clampMapFloats).observe($("mapWarningCorner"));
        wireCanvas();
        wireUndo();
        wirePanelResize();
        wireWorkflowFloats();
        window.addEventListener("keydown", keyboard);
        window.addEventListener("keyup", e => {
            if (e.code === "Space") spaceHeld = false;
        });
        window.addEventListener("beforeunload", e => {
            if (!saved || projectDrafts.size) {
                e.preventDefault();
                e.returnValue = "";
            }
        });
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && !saved) toast("地图尚未保存，请保存或导出备份。");
        });
        window.addEventListener("oc-ui-font-change", () => {
            if (active) {
                requestAnimationFrame(() => {
                    resize();
                    draw();
                });
            }
        });
        window.addEventListener("oc-ui-viewport-change", () => {
            if (active) {
                closeDropdown();
                requestAnimationFrame(resize);
            }
        });
        window.addEventListener("oc-project-render", () => {
            if (active && !importing) loadProject().catch(e => toast(e.message));
        });
    }
    async function enter() {
        mount();
        active = true;
        host.hidden = false;
        document.body.classList.add("map-active");
        $("regionsTab").classList.add("active");
        $("regionsTab").setAttribute("aria-current", "page");
        await loadProject();
        resize();
        fit();
    }
    function exit() {
        if (!active) return;
        rememberDraft();
        active = false;
        host.hidden = true;
        document.body.classList.remove("map-active");
        $("regionsTab").classList.remove("active");
        $("regionsTab").removeAttribute("aria-current");
    }
    function switchScene(id) {
        connectStart = null;
        batchPlacement = null;
        pendingGateConnection = null;
        cancelDrag();
        cutFrame = null;
        $("mapSide").classList.remove("panel-open");
        $("mapPanel").setAttribute("aria-expanded", "false");
        sceneId = id;
        w.activeScene = id;
        world = true;
        regionId = null;
        roomId = null;
        selection = null;
        editShared = false;
        history = [];
        future = [];
        refresh();
        fit();
    }
    function openRegion(id) {
        const linking = tool === "link";
        batchPlacement = null;
        hoverRegionId = null;
        hoverRegionTitleId = null;
        cancelDrag();
        cutFrame = null;
        regionId = id;
        roomId = null;
        world = false;
        layerId = reg().layers[0].id;
        selection = null;
        editShared = false;
        tool = linking ? "link" : "select";
        refresh();
        fit();
    }
    function refresh() {
        labelLayoutCache = null;
        presentationCache.clear();
        paintTerrain.clear?.();
        if (!w || !active) return;
        reconcile();
        host.classList.toggle("is-preview", cleanPreview);
        host.classList.toggle("is-world", world);
        host.dataset.toolbar = w.settings.toolbarPosition || "bottom-right";
        $("mapZoom").hidden = !w.settings.showZoom;
        $("mapTimeline").textContent = scene().name;
        $("mapRegionDivider").hidden = world;
        $("mapRegionCrumb").hidden = world;
        $("mapRoomCrumb").hidden = !room();
        $("mapPreview").textContent = cleanPreview ? "返回编辑" : "预览";
        $("mapPanel").hidden = cleanPreview;
        $("mapAssist").hidden = world || cleanPreview;
        $("mapUnlockAll").hidden = world || cleanPreview;
        $("mapReference").hidden = world || cleanPreview;
        $("mapNew").hidden = cleanPreview;
        $("mapScene").replaceChildren(...w.scenes.map(s => new Option(s.name, s.id)));
        $("mapScene").value = sceneId;
        if (reg()) {
            const sharedHere = room() && C.sharedGateForRoom?.(w, regionId, roomId);
            if (sharedHere) {
                $("mapRegionCrumb").textContent = "业力门 · " + gateRegionName(sharedHere.a) + " ↔ " + gateRegionName(sharedHere.b);
                $("mapRegionCrumb").onclick = $("mapRegionCrumb").ondblclick = () => gateDialog(sharedHere);
            } else if (reg().gateStorageOnly) {
                $("mapRegionCrumb").textContent = "待归属房间";
                $("mapRegionCrumb").onclick = $("mapRegionCrumb").ondblclick = () => {
                    world = true;
                    regionId = null;
                    roomId = null;
                    refresh();
                    fit();
                };
            } else {
                fillRegionTitle($("mapRegionCrumb"), reg());
                $("mapRegionCrumb").onclick = $("mapRegionCrumb").ondblclick = () => regionTitleDialog(reg());
            }
        } else $("mapRegionCrumb").replaceChildren();
        const shared = room() && C.sharedGateForRoom?.(w, regionId, roomId);
        $("mapRoomCrumb").textContent = room() ? "/ " + room().name + (shared ? " · " + [ shared.a, shared.b ].map(s => w.regions.find(r => r.id === s.region)?.code || "未绑定").join(" ↔ ") : "") : "";
        $("mapProperties").hidden = world;
        $("mapEmpty").hidden = true;
        $("mapUndo").hidden = false;
        if (w.settings.undoPosition) {
            $("mapUndo").style.left = Math.min(w.settings.undoPosition.x, Math.max(0, $("mapStage").clientWidth - 105)) + "px";
            $("mapUndo").style.top = Math.min(w.settings.undoPosition.y, Math.max(0, $("mapStage").clientHeight - 45)) + "px";
        }
        $("mapUndoBtn").disabled = !history.length;
        $("mapRedoBtn").disabled = !future.length;
        renderTools();
        renderLayerSwitch();
        renderSide();
        updateStatus();
        refreshWorkflowFloats();
        requestAnimationFrame(clampMapFloats);
        draw();
    }
    function updateStatus() {
        if (!host || !w) return;
        $("mapSaved").textContent = saved && !saveError && OCStandalone.persistent ? "已保存" : "未保存";
        $("mapSaved").title = saveError || (!saved ? "修改尚未保存；换设备前请导出 RainOC 备份。" : "");
        $("mapSave").classList.toggle("needs-save", !saved);
        $("mapSaved").setAttribute("aria-live", "polite");
    }
    const toolsList = [ [ "select", "↖", "移动" ], [ "marquee", "▱", "选区" ], [ "fill", "▨", "油漆桶" ], [ "pan", "✥", "平移" ], [ "brush", "╱", "画笔" ], [ "line", "╲", "直线" ], [ "rect", "▭", "矩形" ], [ "ellipse", "○", "圆形" ], [ "polygon", "⬡", "多边形" ], [ "erase", "⌫", "擦除" ], [ "room", "▣", "房间" ], [ "split", "▣", "分割房间" ], [ "room-resize", "▭", "调整房间" ], [ "region-resize", "▭", "区域范围" ], [ "marker", "◇", "标记" ], [ "port", "⊡", "通道井" ], [ "link", "┄", "连接" ] ];
    function setTool(v) {
        const keepLink = tool === "link" && v === "link";
        batchPlacement = null;
        selectionMessage = "";
        selectionMoveArmed = false;
        const selectionTarget = v === "room-select" ? "rooms" : v === "marquee" ? "contents" : null;
        if (v === "room-select") v = "marquee";
        cutIntent = "partition";
        pendingGateConnection = null;
        $("mapRecordCard")?.remove();
        resize();
        $("mapSideContent").scrollTop = 0;
        cancelDrag();
        if (selectionTarget) {
            if (tool !== "marquee" || marqueeTarget !== selectionTarget) {
                multiSelection = [];
                selectionBox = null;
            }
            marqueeTarget = selectionTarget;
        }
        pendingRoomType = null;
        pendingRoomPreset = null;
        playerScale = false;
        if (canvas) canvas.style.cursor = "default";
        tool = v;
        if (v !== "select") selection = null;
        if (v !== "marquee") {
            multiSelection = [];
            selectionBox = null;
        }
        if ([ "split", "room-resize", "region-resize" ].includes(v) || v === "marquee" && marqueeTarget === "rooms") {
            roomId = null;
            selection = null;
        }
        cutFrame = null;
        if (v === "split" && cutMethod === "frame" && reg()) {
            const vs = canvas ? viewSize() : null;
            placeCutFrame(vs ? toWorld({
                x: vs.w / 2,
                y: vs.h / 2
            }) : {
                x: reg().w / 2,
                y: reg().h / 2
            });
        }
        brushExpanded = false;
        polygon = [];
        if (!keepLink) connectStart = null;
        preview = null;
        presentationCache.clear();
        sidebar = "tools";
        if (v === "link" && !world && reg()) change(() => {
            reg().detailsVisible = true;
            reg().categories.ports.visible = true;
            reg().categories.connections.visible = true;
        });
        renderTools();
        renderSide();
        draw();
        if (v === "polygon") toast("依次点击顶点，双击或按 Enter 闭合；Esc 取消。");
        if (v === "link") toast("依次点击两个通道井建立连接。");
    }
    function toolGraphic(name) {
        if ([ "erase", "port" ].includes(name)) {
            const im = el("img", "map-tool-image");
            im.src = name === "erase" ? "rainworld-icons/air.png" : portAsset(portKind);
            im.alt = "";
            return im;
        }
        const sv = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        sv.setAttribute("viewBox", "0 0 24 24");
        sv.setAttribute("class", "map-tool-svg");
        sv.setAttribute("aria-hidden", "true");
        const paths = {
            "room-select": "M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M7 8h10v8H7zM12 8v8",
            marquee: "M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4",
            fill: "M5 4l10 10M10 3L3 10l8 8 8-8-9-7M16 19h6M20 13l-2 3h4z",
            select: "M5 3v16l5-5 4 7 3-2-4-7h7z",
            pan: "M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4",
            brush: "M4 20l3-7L17 3l4 4-10 10-7 3M7 13l4 4",
            line: "M4 20L20 4",
            rect: "M4 5h16v14H4z",
            ellipse: "M12 3a9 9 0 1 0 .01 0",
            polygon: "M5 6l13-2 3 12-10 5-8-7z",
            room: "M3 4h18v16H3zM12 4v16",
            split: "M3 4h18v16H3zM12 2v4m0 3v3m0 3v3m0 3v1",
            "room-resize": "M4 4h16v16H4zM2 2h4v4H2zM18 18h4v4h-4z",
            "region-resize": "M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6M8 8h8v8H8z",
            marker: "M12 3l8 9-8 9-8-9z",
            link: "M3 12h3m3 0h3m3 0h3m3 0h1"
        };
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", paths[name] || paths.brush);
        sv.append(p);
        return sv;
    }
    function menuDialog(title, items) {
        dialog(title, (b, a, close) => {
            b.classList.add("map-menu-list");
            for (const [label, fn] of items) b.append(button(label, () => {
                close();
                fn();
            }, "map-menu-item"));
        });
    }
    function mapContentMenu() {
        sceneDialog();
    }
    function openSymmetry() {
        sidebar = "tools";
        renderSide();
        $("mapSide").classList.add("panel-open");
        const d = $("mapSideContent").querySelector("details.map-symmetry");
        if (d) {
            d.open = true;
            d.scrollIntoView({
                block: "nearest"
            });
        }
        resize();
    }
    function editAssistMenu() {
        const items = [ [ "显示全图", fit ] ];
        if (!world && reg()) items.unshift([ "参考图", referenceDialog ], [ "对称", openSymmetry ], alignmentMenuItem());
        menuDialog("绘图辅助", items);
    }
    function toolDialog(group) {
        dialog(group === "draw" ? "绘制" : "结构", (b, a, close) => {
            const list = group === "draw" ? [ "brush", "line", "rect", "ellipse", "polygon", "erase", "pan" ] : [ "room", "port", "link", "marker" ];
            const grid = el("div", "map-tool-choices");
            for (const key of list) {
                const entry = toolsList.find(t => t[0] === key), btn = button("", () => {
                    close();
                    setTool(key);
                });
                btn.append(toolGraphic(key), document.createTextNode(entry[2]));
                grid.append(btn);
            }
            b.append(grid);
        });
    }
    function timelinePicker() {
        dropdown($("mapTimeline"), w.scenes.map(ss => [ ss.name + (ss.id === sceneId ? " ✓" : ""), () => {
            if (ss.id !== sceneId) switchScene(ss.id);
        } ]));
    }
    function backgroundControl(title, value, onchange) {
        const block = el("div", "map-background-field"), [f, i] = input(title, value, "color", onchange);
        const [hf, hi] = input("自定义色值", value);
        hi.onchange = () => {
            if (/^#[a-f0-9]{6}$/i.test(hi.value)) {
                i.value = hi.value;
                onchange(hi.value);
            } else hi.value = i.value;
        };
        i.onchange = () => {
            hi.value = i.value;
            onchange(i.value);
        };
        block.append(f, row(button("黑", () => {
            i.value = hi.value = "#000000";
            onchange("#000000");
        }), button("白", () => {
            i.value = hi.value = "#ffffff";
            onchange("#ffffff");
        })), hf);
        return block;
    }
    function worldBackgroundDialog() {
        dialog("世界背景", (b, a, close) => {
            b.append(backgroundControl("背景", w.settings.canvasBackground || "#000000", v => change(() => w.settings.canvasBackground = v)));
            a.append(button("完成", close, "primary"));
        });
    }
    function roomSettingsDialog(o) {
        if (!o) return;
        dialog("房间设置 · " + o.name, (b, a, close) => {
            b.append(backgroundControl("房间背景", o.background || "#ffffff", v => requireEdit(() => change(() => o.background = v))), button("编辑尺寸 / 位置", () => {
                close();
                selection = {
                    list: "rooms",
                    id: o.id
                };
                sidebar = "tools";
                renderSide();
                $("mapSide").classList.add("panel-open");
                resize();
            }));
            a.append(button("完成", close, "primary"));
        });
    }
    function fieldNumber(label, val, fn, min = 0, max = 4096) {
        const [box, e] = input(label, val, "number", v => {
            if (Number.isFinite(v) && v >= min && v <= max && Number.isInteger(v)) fn(v); else {
                e.value = val;
                toast("请输入 " + min + "–" + max + " 的整数。");
            }
        });
        e.min = min;
        e.max = max;
        e.step = 1;
        return box;
    }
    function renderSide() {
        if (!w) return;
        updateWarningControl();
        const n = $("mapSideContent");
        for (const d of n.querySelectorAll("details[data-fold-key]")) foldStates.set(d.dataset.foldKey, d.open);
        const scroll = n.scrollTop;
        n.replaceChildren();
        queueMicrotask(() => n.scrollTop = scroll);
        host.querySelectorAll("[data-side]").forEach(e => e.classList.toggle("active", e.dataset.side === sidebar));
        const r = reg();
        host.querySelectorAll("[data-side]").forEach(e => e.hidden = world && e.dataset.side !== "tools");
        if (world) {
            if (tool === "link") renderLinkControls(n);
            const s = fold("世界总览", n, "world-overview", true);
            renderWorldOverview(s);
            const g = fold("区域连接", n, "world-gates", true);
            for (const gate of w.gates.filter(g => g.scenes.includes(sceneId))) g.append(row(visibilityButton(gate.visible !== false, () => change(() => gate.visible = gate.visible === false), "业力门 " + gate.name), button(gateDisplayName(gate), () => openSharedGate(gate), "map-full"), button("⋯", () => gateDialog(gate))));
            return;
        }
        if (!r) return;
        if (sidebar === "layers") {
            renderLayers(n, r);
            return;
        }
        if (sidebar === "objects") {
            renderObjects(n, r);
            return;
        }
        const head = section(room() ? "房间编辑" : "区域绘制");
        n.append(head);
        if (room() && selection?.list !== "rooms") head.append(roomPaintControls(room()));
        if (tool === "link") renderLinkControls(n);
        if ([ "brush", "line", "rect", "ellipse", "polygon", "erase", "fill" ].includes(tool)) {
            const s = section("绘制内容");
            s.append(select("材质", activePaintLayer() ? material === "air" ? "air" : "solid" : material, activePaintLayer() ? {
                solid: "背景",
                air: "擦除"
            } : C.materials, v => {
                material = v;
                renderSide();
            })[0], row(brushWidthControl(), activePaintLayer() ? null : select("几何深度", String(depth), {
                0: "前景 · 1",
                1: "中景 · 2",
                2: "远景 · 3"
            }, v => depth = +v)[0]), document.createTextNode(""));
            renderFavorites(s);
            const advanced = el("details", "map-fold");
            advanced.append(el("summary", "", "笔刷预设"));
            const presets = row();
            for (const [title, m, b, t] of [ [ "粗实心墙", "solid", 8, "brush" ], [ "细通道", "crawl", 1, "line" ], [ "横台阶", "platform", 1, "line" ], [ "水体", "water", 3, "rect" ] ]) presets.append(button(title, () => {
                material = m;
                brush = b;
                tool = t;
                renderTools();
                renderSide();
            }, "small"));
            advanced.append(presets, button("保存当前笔刷预设", () => dialog("保存笔刷", (b, a, close) => {
                const [f, i] = input("名称", "我的笔刷");
                b.append(f);
                a.append(button("保存", () => {
                    change(() => w.presets.push({
                        name: i.value || "笔刷",
                        tool: tool,
                        material: material,
                        brush: brush,
                        depth: depth
                    }));
                    close();
                }, "primary"));
            }), "map-full"));
            for (const p of w.presets) advanced.append(button(p.name, () => {
                ({tool: tool, material: material, brush: brush, depth: depth} = p);
                material = C.normalizeMaterial(material);
                refresh();
            }, "small"));
            s.append(advanced);
            n.append(s);
        }
        if (tool === "marker") {
            const s = section(C.categories[markerKind]);
            s.append(select("类型", markerKind, C.categories, v => {
                markerKind = v;
                pendingMarker = {
                    color: "#cccccc"
                };
                renderSide();
            })[0]);
            if (markerKind === "creature") s.append(select("生物", pendingMarker.creatureType || "Lizard", creatureTypes, v => pendingMarker.creatureType = v)[0]);
            n.append(s);
        }
        if (tool === "port") {
            const s = section("通道井");
            s.append(select("井的类型", portKind, C.portKinds, v => {
                portKind = v;
                resetPortPlacement();
                renderTools();
            })[0]);
            n.append(s);
        }
        if (tool === "room") {
            const s = section("房间切分");
            s.append(note("拖出矩形作为房间边界。一个房间可以包含多个镜头；切分吸附整数格。"), check("显示镜头参考框", r.categories.cameras.visible, v => change(() => r.categories.cameras.visible = v)), button("按 70×40 格铺满空白区域", () => requireEdit(() => change(() => {
                if (r.rooms.length) throw Error("自动铺分用于尚无房间的区域。");
                if (Math.ceil(r.w / 70) * Math.ceil(r.h / 40) > 500) throw Error("区域太大，请手动切分。");
                for (let y = 0; y < r.h; y += 40) for (let x = 0; x < r.w; x += 70) C.addRoom(r, {
                    x: x,
                    y: y,
                    w: Math.min(70, r.w - x),
                    h: Math.min(40, r.h - y),
                    layer: layerId
                });
            })), "map-full"));
            n.append(s);
        }
        if (room() && selection?.id !== room().id) {
            const warning = shelterWarning(r, room());
            if (warning) n.append(warning);
        }
        if (tool === "fill") renderFillOptions(n);
        if (tool === "marquee") renderSelectionActions(n);
        const obj = selected();
        if (obj) renderSelection(n, r, obj);
        const sym = symmetryState(), box = room() || {
            x: 0,
            y: 0,
            w: r.w,
            h: r.h
        }, sy = el("details", "map-section map-fold map-symmetry");
        sy.append(el("summary", "", "对称"));
        sy.open = sym.x || sym.y;
        sy.append(row(check("X 轴 · 上下", sym.x, v => change(() => r.symmetry.x = v)), check("Y 轴 · 左右", sym.y, v => change(() => r.symmetry.y = v))), row(fieldNumber("中心 X", sym.axisX - box.x, v => change(() => C.setSymmetryCenter(r, room(), {
            x: box.x + v,
            y: symmetryState().axisY
        })), 0, box.w), fieldNumber("中心 Y", sym.axisY - box.y, v => change(() => C.setSymmetryCenter(r, room(), {
            x: symmetryState().axisX,
            y: box.y + v
        })), 0, box.h)), row(input("轴线颜色", sym.axisColor, "color", v => change(() => r.symmetry.axisColor = v))[0], fieldNumber("粗细 / px", sym.axisWidth, v => change(() => r.symmetry.axisWidth = v), 1, 8)), button("居中", () => change(() => C.resetSymmetryCenter(r, room()))));
        n.append(sy);
    }
    function renderObjects(n, r) {
        for (const [list, title] of [ [ "markers", "标记" ], [ "ports", "通道井" ], [ "refs", "参考图" ] ]) {
            const group = fold(title, n, "objects:" + list, true);
            for (const o of r[list]) {
                const b = button(o.name || C.categories[o.kind] || C.portKinds[o.kind] || title, () => {
                    tool = "select";
                    selection = {
                        list: list,
                        id: o.id
                    };
                    layerId = o.layer;
                    renderSide();
                    renderTools();
                    renderLayerSwitch();
                    draw();
                }, "map-full");
                b.classList.toggle("active", selection?.id === o.id);
                group.append(b);
                if (selection?.id === o.id) renderSelection(group, r, o);
            }
        }
        const group = fold("通道连接", n, "objects:links");
        for (const link of r.links) {
            group.append(button((r.ports.find(p => p.id === link.a)?.name || "通道井") + " ↔ " + (r.ports.find(p => p.id === link.b)?.name || "通道井"), () => {
                selection = {
                    list: "links",
                    id: link.id
                };
                renderSide();
                draw();
            }, "map-full"));
            if (selection?.id === link.id) renderSelection(group, r, link);
        }
        for (const g of w.gates.filter(g => g.scenes.includes(sceneId))) for (const link of g.connections || []) {
            if (![ link.a, link.b ].some(end => end.region === r.id)) continue;
            const label = [ link.a, link.b ].map(end => {
                const rr = w.regions.find(rr => rr.id === end.region), p = rr?.ports.find(p => p.id === end.port);
                return (rr?.gateStorageOnly ? gateDisplayName(g) : rr?.name || "?") + " · " + (rr?.rooms.find(rm => rm.id === p?.roomId)?.name || "?");
            }).join(" ↔ ");
            group.append(row(button(label, () => openSharedGate(g), "map-full"), button("删除", () => change(() => C.removeSharedGateConnection(w, g.id, link.id)))));
        }
    }
    function renderSelection(n, r, o) {
        const list = selection.list, s = section(list === "rooms" ? "房间" : "属性");
        const edit = fn => {
            const reason = C.lockReason(r, o, list === "shapes" ? cat(o) : list === "markers" ? o.kind : list);
            if (reason) {
                toast(reason + "；可点右下角“全部解锁”。");
                return;
            }
            requireEdit(() => {
                change(fn);
                if (list === "rooms") {
                    layerId = selected()?.layer || room()?.layer || o.layer;
                    renderLayerSwitch();
                    renderSide();
                    draw();
                }
            });
        };
        if (o.name !== undefined && !(list === "rooms" && o.sharedGateId) && !(list === "markers" && [ "pearl", "broadcast", "echo" ].includes(o.kind) && ![ "plain", "colored" ].includes(o.recordMode))) s.append(input(list === "rooms" ? "房间名称" : list === "markers" && o.kind === "gate" ? "昵称" : "名称", o.name, "text", v => edit(() => list === "rooms" ? C.renameRoom(r, o, v) : list === "markers" && o.kind === "gate" ? C.renameGateMarker(w, r.id, o.id, v) : o.name = v))[0]);
        if (list === "rooms") {
            roomNameControls(s, r, o, edit);
            if (o.roomType !== "SHELTER") s.append(button("连接庇护所", () => shelterEntranceDialog(o), "map-full"));
            if (o.roomType === "GATE") s.append(button("业力门与两侧连接", () => {
                const m = r.markers.find(m => m.kind === "gate" && m.roomId === o.id);
                gateDialog(C.sharedGateForRoom?.(w, r.id, o.id), m);
            }, "map-full"));
            s.append(button("Rained 房间覆盖", () => rainedImportDialog(o), "map-full"), button("复制房间", () => copyRoomDialog(o), "map-full"), backgroundControl("空气底色", o.background || "#ffffff", v => edit(() => o.background = v)), button("编辑房间", () => focusRoom(o), "map-full"));
            const more = fold("房间设置", s);
            if ([ "SHELTER", "GATE" ].includes(o.roomType)) more.append(button(o.roomType === "SHELTER" ? "跳转庇护所层级" : "跳转业力门层级", () => {
                setLayer(o.layer);
                sidebar = "layers";
                renderSide();
            }, "map-full"));
            more.append(input("选中高光", w.settings.selectionColor || "#ffffff", "color", v => change(() => w.settings.selectionColor = v))[0], row(button("纵向切分", () => splitDialog(o, true)), button("横向切分", () => splitDialog(o, false))), ...![ "GATE", "SHELTER" ].includes(o.roomType) ? [ button("框选房间合并", () => mergeDialog(o), "map-full") ] : [], fieldNumber("水深 / 格", o.water ?? -1, v => edit(() => o.water = v), -1, o.h));
            const cameras = fold("镜头", s);
            cameras.append(button("编辑镜头位置", () => cameraDialog(o), "map-full"), button("重排镜头", () => edit(() => o.cameras = C.cameras(o.w, o.h)), "map-full"));
        }
        if (list === "shapes") {
            s.append(select("地形", o.material, C.materials, v => {
                edit(() => {
                    o.material = v;
                    o.depth = depth;
                    delete o.rawCell;
                    delete o.erase;
                    delete o.eraseAll;
                    if (v.startsWith("slope")) o.slopeMode = "edge";
                });
                renderSide();
            })[0]);
        }
        if (list === "markers") {
            if (o.kind === "shelter") {
                const rm = r.rooms.find(rm => rm.id === o.roomId && rm.roomType === "SHELTER");
                if (rm) s.append(shelterIconControls(r, rm, edit));
            }
            if (o.kind === "gate" && C.resolveSharedGateRoom?.(w, r.id, o.id)) s.append(button("编辑共享业力门房间", () => openSharedGate(C.resolveSharedGateRoom(w, r.id, o.id).gate), "map-full"), visibilityButton(w.gates.find(g => g.id === o.sharedGateId)?.visible !== false, () => change(() => {
                const g = w.gates.find(g => g.id === o.sharedGateId);
                if (g) g.visible = g.visible === false;
            }), "共享业力门")); else if (C.isRoomMarker(o) && o.roomId) s.append(button(o.kind === "shelter" ? "编辑庇护所房间" : "编辑业力门房间", () => {
                const rm = r.rooms.find(rm => rm.id === o.roomId);
                if (rm) focusRoom(rm);
            }, "map-full"));
            if (!o.sharedGateId) s.append(select("类型", o.kind, C.categories, v => edit(() => {
                o.kind = v;
                delete o.docId;
                delete o.appearance;
            }))[0]);
            if ([ "pearl", "broadcast", "echo" ].includes(o.kind)) s.append(button(o.name + " · 编辑", () => recordDialog(o), "map-full"));
            if (o.kind === "token") s.append(select("解锁类型", o.tokenType || "arena", {
                arena: "竞技场",
                sandbox: "沙盒"
            }, v => edit(() => {
                o.tokenType = v;
                o.color = v === "arena" ? "#ffc533" : "#408dff";
                iconCache.clear();
            }))[0], input("代币颜色", o.color || "#ffc533", "color", v => edit(() => {
                o.color = v;
                iconCache.clear();
            }))[0], input("解锁内容", o.unlockId || "", "text", v => edit(() => o.unlockId = v))[0]);
            if (o.kind === "creature") s.append(select("生物", o.creatureType || "Lizard", creatureTypes, v => edit(() => {
                o.creatureType = v;
                o.name = creatureTypes[v];
            }))[0]);
            if (o.kind === "gate") s.append(button("区域连接", () => gateDialog(w.gates.find(g => g.scenes.includes(sceneId) && (g.a.marker === o.id || g.b.marker === o.id)), o), "map-full"));
            if (o.kind === "iterator") s.append(button("图标与颜色", () => iteratorDialog(o), "map-full"));
            const more = fold("备注与模组 ID", s);
            more.append(input("模组 ID", o.externalId || "", "text", v => edit(() => o.externalId = v))[0], input("备注", o.notes || "", "text", v => edit(() => o.notes = v))[0]);
        }
        if (list === "ports") {
            const shelter = C.shelterAtPort(r, o), owner = r.rooms.find(rm => rm.id === o.roomId), fixed = owner?.roomType === "SHELTER" && o.kind === "exit";
            if (shelter) s.append(shelterIconControls(r, shelter, edit), button("进入 " + shelter.name, () => focusRoom(shelter), "map-full"));
            if (fixed) s.append(shelterIconControls(r, owner, edit), note("庇护所固定出口：入口侧、位置与门机构一起调整。"), button("门与出口设置", () => shelterLayoutDialog(owner), "map-full")); else {
                s.append(select("井的类型", o.kind, C.portKinds, v => {
                    edit(() => o.kind = v);
                    renderSide();
                })[0]);
                if ([ "exit", "internal", "creature" ].includes(o.kind)) s.append(select("洞口朝向", o.facing || "auto", C.portDirections, v => edit(() => o.facing = v))[0], row(button("洞口左转 90°", () => rotatePortDirection(r, o, -1, edit)), button("洞口右转 90°", () => rotatePortDirection(r, o, 1, edit))));
                if ([ "exit", "internal" ].includes(o.kind)) s.append(button("重新对齐入口", () => alignExistingPort(r, o, edit), "map-full"));
            }
            if (o.kind !== "den") s.append(button("连接到另一个井", () => {
                setTool("link");
                connectStart = {
                    region: r.id,
                    port: o.id
                };
                renderTools();
                renderSide();
                draw();
                drawOverlay();
            }, "map-full"));
        }
        if (list === "refs") s.append(button("替换参考图", () => chooseImage(src => edit(() => o.src = src)), "map-full"), input("透明度", o.opacity, "number", v => edit(() => o.opacity = Math.max(0, Math.min(1, Number(v)))))[0], input("旋转", o.angle || 0, "number", v => edit(() => o.angle = Number(v) || 0))[0], lockButton(o.locked, () => change(() => o.locked = !o.locked), "参考图"), check("置顶", o.front, v => change(() => o.front = v)));
        if (o.x !== undefined) {
            const pos = fold("位置与大小", s);
            pos.append(row(fieldNumber("X", Math.round(o.x), v => edit(() => list === "rooms" ? C.moveRoom(r, o, v - o.x, 0) : moveObjectTo(r, o, v, o.y)), 0, r.w), fieldNumber("Y", Math.round(o.y), v => edit(() => list === "rooms" ? C.moveRoom(r, o, 0, v - o.y) : moveObjectTo(r, o, o.x, v)), 0, r.h)));
            if (o.w !== undefined) pos.append(row(fieldNumber("宽 / 格", Math.round(o.w), v => resizeSelectionObject(o, v, o.h, edit), 1, r.w), fieldNumber("高 / 格", Math.round(o.h), v => resizeSelectionObject(o, o.w, v, edit), 1, r.h)));
            if (o.layer) pos.append(select("层级", o.layer, Object.fromEntries(r.layers.map(l => [ l.id, l.name ])), v => edit(() => {
                if (list === "rooms") {
                    if (r.rooms.some(a => a.id !== o.id && a.layer === v && C.intersection(a, o))) throw Error("目标层级有重叠房间。");
                    for (const a of [ ...r.shapes, ...r.markers, ...r.ports, ...r.refs ]) if (a.roomId === o.id) a.layer = v;
                }
                o.layer = v;
                layerId = v;
            }))[0]);
        }
        s.append(button(list === "rooms" ? "删除房间及内容 · Delete" : "删除", () => edit(removeSelected), "map-full"));
        n.append(s);
    }
    function moveObjectTo(r, o, x, y) {
        const rm = o.roomId ? r.rooms.find(rm => rm.id === o.roomId) : null, box = rm || {
            x: 0,
            y: 0,
            w: r.w,
            h: r.h
        };
        if (x < box.x || y < box.y || x + (o.w || 0) > box.x + box.w || y + (o.h || 0) > box.y + box.h) throw Error("位置超出所属房间。");
        C.shift(o, x - o.x, y - o.y);
    }
    function resizeObject(o, ww, hh, options = {}) {
        const r = reg();
        if (selection.list === "rooms") {
            C.resizeRoom(r, o, {
                x: o.x,
                y: o.y,
                w: ww,
                h: hh
            }, options);
            return;
        }
        if (o.x + ww > r.w || o.y + hh > r.h) throw Error("尺寸超出区域范围，请先扩展区域。");
        o.w = ww;
        o.h = hh;
    }
    function removeSelected() {
        const r = reg(), o = selected();
        if (!r || !o) return;
        const list = selection.list, category = list === "shapes" ? cat(o) : list === "markers" ? o.kind : list;
        if (C.roomLocked(r, o) || r.categories[category]?.locked || r.layers.find(l => l.id === o.layer)?.locked) throw Error("此对象所在图层已锁定。");
        if (list === "markers" && o.kind === "gate" && o.sharedGateId) {
            C.removeSharedGate(w, o.sharedGateId, {
                deleteRoom: true
            });
            roomId = null;
            selection = null;
            return;
        }
        const target = list === "rooms" ? o : list === "markers" && o.kind === "gate" ? r.rooms.find(rm => rm.id === o.roomId && rm.roomType === "GATE") : null;
        if (target) {
            C.deleteRoom(w, r, target.id);
            if (roomId === target.id) roomId = null;
            selection = null;
            multiSelection = [];
            selectionBox = null;
            return;
        }
        if (list === "ports") {
            for (const g of w.gates) for (const link of [ ...g.connections || [] ]) if ([ link.a, link.b ].some(ref => ref.region === r.id && ref.port === o.id)) C.removeSharedGateConnection(w, g.id, link.id);
            r.links = r.links.filter(l => l.a !== o.id && l.b !== o.id);
        }
        if (list === "markers") for (const g of w.gates) for (const side of [ "a", "b" ]) if (g[side].marker === o.id) delete g[side].marker;
        r[list] = r[list].filter(a => a.id !== o.id);
        selection = null;
    }
    function splitDialog(o, vertical) {
        dialog("切分 " + o.name, (b, a, close, err) => {
            const max = vertical ? o.w : o.h, [f, i] = input("从" + (vertical ? "左" : "上") + "侧起，第几格切开", Math.floor(max / 2), "number");
            i.min = 1;
            i.max = max - 1;
            b.append(f, document.createTextNode(""));
            a.append(button("切分", () => requireEdit(() => {
                if (change(() => {
                    C.splitRoom(reg(), o, vertical, +i.value);
                    roomId = null;
                })) close();
            }), "primary"));
        });
    }
    function mergeDialog(o) {
        setTool("room-select");
        multiSelection = [ {
            list: "rooms",
            id: o.id
        } ];
        renderTools();
        renderSide();
        drawOverlay();
        toast("框选需要合并的房间，然后点击右下角“合并房间”。");
    }
    function cameraDialog(o) {
        dialog("镜头 · " + o.name, (b, a, close) => {
            const drawRows = () => {
                b.replaceChildren(note("位置为房间内的格坐标；每个渲染框 70×40 格。房间尺寸不必是镜头的整数倍。"));
                for (const camera of o.cameras) {
                    b.append(row(fieldNumber("X", camera.x, v => requireEdit(() => change(() => camera.x = v)), 0, o.w), fieldNumber("Y", camera.y, v => requireEdit(() => change(() => camera.y = v)), 0, o.h), button("移除", () => requireEdit(() => {
                        change(() => o.cameras = o.cameras.filter(c => c.id !== camera.id));
                        drawRows();
                    }))));
                }
                b.append(button("＋ 镜头", () => requireEdit(() => {
                    change(() => o.cameras.push({
                        id: C.uid(),
                        x: 0,
                        y: 0
                    }));
                    drawRows();
                })));
            };
            drawRows();
            a.append(button("完成", close, "primary"));
        });
    }
    function focusRoom(o) {
        const linking = tool === "link";
        if (!linking) setTool("select");
        $("mapSideContent").scrollTop = 0;
        roomId = o.id;
        roomPaintLayer = 0;
        layerId = o.layer;
        selection = linking ? null : {
            list: "rooms",
            id: o.id
        };
        sidebar = "tools";
        refresh();
        resize();
        fit();
    }
    function sceneDialog() {
        dialog("地图设置", (b, a, close, err) => {
            const current = scene(), [nf, ni] = input("地图名称", current.name);
            b.append(nf);
            const shared = fold("共用区域", b), available = w.regions.filter(r => !r.gateStorageOnly && !current.regions.includes(r.id));
            if (available.length) {
                const [f, i] = select("引入区域", available[0].id, Object.fromEntries(available.map(r => [ r.id, r.name ])));
                shared.append(f, button("加入当前地图", () => {
                    change(() => {
                        const ends = current.regions.map(id => {
                            const rr = w.regions.find(r => r.id === id), p = current.placements[id] || {
                                x: 0,
                                y: 0
                            };
                            return p.x + rr.w;
                        });
                        current.regions.push(i.value);
                        current.placements[i.value] = {
                            x: ends.length ? Math.max(...ends) + 40 : 0,
                            y: 0
                        };
                    });
                    close();
                    fit();
                }));
            }
            for (const id of current.regions) {
                const rr = w.regions.find(r => r.id === id), count = w.scenes.filter(ss => ss.regions.includes(id)).length;
                if (count > 1) shared.append(button(rr.name + " · 设为独立", () => {
                    change(() => {
                        const independent = C.forkRegion(w, current, id);
                        if (regionId === id) {
                            regionId = independent.id;
                            roomId = null;
                            selection = null;
                            layerId = independent.layers[0].id;
                            editShared = true;
                        }
                    });
                    close();
                    fit();
                }, "map-full"));
            }
            if (shared.children.length === 1) shared.append(note("没有可共用的区域"));
            if (!world && reg()) {
                const context = fold("当前区域", b);
                context.append(button("区域设置", () => {
                    close();
                    regionDialog(reg());
                }, "map-full"));
                if (room() || selection?.list === "rooms") context.append(button("房间设置", () => {
                    const rm = room() || selected();
                    close();
                    roomSettingsDialog(rm);
                }, "map-full"));
            }
            a.append(button("保存", () => {
                const name = ni.value.trim();
                if (!name) {
                    err("请填写地图名称。");
                    return;
                }
                change(() => current.name = name);
                close();
            }, "primary"));
        });
    }
    function newSceneDialog() {
        dialog("新建地图", (b, a, close, err) => {
            const [nf, ni] = input("名称", "新地图"), [sf, si] = select("内容", "empty", {
                empty: "空白",
                shared: "共用当前地图的区域"
            });
            b.append(nf, sf);
            a.append(button("创建", () => {
                const name = ni.value.trim();
                if (!name) {
                    err("请填写地图名称。");
                    return;
                }
                let id;
                const ok = change(() => {
                    const current = scene(), next = {
                        id: C.uid(),
                        name: name,
                        regions: si.value === "shared" ? [ ...current.regions ] : [],
                        placements: si.value === "shared" ? copy(current.placements) : {}
                    };
                    w.scenes.push(next);
                    id = next.id;
                });
                if (ok) {
                    switchScene(id);
                    close();
                }
            }, "primary"));
        });
    }
    function regionDialog(existing) {
        dialog(existing ? "区域设置" : "新建区域", (b, a, close, err) => {
            const [nf, ni] = input("中文名", existing?.name || ""), [ef, ei] = input("英文名", existing?.english || ""), [wf, wi] = input("最大宽度 / 格", existing?.w || 280, "number"), [hf, hi] = input("最大高度 / 格", existing?.h || 160, "number");
            wi.min = hi.min = 20;
            wi.max = hi.max = 4096;
            wi.step = hi.step = 1;
            const [cf, ci] = input("区域简称", existing?.code || "");
            let autoCode = existing ? existing.codeAuto === true : true;
            ei.oninput = () => {
                if (autoCode) ci.value = C.regionInitials(ei.value);
            };
            ci.oninput = () => {
                autoCode = false;
                ci.value = ci.value.toUpperCase();
            };
            b.append(nf, ef, cf, row(wf, hf));
            const presets = select("规模", "custom", {
                custom: "自定义",
                small: "小 · 140 × 80",
                medium: "中 · 280 × 160",
                wide: "横长 · 560 × 120",
                tall: "纵深 · 210 × 320"
            }, v => {
                const size = {
                    small: [ 140, 80 ],
                    medium: [ 280, 160 ],
                    wide: [ 560, 120 ],
                    tall: [ 210, 320 ]
                }[v];
                if (size) {
                    wi.value = size[0];
                    hi.value = size[1];
                }
            });
            const more = fold("详细设置", b);
            more.append(presets[0]);
            let air = existing?.air || "#ffffff";
            if (existing) more.append(backgroundControl("空气底色", air, v => air = v));
            a.append(button(existing ? "保存" : "创建", () => {
                const ww = +wi.value, hh = +hi.value, code = (ci.value.trim() || (autoCode ? C.regionInitials(ei.value) : "")).toUpperCase();
                if (!ni.value.trim() || !ei.value.trim()) {
                    err("请填写中英文名。");
                    return;
                }
                if (!Number.isInteger(ww) || !Number.isInteger(hh) || ww < 20 || hh < 20 || ww > 4096 || hh > 4096) {
                    err("长宽需要 20–4096 的整数格。");
                    return;
                }
                if (!/^[A-Z0-9]+$/.test(code)) {
                    err("区域简称只能包含英文字母和数字。");
                    return;
                }
                const save = () => {
                    if (!existing && batchCreateEnabled()) {
                        cancelDrag();
                        batchPlacement = {
                            kind: "region",
                            sceneId: sceneId,
                            name: ni.value.trim(),
                            english: ei.value.trim(),
                            code: code,
                            w: ww,
                            h: hh
                        };
                        world = true;
                        regionId = null;
                        roomId = null;
                        selection = null;
                        tool = "select";
                        cutFrame = null;
                        close();
                        refresh();
                        draw();
                        toast("点击世界地图空白处连续创建区域；拖动已有区域调整位置，Esc 结束。");
                        return;
                    }
                    if (change(() => {
                        if (existing) {
                            C.resizeRegion(w, existing, {
                                x: 0,
                                y: 0,
                                w: ww,
                                h: hh
                            });
                            if (air !== existing.air) existing.rooms.forEach(r => r.background = air);
                            C.setRegionCode(existing, code, w);
                            Object.assign(existing, {
                                name: ni.value.trim(),
                                english: ei.value.trim(),
                                codeAuto: autoCode,
                                w: ww,
                                h: hh,
                                air: air
                            });
                        } else {
                            const r = C.region(ni.value.trim(), ei.value.trim(), ww, hh);
                            r.code = code;
                            r.codeAuto = autoCode;
                            w.regions.push(r);
                            scene().regions.push(r.id);
                            const used = scene().regions.filter(id => id !== r.id).map(id => {
                                const rr = w.regions.find(o => o.id === id), p = scene().placements[id] || {
                                    x: 0,
                                    y: 0
                                };
                                return p.x + rr.w;
                            });
                            scene().placements[r.id] = {
                                x: used.length ? Math.max(...used) + 40 : 0,
                                y: 0
                            };
                            regionId = r.id;
                            layerId = r.layers[0].id;
                            world = false;
                            roomId = null;
                            selection = null;
                            editShared = true;
                        }
                    })) {
                        close();
                        fit();
                    }
                };
                existing ? requireEdit(save, {
                    regionScope: true
                }) : save();
            }, "primary"));
            if (existing) {
                const removal = fold("移除", b);
                removal.append(button("从当前地图移除区域", () => {
                    change(() => {
                        scene().regions = scene().regions.filter(id => id !== existing.id);
                        for (const g of w.gates) if (g.a.region === existing.id || g.b.region === existing.id) g.scenes = g.scenes.filter(id => id !== sceneId);
                        world = true;
                        regionId = null;
                        roomId = null;
                        selection = null;
                    });
                    close();
                    fit();
                }));
            }
        });
    }
    function regionConnections() {
        dialog("区域连接", (b, a, close) => {
            b.append(check("显示具体业力图标", w.settings.gateKarmaIcons === true, v => change(() => w.settings.gateKarmaIcons = v)));
            const gates = w.gates.filter(g => g.scenes.includes(sceneId));
            for (const gate of gates) {
                const ra = w.regions.find(r => r.id === gate.a.region), rb = w.regions.find(r => r.id === gate.b.region);
                b.append(button(gate.name + " · " + (ra?.name || "未绑定") + " ↔ " + (rb?.name || "未绑定"), () => {
                    close();
                    gateDialog(gate);
                }, "map-menu-item"));
            }
            if (!gates.length) b.append(note("尚无区域连接"));
            const create = button("新建业力门", () => {
                close();
                gateDialog();
            }, "primary");
            a.append(create);
        });
    }
    function resumeGateConnection(marker) {
        const pending = pendingGateConnection;
        pendingGateConnection = null;
        if (!pending || pending.sceneId !== sceneId || marker.kind !== "gate") return;
        pending.draft[pending.side].marker = marker.id;
        gateDialog(w.gates.find(g => g.id === pending.existingId), null, pending.draft);
    }
    function sharedGateRoom(g) {
        if (!g?.sharedRoom) return null;
        const region = w.regions.find(r => r.id === g.sharedRoom.region), room = region?.rooms.find(rm => rm.id === g.sharedRoom.room);
        return room ? {
            gate: g,
            region: region,
            room: room
        } : null;
    }
    function openSharedGate(g) {
        const target = sharedGateRoom(g);
        if (!target) {
            toast("共享业力门房间未找到。");
            return;
        }
        if (regionId !== target.region.id || world) openRegion(target.region.id);
        focusRoom(target.room);
    }
    function gateRegionName(side) {
        return w.regions.find(r => r.id === side?.region)?.name || "未绑定";
    }
    function gateConnectionRows(g, key, regionId) {
        const target = sharedGateRoom(g);
        if (!target) return [];
        const isGate = end => end.region === target.region.id && target.region.ports.some(p => p.id === end.port && p.roomId === target.room.id), rows = [];
        for (const link of g.connections || []) {
            const end = isGate(link.a) ? link.b : isGate(link.b) ? link.a : null;
            if (end?.region === regionId) rows.push({
                link: link,
                gateEnd: isGate(link.a) ? link.a : link.b,
                target: end,
                shared: true
            });
        }
        if (target.region.id === regionId) for (const link of target.region.links) {
            const a = {
                region: regionId,
                port: link.a
            }, b = {
                region: regionId,
                port: link.b
            };
            if (isGate(a) !== isGate(b)) rows.push({
                link: link,
                gateEnd: isGate(a) ? a : b,
                target: isGate(a) ? b : a,
                shared: false
            });
        }
        return rows;
    }
    function gateDialog(existing, marker, draft) {
        if (!existing && marker) existing = C.sharedGateForRoom?.(w, regionId, marker.roomId) || w.gates.find(g => g.scenes.includes(sceneId) && [ g.a, g.b ].some(s => s.marker === marker.id));
        const available = scene().regions.map(id => w.regions.find(r => r.id === id)).filter(r => r && !r.gateStorageOnly), initial = draft || existing || {}, first = initial.a?.region ?? (available.some(r => r.id === regionId) ? regionId : available[0]?.id || ""), known = sharedGateRoom(existing);
        dialog(existing ? "共享业力门" : "新建业力门", (b, a, close, err) => {
            const opts = {
                "": "未绑定",
                ...Object.fromEntries(available.map(r => [ r.id, r.name + " / " + r.code ]))
            }, karma = Object.fromEntries([ ...Array.from({
                length: 10
            }, (_, i) => [ String(i + 1), "业力 " + (i + 1) ]), [ "locked", "不可通过" ] ]);
            const [nf, ni] = input("昵称", initial.name || marker?.name || "业力门"), [af, ai] = select("区域 A", first, opts), [bf, bi] = select("区域 B", initial.b?.region ?? available.find(r => r.id !== first)?.id ?? "", opts), [ak, aki] = select("A 侧要求", initial.a?.karma || "1", karma), [bk, bki] = select("B 侧要求", initial.b?.karma || "1", karma), source = el("div", "map-shared-gate-source"), connections = el("div", "map-gate-connections"), previewIcons = row();
            let sourceSelect, presetSelect;
            const markerRef = marker && reg() ? {
                region: reg().id,
                room: marker.roomId
            } : null, live = () => w.gates.find(g => g.id === existing?.id);
            const refreshSource = () => {
                const previous = sourceSelect?.value;
                source.replaceChildren();
                if (known) {
                    source.append(note(known.room.name + " · " + (opts[ai.value] || "未绑定") + " ↔ " + (opts[bi.value] || "未绑定")), button("编辑共享房间", () => {
                        close();
                        openSharedGate(live());
                    }, "map-full"));
                    return;
                }
                const candidates = available.flatMap(r => r.rooms.filter(rm => rm.roomType === "GATE" && !C.sharedGateForRoom?.(w, r.id, rm.id)).map(rm => ({
                    r: r,
                    rm: rm,
                    key: r.id + ":" + rm.id
                }))), preferred = markerRef ? markerRef.region + ":" + markerRef.room : null, selected = candidates.some(c => c.key === previous) ? previous : candidates.some(c => c.key === preferred) ? preferred : "new", [field, control] = select("房间", selected, {
                    new: "新建共享房间",
                    ...Object.fromEntries(candidates.map(c => [ c.key, c.r.name + " · " + c.rm.name ]))
                });
                sourceSelect = control;
                source.append(field);
                const presets = (window.OCRoomPresets?.entries || []).filter(p => p.type === "GATE"), [pf, pi] = select("预设", presets[0]?.id || "blank", {
                    ...Object.fromEntries(presets.map(p => [ p.id, p.name + " · " + p.w + " × " + p.h ])),
                    blank: "空白 · 70 × 40"
                });
                presetSelect = pi;
                source.append(pf);
                const show = () => pf.hidden = control.value !== "new";
                control.onchange = show;
                show();
            };
            const snapshot = () => {
                const current = live() || initial;
                return {
                    name: ni.value.trim() || "业力门",
                    a: {
                        region: ai.value,
                        karma: aki.value,
                        marker: current.a?.region === ai.value ? current.a.marker || "" : markerRef?.region === ai.value ? marker?.id || "" : ""
                    },
                    b: {
                        region: bi.value,
                        karma: bki.value,
                        marker: current.b?.region === bi.value ? current.b.marker || "" : markerRef?.region === bi.value ? marker?.id || "" : ""
                    }
                };
            };
            function renderConnections() {
                connections.replaceChildren();
                const current = live(), target = sharedGateRoom(current);
                if (!target) return;
                for (const [key, control] of [ [ "a", ai ], [ "b", bi ] ]) {
                    const label = key.toUpperCase() + " 侧", rr = w.regions.find(r => r.id === control.value), box = el("section", "map-gate-side");
                    box.append(el("strong", "", label + " · " + (rr?.name || "未绑定")));
                    connections.append(box);
                    if (!rr) {
                        box.append(note("可稍后选择区域。"));
                        continue;
                    }
                    const gatePorts = target.region.ports.filter(p => p.roomId === target.room.id && ![ "den", "internal" ].includes(p.kind)), rooms = rr.rooms.filter(rm => !(rr.id === target.region.id && rm.id === target.room.id)), [gf, gi] = select(label + "门内通道井", gatePorts[0]?.id || "", Object.fromEntries(gatePorts.map(p => [ p.id, (p.name || C.portKinds[p.kind]) + " · " + Math.round(p.x - target.room.x) + ", " + Math.round(p.y - target.room.y) ]))), [rf, ri] = select(label + "目标房间", rooms[0]?.id || "", Object.fromEntries(rooms.map(rm => [ rm.id, rm.name ]))), [pf, pi] = select(label + "目标通道井", "", {}), add = button("连接 " + label, () => {
                        const from = gi.value, to = pi.value;
                        if (!from || !to) {
                            err("请先在业力门和目标房间中放置通道井。");
                            return;
                        }
                        let problem;
                        const ok = change(() => {
                            try {
                                const updated = C.saveGateConnection(w, sceneId, snapshot(), current.id);
                                C.connectSharedGatePorts(w, updated.id, {
                                    region: target.region.id,
                                    port: from
                                }, {
                                    region: control.value,
                                    port: to
                                });
                            } catch (e) {
                                problem = e;
                                throw e;
                            }
                        });
                        if (ok) {
                            err("");
                            refreshSource();
                            renderConnections();
                        } else err(problem || "无法连接。");
                    });
                    const ports = () => {
                        pi.replaceChildren();
                        const list = rr.ports.filter(p => p.roomId === ri.value && ![ "den", "internal" ].includes(p.kind));
                        for (const p of list) pi.add(new Option((p.name || C.portKinds[p.kind]) + " · " + Math.round(p.x) + ", " + Math.round(p.y), p.id));
                        pi.value = list[0]?.id || "";
                        add.disabled = !gatePorts.length || !list.length;
                    };
                    ri.onchange = ports;
                    ports();
                    box.append(gf, row(rf, pf), add);
                    if (!gatePorts.length) box.append(note("先在门房间内放置通道井。"));
                    for (const item of gateConnectionRows(current, key, control.value)) {
                        const gp = target.region.ports.find(p => p.id === item.gateEnd.port), tp = rr.ports.find(p => p.id === item.target.port), rm = rr.rooms.find(rm => rm.id === tp?.roomId);
                        box.append(row(el("span", "map-muted", (gp?.name || "门内通道井") + " ↔ " + (rm?.name || "房间") + " · " + (tp?.name || C.portKinds[tp?.kind] || "通道井")), button("解除", () => {
                            change(() => {
                                const now = live();
                                if (item.shared) C.removeSharedGateConnection(w, now.id, item.link.id); else {
                                    const owner = sharedGateRoom(now).region;
                                    owner.links = owner.links.filter(link => link.id !== item.link.id);
                                }
                            });
                            renderConnections();
                        })));
                    }
                }
                const sides = Object.fromEntries([ current.a, current.b ].filter(side => side.region).map(side => [ side.region, gateRegionName(side) ]));
                for (const rr of w.regions) for (const rm of rr.rooms.filter(rm => rm.roomType === "SHELTER" && rm.gateCompanionId === current.id)) {
                    const [f, i] = select("庇护所归属 · " + rm.name, rr.gateStorageOnly ? "" : rr.id, {
                        ...rr.gateStorageOnly ? {
                            "": "等待绑定区域"
                        } : {},
                        ...sides
                    });
                    i.disabled = !Object.keys(sides).length;
                    i.onchange = () => {
                        if (change(() => C.moveGateCompanionToRegion(w, current.id, {
                            region: rr.id,
                            room: rm.id
                        }, i.value))) renderConnections();
                    };
                    connections.append(f);
                }
            }
            const icons = () => previewIcons.replaceChildren(icon(aki.value === "locked" ? "gate-locked" : "karma-" + aki.value), icon(bki.value === "locked" ? "gate-locked" : "karma-" + bki.value));
            ai.onchange = bi.onchange = () => {
                refreshSource();
                renderConnections();
            };
            aki.onchange = bki.onchange = icons;
            b.append(nf, row(af, bf), source, row(ak, bk), previewIcons, connections);
            refreshSource();
            renderConnections();
            icons();
            if (existing) b.append(check("显示业力门与跨区域连线", existing.visible !== false, v => change(() => {
                const current = live();
                if (current) current.visible = v;
            })));
            const deps = fold("依赖", b);
            deps.append(note("业力 6–10 和不可通过需要 RegionKit ExtendedGates。"));
            const save = button(existing ? "保存" : "创建", async () => {
                save.disabled = true;
                try {
                    const data = snapshot();
                    if (data.a.region && data.a.region === data.b.region) throw Error("两侧请选择不同区域，或保留未绑定。");
                    let preset = null;
                    if (!known && sourceSelect.value === "new" && presetSelect.value !== "blank") preset = await window.OCRoomPresets.read(presetSelect.value);
                    if (!known && sourceSelect.value !== "new") {
                        const key = sourceSelect.value, candidate = available.flatMap(r => r.rooms.map(rm => ({
                            r: r,
                            rm: rm
                        }))).find(c => c.r.id + ":" + c.rm.id === key);
                        if (!candidate) throw Error("所选业力门房间已不存在。");
                        data.room = {
                            region: candidate.r.id,
                            room: candidate.rm.id
                        };
                    }
                    if (preset) data.preset = preset;
                    if (!existing && !known && sourceSelect.value === "new" && batchCreateEnabled() && !world && reg() && !reg().gateStorageOnly) {
                        if (preset) beginRoomPreset("GATE", preset); else {
                            change(() => C.ensureGateLayer(reg()));
                            setLayer(C.gateLayer(reg()).id);
                            setTool("split");
                            cutMethod = "frame";
                            cutIntent = "create";
                            pendingRoomType = "GATE";
                            placeCutFrame({
                                x: reg().w / 2,
                                y: reg().h / 2
                            });
                        }
                        pendingRoomPreset = {
                            ...pendingRoomPreset,
                            w: preset?.w || 70,
                            h: preset?.h || 40,
                            sharedGateDraft: data
                        };
                        close();
                        renderTools();
                        draw();
                        return;
                    }
                    let result, problem;
                    const ok = change(() => {
                        try {
                            result = existing ? C.saveGateConnection(w, sceneId, data, existing.id) : C.createSharedGate(w, sceneId, data);
                            if (preset) {
                                const target = sharedGateRoom(result);
                                if (!target) throw Error("无法创建共享业力门。");
                                C.replaceRoomFromRained(w, target.region, target.room.id, preset);
                                C.normalizeSharedGates?.(w);
                            }
                        } catch (e) {
                            problem = e;
                            throw e;
                        }
                    });
                    if (problem) throw problem;
                    if (ok || result) {
                        close();
                        if (!existing) openSharedGate(result);
                        if (result?.rebindReport?.detachedConnections) toast("已改绑区域，原侧连接已解除并保留在项目备份中。");
                    }
                } catch (e) {
                    err(e.message || e);
                } finally {
                    save.disabled = false;
                }
            }, "primary");
            a.append(save);
            if (existing) a.append(button("删除业力门", () => {
                if (change(() => C.removeSharedGate(w, existing.id))) {
                    close();
                    roomId = null;
                    selection = null;
                    if (!reg()) {
                        world = true;
                        regionId = null;
                    }
                    refresh();
                }
            }));
            a.append(button("取消", close));
        });
    }
    function chooseImage(callback) {
        const f = el("input");
        f.type = "file";
        f.accept = "image/png,image/jpeg,image/webp";
        f.onchange = () => {
            const file = f.files[0];
            if (!file) return;
            if (file.size > 12 * 1024 * 1024) {
                toast("参考图请控制在 12 MB 以内。");
                return;
            }
            const reader = new FileReader;
            reader.onload = () => callback(reader.result, file.name);
            reader.readAsDataURL(file);
        };
        f.click();
    }
    function referenceDialog() {
        if (!reg() || world) {
            toast("进入区域后可以添加参考图。");
            return;
        }
        dialog("参考图", (b, a, close) => {
            b.append(document.createTextNode(""));
            b.append(button("＋ 从本机导入", () => chooseImage((src, name) => {
                const image = new Image;
                image.onload = () => requireEdit(() => {
                    if (batchCreateEnabled()) {
                        const rr = room(), ww = Math.min(reg().w, rr?.w || reg().w / 2), hh = Math.min(reg().h, ww * image.height / image.width);
                        setTool("select");
                        batchPlacement = {
                            kind: "reference",
                            regionId: regionId,
                            w: ww,
                            h: hh,
                            ref: {
                                name: name,
                                src: src,
                                opacity: .35,
                                angle: 0,
                                front: false,
                                locked: false,
                                visible: true
                            }
                        };
                        close();
                        renderTools();
                        draw();
                        toast("点击地图连续放置此参考图；拖动已有参考图调整位置，Esc 结束。");
                        return;
                    }
                    change(() => {
                        const rr = room(), ww = Math.min(reg().w, rr?.w || reg().w / 2), ref = {
                            id: C.uid(),
                            name: name,
                            src: src,
                            x: rr?.x || 0,
                            y: rr?.y || 0,
                            w: ww,
                            h: Math.min(reg().h, ww * image.height / image.width),
                            opacity: .35,
                            angle: 0,
                            front: false,
                            locked: false,
                            visible: true,
                            roomId: rr?.id || null,
                            layer: layerId
                        };
                        reg().refs.push(ref);
                        selection = {
                            list: "refs",
                            id: ref.id
                        };
                        tool = "select";
                        sidebar = "tools";
                        $("mapSideContent").scrollTop = 0;
                    });
                    close();
                });
                image.src = src;
            }), "map-choice"));
            for (const ref of reg().refs) {
                const li = el("div", "map-ref-list"), im = el("img");
                im.src = ref.src;
                li.append(im, el("span", "", ref.name), button(ref.visible ? "隐藏" : "显示", () => {
                    change(() => ref.visible = !ref.visible);
                    close();
                }), button("编辑", () => {
                    selection = {
                        list: "refs",
                        id: ref.id
                    };
                    tool = "select";
                    sidebar = "tools";
                    close();
                    refresh();
                }));
                b.append(li);
            }
            b.append(note("尺寸参考：可添加单镜头标尺。原版区域图片可以从 Wiki 下载后导入、替换或删除。"), button("添加 70×40 镜头标尺", () => {
                change(() => {
                    const r = reg();
                    r.categories.cameras.visible = true;
                    if (!r.rooms.length) {
                        C.addRoom(r, {
                            x: 0,
                            y: 0,
                            w: Math.min(70, r.w),
                            h: Math.min(40, r.h),
                            layer: layerId
                        });
                    }
                });
                close();
            }));
        });
    }
    let favoriteBrushIndex = 0, favoriteMaterialIndex = 0;
    function favorites() {
        return C.brushFavorites(w.settings.favorites);
    }
    function useFavorite(action) {
        const f = favorites();
        if (action === "nextBrush") action = "brush" + ((favoriteBrushIndex + 1) % 3 + 1);
        if (action === "nextMaterial") action = "material" + ((favoriteMaterialIndex + 1) % 3 + 1);
        if (action === "eraser") {
            setTool("erase");
            return;
        }
        if (action.startsWith("brush")) {
            favoriteBrushIndex = +action.at(-1) - 1;
            const p = f.brushes[favoriteBrushIndex];
            brush = p.width;
            setTool(p.tool);
        } else if (action.startsWith("material")) {
            favoriteMaterialIndex = +action.at(-1) - 1;
            material = f.materials[favoriteMaterialIndex];
            if (![ "brush", "line", "rect", "ellipse", "polygon", "fill" ].includes(tool)) setTool(f.brushes[favoriteBrushIndex].tool);
            renderTools();
            renderSide();
        }
    }
    function renderFavorites(parent) {
        const f = favorites(), box = el("div", "map-favorites");
        box.append(el("small", "", "常用笔刷"));
        const bs = row();
        f.brushes.forEach((p, i) => {
            const b = button(p.name, () => useFavorite("brush" + (i + 1)), "small");
            b.setAttribute("aria-pressed", String(tool === p.tool && brush === p.width && favoriteBrushIndex === i));
            bs.append(b);
        });
        bs.append(button("橡皮", () => useFavorite("eraser"), "small"));
        box.append(bs, el("small", "", "常用材质"));
        const ms = row();
        f.materials.forEach((m, i) => {
            const b = button(C.materials[m], () => useFavorite("material" + (i + 1)), "small");
            b.setAttribute("aria-pressed", String(material === m && favoriteMaterialIndex === i));
            ms.append(b);
        });
        box.append(ms, button("编辑槽位与快捷键", favoriteSettings, "map-full"));
        parent.append(box);
    }
    function favoriteSettings() {
        dialog("常用槽与快捷键", (b, a, close, err) => {
            const draft = favorites(), brushTools = Object.fromEntries(toolsList.filter(t => [ "brush", "line", "rect", "ellipse", "polygon", "fill" ].includes(t[0])).map(t => [ t[0], t[2] ])), labels = new Map;
            const labelFor = id => id.startsWith("brush") ? draft.brushes[+id.at(-1) - 1].name : id.startsWith("material") ? C.materials[draft.materials[+id.at(-1) - 1]] : {
                nextBrush: "切换常用笔刷",
                nextMaterial: "切换常用材质",
                eraser: "橡皮"
            }[id];
            const refreshLabels = () => {
                for (const [id, node] of labels) node.textContent = labelFor(id);
            };
            draft.brushes.forEach((p, index) => {
                const section = fold(p.name, b, "favorite-brush-" + index, index === 0), summary = section.querySelector("summary");
                const syncName = () => {
                    if (p.autoName) p.name = brushTools[p.tool];
                    ni.value = p.name;
                    summary.textContent = p.name;
                    refreshLabels();
                };
                const [name, ni] = input("名称", p.name, "text", v => {
                    p.autoName = !v.trim();
                    p.name = v.trim();
                    syncName();
                }), [type, ti] = select("工具", p.tool, brushTools, v => {
                    p.tool = v;
                    syncName();
                }), [width, wi] = input("笔宽 / 格", p.width, "number", v => p.width = Math.max(1, Math.round(+v || 1)));
                wi.min = 1;
                wi.max = 100;
                wi.step = 1;
                section.append(row(type, width), name, button("使用当前笔刷", () => {
                    p.tool = brushTools[tool] ? tool : "brush";
                    p.width = brush;
                    p.autoName = true;
                    ti.value = p.tool;
                    wi.value = brush;
                    syncName();
                }, "map-full"));
            });
            const m = fold("常用材质", b, "favorite-materials", true);
            draft.materials.forEach((v, index) => m.append(select("材质 " + (index + 1), v, C.materials, v => {
                draft.materials[index] = v;
                refreshLabels();
            })[0]));
            const keys = fold("快捷键", b, "favorite-keys", true);
            for (const id of [ "brush1", "brush2", "brush3", "material1", "material2", "material3", "nextBrush", "nextMaterial", "eraser" ]) {
                const [field, i] = input("", displayChord(draft.shortcuts[id] || "")), label = el("span", "", labelFor(id)), status = el("span", "map-key-status");
                field.replaceChildren(label, i, status);
                labels.set(id, label);
                status.setAttribute("role", "status");
                status.setAttribute("aria-live", "polite");
                i.readOnly = true;
                i.placeholder = "点击设置";
                i.setAttribute("aria-label", labelFor(id) + "快捷键");
                let listening = false;
                const start = () => {
                    listening = true;
                    i.classList.add("is-recording");
                    i.value = "";
                    i.placeholder = "请按组合键…";
                    status.textContent = "正在录入 · Esc 取消";
                }, finish = message => {
                    listening = false;
                    i.classList.remove("is-recording");
                    i.value = displayChord(draft.shortcuts[id] || "");
                    i.placeholder = "点击设置";
                    status.textContent = message || "";
                };
                i.onfocus = start;
                i.onclick = start;
                i.onblur = () => finish();
                i.onkeydown = e => {
                    e.stopPropagation?.();
                    if (e.key === "Tab") return;
                    e.preventDefault();
                    if (e.key === "Escape") {
                        finish("已取消");
                        i.blur?.();
                        return;
                    }
                    if (!listening) return;
                    if (e.key === "Backspace" || e.key === "Delete") {
                        delete draft.shortcuts[id];
                        finish("已清除，保存后生效");
                        return;
                    }
                    const key = C.shortcutChord(e);
                    if (!key) {
                        status.textContent = "正在录入 · 继续按下其他键";
                        return;
                    }
                    draft.shortcuts[id] = key;
                    finish("已录入，保存后生效");
                };
                const keyRow = row(field, button("清除", () => {
                    delete draft.shortcuts[id];
                    finish("已清除，保存后生效");
                }, "small"));
                keyRow.classList.add("map-shortcut-row");
                keys.append(keyRow);
            }
            keys.append(note("数位笔按键可在驱动中映射到这里保存的组合键。"));
            a.append(button("取消", close), button("保存槽位与快捷键", () => {
                const reserved = new Set([ "Ctrl+KeyS", "Meta+KeyS", "Ctrl+KeyZ", "Meta+KeyZ", "Ctrl+Shift+KeyZ", "Meta+Shift+KeyZ", "Ctrl+KeyY", "Meta+KeyY", "Shift+KeyZ", "Space", "Escape", "Enter", "Delete" ]), used = new Set;
                for (const key of Object.values(draft.shortcuts)) {
                    if (reserved.has(key)) {
                        err(displayChord(key) + " 已用于保存、撤回或导航，请选择其他组合。");
                        return;
                    }
                    if (used.has(key)) {
                        err(displayChord(key) + " 重复绑定，请修改。");
                        return;
                    }
                    used.add(key);
                }
                change(() => w.settings.favorites = C.brushFavorites(draft));
                close();
                manualSave();
            }, "primary"));
        });
    }
    function displayChord(key) {
        return key.replace(/Key(?=[A-Z])/g, "").replace(/Digit(?=\d)/g, "").replace("Meta", "⌘");
    }
    function sharedGateForConnection(fromRegion, from, toRegion, to) {
        return w.gates.find(g => g.scenes.includes(sceneId) && g.sharedRoom && [ g.sharedRoom.region, g.a.region, g.b.region ].includes(fromRegion.id) && [ g.sharedRoom.region, g.a.region, g.b.region ].includes(toRegion.id) && (g.sharedRoom.region === fromRegion.id && g.sharedRoom.room === from.roomId || g.sharedRoom.region === toRegion.id && g.sharedRoom.room === to.roomId));
    }
    function renderLinkControls(n) {
        const s = section("通道连接"), from = sharedGateConnectionPose(connectStart), gate = from && C.sharedGateForRoom(w, from.region.id, from.port.roomId), name = from && (gate ? gateDisplayName(gate) : from.region.name + " / " + (from.region.rooms.find(rm => rm.id === from.port.roomId)?.name || from.port.name || ""));
        s.append(note(from ? "起点：" + name : "选择起点通道井"));
        if (from) s.append(button("选择连接终点", () => connectionPicker(from.port, from.region.id), "map-full"), button("取消连接", () => {
            connectStart = null;
            renderSide();
            draw();
        }, "map-full"));
        n.append(s);
    }
    function linkViewEnabled() {
        return tool === "link" && !cleanPreview && !exportingImage;
    }
    function linkPortViews() {
        const views = world ? [ ...scene().regions.map(id => ({
            region: w.regions.find(r => r.id === id),
            ...scene().placements[id] || {
                x: 0,
                y: 0
            }
        })), ...worldGateStorageViews() ] : reg() ? [ {
            region: reg(),
            x: 0,
            y: 0
        } ] : [], out = [];
        for (const view of views) {
            if (!view.region) continue;
            const shown = previewRegion(view.region, cam.z, false);
            for (const port of shown.ports) {
                if (!visible(shown, port, "ports", displayContext(world, false))) continue;
                const ref = port.sharedGateSource || {
                    region: view.region.id,
                    port: port.id
                }, actual = sharedGateConnectionPose(ref);
                if (!actual) continue;
                const pose = C.portPose(shown, port);
                out.push({
                    ref: {
                        region: actual.region.id,
                        port: actual.port.id
                    },
                    region: actual.region,
                    port: actual.port,
                    pose: {
                        x: view.x + pose.x,
                        y: view.y + pose.y
                    },
                    raw: {
                        x: view.x + port.x,
                        y: view.y + port.y
                    }
                });
            }
        }
        return out;
    }
    function linkPortAt(point) {
        let nearest = null, distance = Infinity;
        const radius = Math.max(lastPointerType === "touch" ? 22 : 9, portSize(world) / 2 + 2);
        for (const item of linkPortViews()) {
            const d = Math.min(Math.hypot(item.pose.x - point.x, item.pose.y - point.y), Math.hypot(item.raw.x - point.x, item.raw.y - point.y)) * cam.z;
            if (d <= radius && d < distance) {
                nearest = item;
                distance = d;
            }
        }
        return nearest;
    }
    function connectPortRefs(a, b) {
        const from = sharedGateConnectionPose(a), to = sharedGateConnectionPose(b);
        if (!from || !to) throw Error("通道井已不存在，请重新选择。");
        const sameRoom = from.region.id === to.region.id && from.port.roomId === to.port.roomId, gate = !sameRoom && sharedGateForConnection(from.region, from.port, to.region, to.port);
        if (gate && from.region.id === to.region.id && from.region.gateStorageOnly) {
            const other = from.port.roomId === gate.sharedRoom.room ? to : from, rm = other.region.rooms.find(rm => rm.id === other.port.roomId);
            if (rm?.roomType === "SHELTER" && rm.pendingRegionAssignment && (!rm.gateCompanionId || rm.gateCompanionId === gate.id)) return C.connectPorts(from.region, from.port.id, to.port.id);
        }
        if (gate) return C.connectSharedGatePorts(w, gate.id, a, b);
        if (from.region.id === to.region.id) return C.connectPorts(from.region, from.port.id, to.port.id);
        throw Error("跨区域连接需要经过共享业力门。");
    }
    function clickLinkPort(point) {
        const target = linkPortAt(point);
        if (!target) {
            toast("请点击通道井。");
            return;
        }
        if (!connectStart) {
            const reason = C.lockReason(target.region, target.port, "ports", target.port.layer);
            if (reason) {
                toast(reason);
                return;
            }
            connectStart = target.ref;
            renderSide();
            drawOverlay();
            return;
        }
        const from = sharedGateConnectionPose(connectStart), run = () => {
            if (change(() => connectPortRefs(connectStart, target.ref))) connectStart = null;
            renderSide();
            draw();
            drawOverlay();
        }, shared = [ from, target ].filter(p => p && !p.region.gateStorageOnly && w.scenes.filter(s => s.regions.includes(p.region.id)).length > 1);
        if (shared.length && !editShared) requireEdit(run, {
            region: shared[0].region,
            object: shared[0].port,
            category: "ports"
        }); else run();
    }
    function drawLinkOverlay(svg) {
        if (!linkViewEnabled() || !connectStart) return;
        for (const item of linkPortViews().filter(p => p.ref.region === connectStart.region && p.ref.port === connectStart.port)) {
            const n = document.createElementNS("http://www.w3.org/2000/svg", "rect"), radius = Math.max(10, portSize(world) / 2 + 3);
            for (const [k, v] of Object.entries({
                x: item.pose.x * cam.z + cam.x - radius,
                y: item.pose.y * cam.z + cam.y - radius,
                width: radius * 2,
                height: radius * 2,
                fill: "none",
                stroke: "#ffffff",
                "stroke-width": 2,
                "stroke-dasharray": "4 3",
                "pointer-events": "none"
            })) n.setAttribute(k, v);
            svg.append(n);
        }
    }
    function connectionPicker(from, sourceRegionId = regionId) {
        dialog("选择连接终点", (b, a, close, err) => {
            const sourceRegion = w.regions.find(r => r.id === sourceRegionId), shared = C.sharedGateForRoom?.(w, sourceRegion.id, from.roomId), gates = w.gates.filter(g => g.scenes.includes(sceneId) && g.sharedRoom && [ g.a.region, g.b.region ].includes(sourceRegion.id)), regionIds = [ ...new Set([ sourceRegion.id, ...shared ? [ shared.a.region, shared.b.region ] : gates.map(g => g.sharedRoom.region) ]) ], regions = regionIds.map(id => w.regions.find(r => r.id === id)).filter(Boolean), [gf, gi] = select("区域", sourceRegion.id, Object.fromEntries(regions.map(r => [ r.id, r.gateStorageOnly ? "共享业力门" : r.name + " / " + r.code ]))), [lf, li] = select("图层", layerId, {}), [rf, ri] = select("房间", "", {}), targets = el("div");
            if (regions.length > 1) b.append(gf);
            b.append(lf, rf, targets);
            const targetRegion = () => w.regions.find(r => r.id === gi.value), allowedRoom = rm => gi.value === sourceRegion.id || shared || gates.some(g => g.sharedRoom.region === gi.value && g.sharedRoom.room === rm.id);
            function refreshLayers() {
                const r = targetRegion();
                li.replaceChildren();
                for (const l of r.layers.filter(l => r.rooms.some(rm => rm.layer === l.id && allowedRoom(rm)))) li.add(new Option(l.name, l.id));
                li.value = r.layers.find(l => l.id === layerId && r.rooms.some(rm => rm.layer === l.id && allowedRoom(rm)))?.id || r.layers.find(l => r.rooms.some(rm => rm.layer === l.id && allowedRoom(rm)))?.id || "";
                refreshRooms();
            }
            function refreshRooms() {
                const r = targetRegion();
                ri.replaceChildren();
                for (const rm of r.rooms.filter(rm => rm.layer === li.value && allowedRoom(rm))) ri.add(new Option(rm.name, rm.id));
                ri.value = r.rooms.find(rm => rm.layer === li.value && allowedRoom(rm))?.id || "";
                refreshPorts();
            }
            function refreshPorts() {
                targets.replaceChildren();
                const r = targetRegion(), ports = r.ports.filter(p => p.layer === li.value && p.roomId === ri.value && !(r.id === sourceRegion.id && p.id === from.id) && p.kind !== "den");
                ports.forEach(p => targets.append(button((p.name || C.portKinds[p.kind]) + " · " + Math.round(p.x) + ", " + Math.round(p.y), () => {
                    let error;
                    const ok = change(() => {
                        try {
                            connectPortRefs({
                                region: sourceRegion.id,
                                port: from.id
                            }, {
                                region: r.id,
                                port: p.id
                            });
                        } catch (e) {
                            error = e;
                            throw e;
                        }
                    });
                    if (ok) {
                        connectStart = null;
                        close();
                    } else err(error?.message || "无法连接。");
                }, "map-full")));
                if (!ports.length) targets.append(note("此房间没有可连接的通道井。"));
            }
            gi.onchange = refreshLayers;
            li.onchange = refreshRooms;
            ri.onchange = refreshPorts;
            refreshLayers();
            a.append(button("取消", close));
        });
    }
    function connectSharedShelter(r, host, target, position) {
        if (target.region.id === r.id) return C.connectShelter(r, host, target.room, position);
        const gate = C.sharedGateForRoom(w, r.id, host.id);
        if (!gate || ![ gate.a.region, gate.b.region ].includes(target.region.id)) throw Error("请选择已绑定区域的独立庇护所。");
        for (const [region, rm] of [ [ r, host ], [ target.region, target.room ] ]) {
            const reason = C.lockReason(region, rm, "ports");
            if (reason) throw Error(reason);
        }
        const at = position || {
            x: Math.floor(host.x + host.w / 2),
            y: Math.floor(host.y + host.h / 2)
        };
        if (!C.inside(at, host)) throw Error("入口需要位于当前房间内。");
        let exit = target.region.ports.find(p => p.roomId === target.room.id && p.kind === "exit");
        if (!exit) {
            exit = {
                id: C.uid(),
                kind: "exit",
                name: "庇护所出口",
                roomId: target.room.id,
                layer: target.room.layer,
                x: target.room.x + 3.5,
                y: target.room.y + Math.floor(target.room.h / 2) + .5,
                facing: "auto"
            };
            target.region.ports.push(exit);
        }
        C.syncShelterPort(target.region, target.room);
        const existing = (gate.connections || []).find(l => [ l.a, l.b ].some(e => e.region === target.region.id && e.port === exit.id));
        if (existing) {
            const ref = existing.a.region === r.id ? existing.a : existing.b, port = r.ports.find(p => p.id === ref.port);
            if (!port || port.roomId !== host.id) throw Error("这个庇护所已有入口，请先断开原连接。");
            const reason = C.lockReason(r, port, "ports");
            if (reason) throw Error(reason);
            Object.assign(port, at);
            return port;
        }
        const port = r.ports.find(p => p.roomId === host.id && p.kind === "exit" && Math.hypot(p.x - at.x, p.y - at.y) < .75) || {
            id: C.uid(),
            kind: "exit",
            name: "庇护所入口",
            roomId: host.id,
            layer: host.layer,
            facing: "auto",
            ...at
        };
        if (!r.ports.includes(port)) r.ports.push(port);
        C.connectSharedGatePorts(w, gate.id, {
            region: r.id,
            port: port.id
        }, {
            region: target.region.id,
            port: exit.id
        });
        target.region.categories.shelter.visible = true;
        return port;
    }
    function shelterEntranceDialog(host, position) {
        dialog("庇护所入口", (b, a, close, err) => {
            const r = reg(), gate = C.sharedGateForRoom(w, r.id, host.id), regions = [ r, ...gate ? [ gate.a.region, gate.b.region ].filter(id => id && id !== r.id).map(id => w.regions.find(r => r.id === id)).filter(Boolean) : [] ], shelters = regions.flatMap(region => region.rooms.filter(rm => rm.roomType === "SHELTER").map(room => ({
                region: region,
                room: room
            }))), [f, i] = select("连接到庇护所", shelters[0]?.room.id || "", Object.fromEntries(shelters.map(t => [ t.room.id, (t.region.id === r.id ? "" : t.region.name + " · ") + t.room.name ])));
            b.append(f);
            if (!shelters.length) b.append(note("请先新建独立的庇护所房间，再连接入口。"));
            const save = button("放置入口", () => {
                let error;
                const ok = change(() => {
                    try {
                        const target = shelters.find(t => t.room.id === i.value);
                        if (!target) throw Error("请选择庇护所。");
                        const p = connectSharedShelter(r, host, target, position);
                        selection = {
                            list: "ports",
                            id: p.id
                        };
                        tool = "select";
                    } catch (e) {
                        error = e;
                        throw e;
                    }
                });
                if (ok) close(); else err(error?.message || "无法连接。");
            }, "primary");
            save.disabled = !shelters.length;
            a.append(button("取消", close), save);
        });
    }
    function settingsDialog() {
        dialog("设置", (b, a, close) => {
            const warnings = fold("房间安全警告", b, "room-warnings", true);
            warningControls(warnings);
            b.append(button("常用槽与快捷键", () => {
                close();
                favoriteSettings();
            }, "map-full"));
            b.append(select("工具栏位置", w.settings.toolbarPosition || "bottom-right", {
                "bottom-right": "右下角",
                top: "顶部",
                bottom: "底部"
            }, v => change(() => w.settings.toolbarPosition = v))[0], input("选中高光", w.settings.selectionColor || "#ffff00", "color", v => change(() => w.settings.selectionColor = v))[0], input("连接高光", w.settings.connectionHighlight || "#ffff00", "color", v => change(() => w.settings.connectionHighlight = v))[0]);
            a.append(button("完成", close, "primary"));
        });
    }
    function resize() {
        if (!canvas || !active) return;
        const raw = $("mapStage").getBoundingClientRect(), scale = window.OCUIPreferences?.pageScale || 1, b = {
            width: raw.width / scale,
            height: raw.height / scale
        }, ratio = Math.min(3, (devicePixelRatio || 1) * scale);
        const oldWidth = parseFloat(canvas.style.width), oldHeight = parseFloat(canvas.style.height);
        if (Number.isFinite(oldWidth) && Number.isFinite(oldHeight)) {
            cam.x += (b.width - oldWidth) / 2;
            cam.y += (b.height - oldHeight) / 2;
        }
        const nw = Math.max(1, Math.round(b.width * ratio)), nh = Math.max(1, Math.round(b.height * ratio));
        if (canvas.width !== nw) canvas.width = nw;
        if (canvas.height !== nh) canvas.height = nh;
        canvas.style.width = b.width + "px";
        canvas.style.height = b.height + "px";
        clampMapFloats();
        draw();
    }
    function clampMapFloats() {
        if (!host || !canvas) return;
        const stage = $("mapStage"), width = stage.clientWidth, height = stage.clientHeight;
        if (!width || !height) return;
        const warning = $("mapWarningCorner");
        for (const id of [ "mapUndo", "mapPreviewFloat" ]) {
            const node = $(id);
            if (!node || node.hidden) continue;
            const x = Math.max(8, Math.min(Number.parseFloat(node.style.left) || 8, Math.max(8, width - node.offsetWidth - 8)));
            let y = Math.max(8, Math.min(Number.parseFloat(node.style.top) || 8, Math.max(8, height - node.offsetHeight - 8)));
            if (warning && !warning.hidden && x < warning.offsetLeft + warning.offsetWidth + 8 && x + node.offsetWidth > warning.offsetLeft && y < warning.offsetTop + warning.offsetHeight + 8 && y + node.offsetHeight > warning.offsetTop) y = Math.min(warning.offsetTop + warning.offsetHeight + 8, Math.max(8, height - node.offsetHeight - 8));
            node.style.left = x + "px";
            node.style.top = y + "px";
        }
        const actions = $("mapRoomSelectionActions");
        if (actions && !actions.hidden) {
            let bottom = 8;
            const dock = $("mapDock"), zoom = $("mapZoom");
            for (const node of [ dock, zoom ]) if (node && !node.hidden && (node !== dock || host.dataset.toolbar !== "top")) bottom = Math.max(bottom, height - node.offsetTop + 8);
            actions.style.bottom = Math.max(8, Math.min(bottom, height - actions.offsetHeight - 8)) + "px";
        }
        positionBrushSizeRail();
    }
    function viewSize() {
        const b = canvas.getBoundingClientRect();
        const scale = window.OCUIPreferences?.pageScale || 1;
        return {
            w: b.width / scale,
            h: b.height / scale
        };
    }
    function worldGateStorageViews() {
        return w.gates.filter(g => g.scenes.includes(sceneId) && g.visible !== false).map(g => {
            const target = sharedGateRoom(g);
            if (!target || !target.region.gateStorageOnly && [ g.a.region, g.b.region ].includes(target.region.id) && scene().regions.includes(target.region.id)) return null;
            const old = scene().placements[target.region.id] || {
                x: 0,
                y: 0
            }, pos = g.placements?.[sceneId] || {
                x: old.x + target.room.x,
                y: old.y + target.room.y
            };
            const region = {
                ...target.region,
                sharedGateWorldView: true,
                rooms: [ target.room ]
            };
            for (const key of [ "shapes", "ports", "markers", "refs" ]) region[key] = target.region[key].filter(o => o.roomId === target.room.id);
            const portIds = new Set(region.ports.map(p => p.id));
            region.links = target.region.links.filter(link => portIds.has(link.a) && portIds.has(link.b));
            return {
                ...target,
                region: region,
                x: pos.x - target.room.x,
                y: pos.y - target.room.y
            };
        }).filter(Boolean);
    }
    function paintWorldGateStorage(c, z) {
        for (const v of worldGateStorageViews()) {
            c.save();
            c.translate(v.x, v.y);
            paintRegion(c, v.region, z, {
                simple: true,
                clean: true,
                symbols: false
            });
            c.restore();
        }
    }
    function worldRegionOffset(r, g) {
        if (r.gateStorageOnly || g && ![ g.a.region, g.b.region ].includes(r.id)) {
            const v = worldGateStorageViews().find(v => v.region.id === r.id && (!g || v.gate.id === g.id));
            return v || {
                x: 0,
                y: 0
            };
        }
        return scene().placements[r.id] || {
            x: 0,
            y: 0
        };
    }
    function sceneBounds() {
        let boxes = scene().regions.map(id => {
            const r = w.regions.find(r => r.id === id), p = scene().placements[id] || {
                x: 0,
                y: 0
            };
            return {
                x: p.x,
                y: p.y,
                w: r.w,
                h: r.h
            };
        });
        boxes.push(...worldGateStorageViews().map(v => ({
            x: v.x + v.room.x,
            y: v.y + v.room.y,
            w: v.room.w,
            h: v.room.h
        })));
        if (!boxes.length) return {
            x: 0,
            y: 0,
            w: 280,
            h: 160
        };
        const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
        return {
            x: x,
            y: y,
            w: Math.max(...boxes.map(b => b.x + b.w)) - x,
            h: Math.max(...boxes.map(b => b.y + b.h)) - y
        };
    }
    function fit() {
        if (!w || !canvas) return;
        let b = world ? sceneBounds() : room() || {
            x: 0,
            y: 0,
            w: reg()?.w || 280,
            h: reg()?.h || 160
        };
        const v = viewSize();
        cam.z = Math.max(.12, Math.min(20, Math.min((v.w - 88) / b.w, (v.h - (world ? 96 * uiTextScale() : 90)) / b.h)));
        if (world && ctx) {
            const terrain = sceneBounds();
            for (let i = 0; i < 3; i++) {
                let x = terrain.x, y = terrain.y, right = x + terrain.w, bottom = y + terrain.h;
                for (const id of scene().regions) {
                    const r = w.regions.find(r => r.id === id), at = scene().placements[id] || {
                        x: 0,
                        y: 0
                    }, m = regionLabelMetrics(ctx, r, cam.z);
                    x = Math.min(x, at.x);
                    y = Math.min(y, at.y + m.top);
                    right = Math.max(right, at.x + m.width);
                    for (const marker of r.markers) if (visible(r, marker, marker.kind)) {
                        const half = markerSize(marker, true, cam.z) / cam.z / 2;
                        x = Math.min(x, at.x + marker.x - half);
                        y = Math.min(y, at.y + marker.y - half);
                        right = Math.max(right, at.x + marker.x + half);
                        bottom = Math.max(bottom, at.y + marker.y + half);
                    }
                }
                b = {
                    x: x,
                    y: y,
                    w: right - x,
                    h: bottom - y
                };
                cam.z = Math.max(.08, Math.min(20, Math.min((v.w - 64) / b.w, (v.h - 100) / b.h)));
            }
        }
        cam.x = (v.w - b.w * cam.z) / 2 - b.x * cam.z;
        cam.y = (v.h - b.h * cam.z) / 2 - b.y * cam.z;
        draw();
    }
    function zoom(factor, p) {
        hoverRegionTitleId = null;
        const v = viewSize();
        p ||= {
            x: v.w / 2,
            y: v.h / 2
        };
        const z = Math.max(.08, Math.min(40, cam.z * factor));
        cam.x = p.x - (p.x - cam.x) * z / cam.z;
        cam.y = p.y - (p.y - cam.y) * z / cam.z;
        cam.z = z;
        draw();
    }
    function toWorld(p) {
        return {
            x: (p.x - cam.x) / cam.z,
            y: (p.y - cam.y) / cam.z
        };
    }
    function eventPos(e) {
        const b = canvas.getBoundingClientRect();
        const scale = window.OCUIPreferences?.pageScale || 1;
        return {
            x: (e.clientX - b.left) / scale,
            y: (e.clientY - b.top) / scale
        };
    }
    function displayContext(simple = false, clean = cleanPreview) {
        return {
            regionId: regionId,
            layerId: layerId,
            roomId: roomId,
            world: world,
            editing: !simple && !world && !clean && !exportingImage,
            exporting: exportingImage,
            sceneId: sceneId
        };
    }
    function specialExpanded(r, l) {
        return OCMapRenderer.specialLayerExpanded(r, l, displayContext());
    }
    function contentShown(r, o) {
        return OCMapRenderer.contentShown(r, o, displayContext());
    }
    function terrainRegion(r, simple = false, clean = cleanPreview) {
        return OCMapRenderer.terrainRegion(r, displayContext(simple, clean));
    }
    function worldRegionAt(p) {
        return [ ...scene().regions ].reverse().find(id => {
            const r = w.regions.find(r => r.id === id), at = scene().placements[id] || {
                x: 0,
                y: 0
            };
            return C.inside(p, {
                ...at,
                w: r.w,
                h: r.h
            });
        });
    }
    function worldSymbolAt(p) {
        let best = null;
        for (const v of worldGateStorageViews()) {
            const marker = v.region.markers.find(m => m.kind === "gate" && m.roomId === v.room.id), x = v.x + (marker?.x ?? v.room.x + v.room.w / 2), y = v.y + (marker?.y ?? v.room.y + v.room.h / 2), distance = Math.hypot(p.x - x, p.y - y) * cam.z;
            if (distance < Math.max(lastPointerType === "touch" ? 22 : 9, markerSize({
                kind: "gate"
            }, true) / 2 + 2)) best = {
                gate: v.gate.id,
                distance: distance
            };
        }
        for (const id of [ ...scene().regions ].reverse()) {
            const r = w.regions.find(r => r.id === id), at = scene().placements[id] || {
                x: 0,
                y: 0
            };
            for (const m of r.markers) {
                if (!visible(r, m, m.kind)) continue;
                const distance = Math.hypot(p.x - at.x - m.x, p.y - at.y - m.y) * cam.z, radius = Math.max(lastPointerType === "touch" ? 22 : 9, markerSize(m, true) / 2 + 2);
                if (distance <= radius && (!best || distance < best.distance)) best = {
                    region: id,
                    marker: m.id,
                    room: m.roomId,
                    distance: distance
                };
            }
        }
        return best;
    }
    function activateMarker(o, edit = false) {
        if (!o) return;
        const shared = o.kind === "gate" && C.resolveSharedGateRoom?.(w, regionId, o.id);
        if (shared) {
            if (edit) {
                gateDialog(shared.gate, o);
                return;
            }
            openSharedGate(shared.gate);
            return;
        }
        selection = {
            list: "markers",
            id: o.id
        };
        layerId = o.layer || layerId;
        if (C.isRoomMarker(o) && o.roomId) {
            const rm = reg().rooms.find(r => r.id === o.roomId);
            if (rm && roomId !== rm.id) focusRoom(rm);
            selection = {
                list: "markers",
                id: o.id
            };
            if (edit && o.kind === "gate") {
                const gate = w.gates.find(g => [ g.a, g.b ].some(side => side.region === regionId && side.marker === o.id));
                gateDialog(gate, o);
                return;
            }
        }
        if (edit) {
            if ([ "pearl", "broadcast", "echo" ].includes(o.kind)) {
                recordDialog(o);
                return;
            }
            if (o.kind === "iterator") {
                iteratorDialog(o);
                return;
            }
            sidebar = "tools";
            $("mapSide").classList.add("panel-open");
            $("mapPanel").setAttribute("aria-expanded", "true");
        } else showRecordCard(o);
        renderSide();
        draw();
    }
    function tapWorldRegion(id) {
        const now = Date.now(), key = "world:" + id;
        if (lastObjectTap?.key === key && now - lastObjectTap.time < 420) {
            lastObjectTap = null;
            openRegion(id);
        } else {
            lastObjectTap = {
                key: key,
                time: now
            };
            selection = {
                list: "world",
                id: id
            };
            drawOverlay();
        }
    }
    function worldMovementEnabled() {
        return worldMoveUnlocked ?? !(compactUI() || lastPointerType === "touch");
    }
    function renderWorldMoveControl() {
        const b = lockButton(!worldMovementEnabled(), () => {
            worldMoveUnlocked = !worldMovementEnabled();
            renderTools();
            return false;
        }, "区域位置");
        b.id = "mapWorldMove";
        b.append(el("span", "", "移动区域"));
        b.title = worldMovementEnabled() ? "拖动区域调整位置；双击进入编辑" : "拖动画布；双击区域进入编辑";
        return b;
    }
    function linkedShelter(r, p) {
        const local = C.shelterAtPort(r, p);
        if (local) return {
            region: r,
            room: local
        };
        if (p.kind !== "exit") return null;
        const ref = p.sharedGateSource || {
            region: r.id,
            port: p.id
        };
        for (const g of w.gates.filter(g => g.visible !== false && g.scenes.includes(sceneId))) for (const link of g.connections || []) {
            const other = link.a.region === ref.region && link.a.port === ref.port ? link.b : link.b.region === ref.region && link.b.port === ref.port ? link.a : null, target = other && sharedGateConnectionPose(other), rm = target?.region.rooms.find(rm => rm.id === target.port.roomId);
            if (rm?.roomType === "SHELTER") return {
                region: target.region,
                room: rm
            };
        }
        return null;
    }
    function openLinkedShelter(target) {
        if (target.region.id !== regionId || world) openRegion(target.region.id);
        focusRoom(target.room);
    }
    function shelterEntranceShown(r, p, context = displayContext()) {
        const local = OCMapRenderer.shelterEntrance(r, p, context);
        if (local) return local;
        const target = linkedShelter(r, p);
        if (!target || target.region.categories.shelter?.visible === false || !C.roomVisible(target.region, target.room) || !C.roomVisible(r, p) || target.region.layers.find(l => l.id === target.room.layer)?.visible === false || r.layers.find(l => l.id === p.layer)?.visible === false || OCMapRenderer.contentShown(target.region, target.room, context) || !OCMapRenderer.contentShown(r, p, context) || p.sceneIds?.length && !p.sceneIds.includes(sceneId) || context.exporting && p.pngHidden) return null;
        return {
            ...target.room,
            sharedGateShelterRegion: target.region.id
        };
    }
    function visible(r, o, cat, context = displayContext()) {
        const shared = o.sharedGateId && w.gates.find(g => g.id === o.sharedGateId);
        if (shared && (shared.visible === false || !shared.scenes.includes(sceneId))) return false;
        if (world && shared && !r.sharedGateWorldView && r.id === shared.sharedRoom?.region && ![ shared.a.region, shared.b.region ].includes(r.id) && o.kind === "gate") return false;
        if (cat === "shelter" && o.roomId && (r.ports.some(p => shelterEntranceShown(r, p, context)?.id === o.roomId) || world && worldGateStorageViews().some(v => {
            const shown = previewRegion(v.region, cam.z, false);
            return shown.ports.some(p => shelterEntranceShown(shown, p, context)?.id === o.roomId);
        }))) return false;
        if (cat === "ports" && shelterEntranceShown(r, o, context)) return true;
        return !(exportingImage && o.pngHidden) && !(cat === "ports" && r.detailsVisible === false) && (C.isRoomMarker(o) || OCMapRenderer.contentShown(r, o, context)) && C.roomVisible(r, o) && r.layers.find(l => l.id === o.layer)?.visible !== false && (r.categories[cat]?.visible !== false || exportingImage && o.pngVisible) && (!o.sceneIds?.length || o.sceneIds.includes(sceneId));
    }
    function cat(o) {
        return o.material === "water" ? "water" : "geometry";
    }
    function trace(c, s) {
        c.beginPath();
        if (s.points) {
            c.moveTo(s.points[0].x, s.points[0].y);
            for (const p of s.points.slice(1)) c.lineTo(p.x, p.y);
            if (s.type === "polygon") c.closePath();
        } else if (s.type === "ellipse") c.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2); else c.rect(s.x, s.y, s.w, s.h);
    }
    function refDraw(c, ref, parentAlpha = 1) {
        if (!ref.visible) return;
        const i = getImage(ref.src);
        if (!i.complete || !i.naturalWidth) return;
        c.save();
        c.globalAlpha = ref.opacity * parentAlpha;
        c.translate(ref.x + ref.w / 2, ref.y + ref.h / 2);
        c.rotate((ref.angle || 0) * Math.PI / 180);
        c.scale(ref.flipX ? -1 : 1, ref.flipY ? -1 : 1);
        c.drawImage(i, -ref.w / 2, -ref.h / 2, ref.w, ref.h);
        c.restore();
    }
    const makeRenderCanvas = (width, height) => {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        return c;
    };
    const paintTerrain = OCMapRenderer.createCached(makeRenderCanvas);
    const paintTerrainExport = OCMapRenderer.create(makeRenderCanvas);
    const drawSymbol = OCMapRenderer.symbolPainter(makeRenderCanvas);
    function compactUI() {
        const v = window.OCUIPreferences?.viewport?.(), width = v?.layoutWidth || window.innerWidth || 1024, height = v?.layoutHeight || window.innerHeight || 768;
        return !exportingImage && (width < 700 || height < 440 && width > height || window.matchMedia?.("(pointer:coarse)").matches === true);
    }
    function iconScaleKey() {
        return compactUI() ? "iconScaleMobile" : "iconScaleDesktop";
    }
    function iconScale() {
        const v = w?.settings[iconScaleKey()];
        return Number.isFinite(v) ? Math.max(.25, Math.min(8, v)) : compactUI() ? .5 : .8;
    }
    function iconScaleControl() {
        const box = el("div", "map-icon-scale"), label = el("label", "", compactUI() ? "手机图标大小" : "电脑图标大小"), controls = el("div", "map-icon-scale-controls"), slider = el("input"), value = el("output"), key = iconScaleKey(), defaultScale = compactUI() ? .5 : .8;
        slider.id = "mapIconScale";
        label.setAttribute("for", slider.id);
        slider.type = "range";
        slider.min = 25;
        slider.max = 800;
        slider.step = 5;
        slider.setAttribute("aria-label", "图标大小");
        const sync = () => {
            slider.value = Math.round(iconScale() * 100);
            value.textContent = slider.value + "%";
            slider.setAttribute("aria-valuetext", value.textContent);
        };
        const chosen = () => Math.max(.25, Math.min(8, Number(slider.value) / 100));
        slider.oninput = () => {
            value.textContent = slider.value + "%";
            const saved = w.settings[key];
            try {
                w.settings[key] = chosen();
                draw();
            } finally {
                w.settings[key] = saved;
            }
        };
        slider.onchange = () => {
            change(() => w.settings[key] = chosen());
            sync();
        };
        slider.onpointercancel = () => {
            sync();
            draw();
        };
        const reset = button("重置", () => {
            change(() => w.settings[key] = defaultScale);
            sync();
            draw();
        });
        controls.append(slider, value, reset);
        box.append(label, controls);
        sync();
        return box;
    }
    function markerSize(marker, simple = false, z = cam.z) {
        return (marker.kind === "echo" ? simple ? 32 : 40 : simple ? 20 : 26) * iconScale() * (simple && !exportingImage ? Math.max(.6, Math.min(1, Math.sqrt(z / .75))) : 1);
    }
    function portSize(simple = false, z = cam.z) {
        return (simple ? 16 : 20) * iconScale() * (simple && !exportingImage ? Math.max(.6, Math.min(1, Math.sqrt(z / .75))) : 1);
    }
    function paintRegion(c, r, z, {simple: simple = false, clean: clean = cleanPreview, decorations: decorations = true, symbols: symbols = true} = {}) {
        r = previewRegion(r, z, clean || simple);
        c.save();
        c.beginPath();
        c.rect(0, 0, r.w, r.h);
        c.clip();
        const editing = !simple && !clean, terrain = terrainRegion(r, simple, clean);
        (exportingImage ? paintTerrainExport : paintTerrain)(c, editing ? {
            ...terrain,
            layers: [ ...terrain.layers.filter(l => l.id !== layerId), ...terrain.layers.filter(l => l.id === layerId) ]
        } : terrain, z, {
            backgrounds: exportingImage || C.backgroundsShown(w.settings, z),
            workSurface: editing && !r.rooms.length,
            activeShapes: editing && preview && [ "line", "rect", "ellipse", "polygon" ].includes(preview.type) ? C.mirrored(preview, symmetryState()) : null,
            beforeTerrain: editing && r.categories.refs.visible ? (cc, lid) => {
                for (const ref of r.refs) if (!ref.front && ref.layer === lid && visible(r, ref, "refs")) refDraw(cc, ref);
            } : null
        }, r, OCMapRenderer.presentationKey(r, displayContext(simple, clean)));
        if (editing && w.settings.grid && z >= 8) {
            c.strokeStyle = "#808080";
            c.lineWidth = .35 / z;
            c.beginPath();
            const v = viewSize(), owner = room() || r.rooms.find(rm => rm.id === portPlacement?.roomId) || r.rooms.find(rm => rm.id === hoverRoomId), ox = owner ? owner.x - Math.floor(owner.x) : 0, oy = owner ? owner.y - Math.floor(owner.y) : 0, x1 = Math.max(0, Math.floor(-cam.x / z - ox)), x2 = Math.min(Math.floor(r.w - ox), Math.ceil((v.w - cam.x) / z - ox)), y1 = Math.max(0, Math.floor(-cam.y / z - oy)), y2 = Math.min(Math.floor(r.h - oy), Math.ceil((v.h - cam.y) / z - oy));
            for (let x = x1; x <= x2; x++) {
                c.moveTo(x + ox, y1 + oy);
                c.lineTo(x + ox, y2 + oy);
            }
            for (let y = y1; y <= y2; y++) {
                c.moveTo(x1 + ox, y + oy);
                c.lineTo(x2 + ox, y + oy);
            }
            c.stroke();
        }
        if (editing && decorations) {
            for (const rm of r.rooms) {
                if (rm.visible === false || !contentShown(r, rm)) continue;
                if (r.layers.find(l => l.id === rm.layer)?.visible === false) continue;
                c.save();
                c.globalAlpha *= C.objectOpacity(r, rm);
                if (r.categories.rooms.visible) {
                    c.strokeStyle = r.border;
                    c.lineWidth = 1 / z;
                    c.setLineDash([ 5 / z, 5 / z ]);
                    c.strokeRect(rm.x, rm.y, rm.w, rm.h);
                    c.setLineDash([]);
                }
                if (r.categories.roomNames?.visible && z > .7) {
                    c.fillStyle = r.border;
                    c.strokeStyle = "#000000";
                    c.lineWidth = 2 / z;
                    c.font = 10 / z + "px monospace";
                    c.strokeText(rm.name, rm.x + 2 / z, rm.y + 12 / z);
                    c.fillText(rm.name, rm.x + 2 / z, rm.y + 12 / z);
                }
                if (r.categories.cameras.visible) {
                    for (const camera of rm.cameras) {
                        c.strokeStyle = "#808080";
                        c.setLineDash([ 2 / z, 3 / z ]);
                        c.strokeRect(rm.x + camera.x, rm.y + camera.y, 70, 40);
                        c.setLineDash([]);
                    }
                }
                c.restore();
            }
        }
        if (r.detailsVisible !== false && r.categories.connections.visible && !editing) {
            c.lineWidth = 1 / z;
            c.strokeStyle = "#808080";
            c.setLineDash([ 4 / z, 4 / z ]);
            for (const link of r.links) {
                const p = r.ports.find(p => p.id === link.a), q = r.ports.find(p => p.id === link.b);
                if (!p || !q || !C.roomVisible(r, p) || !C.roomVisible(r, q)) continue;
                const pv = C.roomVisible(r, p) && r.layers.find(l => l.id === p.layer)?.visible !== false, qv = C.roomVisible(r, q) && r.layers.find(l => l.id === q.layer)?.visible !== false;
                if (!pv && !qv) continue;
                c.globalAlpha = (pv && qv ? 1 : .3) * Math.min(C.objectOpacity(r, p), C.objectOpacity(r, q));
                c.beginPath();
                const pp = C.portPose(r, p), qp = C.portPose(r, q);
                c.moveTo(pp.x, pp.y);
                const mid = (pp.x + qp.x) / 2;
                c.bezierCurveTo(mid, pp.y, mid, qp.y, qp.x, qp.y);
                c.stroke();
            }
            c.globalAlpha = 1;
            c.setLineDash([]);
        }
        if (!simple && r.categories.connections.visible) paintSharedGateConnections(c, z, r);
        if (editing && r.categories.refs.visible) for (const ref of r.refs) if (ref.front && visible(r, ref, "refs")) refDraw(c, ref, C.objectOpacity(r, ref));
        c.restore();
        if (symbols) paintRegionSymbols(c, r, z, simple, clean);
    }
    function paintRegionSymbols(c, r, z, simple = false, clean = cleanPreview) {
        r = previewRegion(r, z, simple || clean || exportingImage);
        c.save();
        const context = displayContext(simple, clean);
        for (const p of r.ports) {
            if (!visible(r, p, "ports", context)) continue;
            const shelter = shelterEntranceShown(r, p, context), size = (shelter ? markerSize({
                kind: "shelter"
            }, simple, z) : portSize(simple, z)) / z, shelterRegion = shelter?.sharedGateShelterRegion ? w.regions.find(rr => rr.id === shelter.sharedGateShelterRegion) : r, img = getImage(shelter ? C.shelterIconSource(shelterRegion, shelter) : portAsset(p.kind));
            if (img.complete && img.naturalWidth) {
                const pose = C.portPose(r, p);
                c.save();
                c.globalAlpha = C.objectOpacity(r, p) * (shelter ? C.objectOpacity(shelterRegion, shelter) : 1);
                c.translate(pose.x, pose.y);
                c.rotate(shelter ? 0 : pose.angle);
                drawSymbol(c, img, 0, 0, size, z);
                c.restore();
            }
        }
        for (const m of r.markers) {
            if (!visible(r, m, m.kind, context)) continue;
            c.save();
            c.globalAlpha = OCMapRenderer.symbolOpacity(r, m);
            if (simple && m.kind === "gate" && m.sharedGateRoom && m.sharedGateRoom.region !== r.id && (scene().regions.includes(m.sharedGateRoom.region) || w.regions.find(rr => rr.id === m.sharedGateRoom.region)?.gateStorageOnly)) {
                c.fillStyle = "#ffffff";
                c.fillRect(m.x - 2 / z, m.y - 2 / z, 4 / z, 4 / z);
                c.restore();
                continue;
            }
            const size = markerSize(m, simple, z) / z, shared = m.kind === "gate" && C.sharedGateForRoom(w, r.id, m.roomId);
            if (shared && w.settings.gateKarmaIcons) {
                for (const [i, side] of [ shared.a, shared.b ].entries()) {
                    const key = side.karma === "locked" ? "gate-locked" : "karma-" + (side.karma || "1"), img = getImage("rainworld-icons/" + key + ".png");
                    if (img.complete && img.naturalWidth) drawSymbol(c, img, m.x + (i ? 1 : -1) * size * .32, m.y, size * .72, z);
                }
            } else if (m.kind === "iterator" && window.OCIteratorIcons) drawSymbol(c, window.OCIteratorIcons.mapCanvas(m, libraryDocs, () => {
                drawSymbol.clear();
                draw();
            }), m.x, m.y, size, z); else if (m.icon && m.kind !== "shelter") {
                const i = getImage(m.icon);
                if (i.complete && i.naturalWidth) drawSymbol(c, i, m.x, m.y, size, z);
            } else {
                const img = mapSymbolImage(m, r);
                if (img && (img.width || img.naturalWidth)) drawSymbol(c, img, m.x, m.y, size, z);
            }
            c.restore();
        }
        if (!simple) paintGateDestinationLabels(c, r, z, context);
        c.restore();
    }
    function paintGateDestinationLabels(c, r, z, context) {
        for (const g of w.gates.filter(g => g.scenes.includes(sceneId))) {
            const side = g.a.region === r.id ? g.a : g.b.region === r.id ? g.b : null;
            if (!side) continue;
            const marker = r.markers.find(m => m.id === side.marker), other = w.regions.find(rr => rr.id === (side === g.a ? g.b.region : g.a.region));
            if (!marker || !other || !visible(r, marker, "gate", context) || exportingImage && w.pngGateNotes?.some(n => n.id === g.id)) continue;
            const rm = marker.roomId && r.rooms.find(rm => rm.id === marker.roomId), expanded = rm && OCMapRenderer.contentShown(r, rm, context), x = expanded ? rm.x + rm.w / 2 : marker.x, y = expanded ? rm.y + rm.h + 14 / z : marker.y + (markerSize(marker, false, z) / 2 + 14) / z;
            c.save();
            c.font = 12 / z + "px " + mapFontFamily();
            c.textAlign = "center";
            c.strokeStyle = "#000000";
            c.lineWidth = 3 / z;
            c.fillStyle = other.labelColor || "#ffffff";
            const label = "↔ " + other.name;
            c.strokeText(label, x, y);
            c.fillText(label, x, y);
            c.restore();
        }
    }
    function paintWorldSymbols(c, z) {
        for (const v of worldGateStorageViews()) {
            c.save();
            c.translate(v.x, v.y);
            paintRegionSymbols(c, v.region, z, true);
            c.restore();
        }
        for (const id of scene().regions) {
            const r = w.regions.find(r => r.id === id), p = scene().placements[id] || {
                x: 0,
                y: 0
            };
            c.save();
            c.translate(p.x, p.y);
            paintRegionSymbols(c, r, z, true);
            c.restore();
        }
    }
    function sharedGateConnectionPose(ref) {
        const r = w.regions.find(r => r.id === ref?.region), p = r?.ports.find(p => p.id === ref.port);
        return r && p ? {
            region: r,
            port: p,
            pose: C.portPose(r, p)
        } : null;
    }
    function paintSharedGateConnections(c, z, onlyRegion = null) {
        for (const g of w.gates.filter(g => g.visible !== false && g.scenes.includes(sceneId))) {
            if (![ g.a, g.b ].filter(side => side.region).every(side => {
                const r = w.regions.find(r => r.id === side.region), m = r?.markers.find(m => m.id === side.marker);
                return r && m && visible(r, m, "gate");
            })) continue;
            for (const link of g.connections || []) {
                const a = sharedGateConnectionPose(link.a), b = sharedGateConnectionPose(link.b);
                if (!a || !b || a.region.categories.connections?.visible === false || b.region.categories.connections?.visible === false) continue;
                let ap, bp;
                if (onlyRegion) {
                    if (a.region.id === b.region.id) {
                        if (a.region.id !== onlyRegion.id) continue;
                        ap = a.pose;
                        bp = b.pose;
                    } else {
                        const local = a.region.id === onlyRegion.id ? a : b.region.id === onlyRegion.id ? b : null;
                        if (!local || g.sharedRoom?.region === onlyRegion.id) continue;
                        const side = g.a.region === onlyRegion.id ? g.a : g.b, m = onlyRegion.markers.find(m => m.id === side.marker);
                        if (!m) continue;
                        const remote = local === a ? b : a, projected = onlyRegion.ports.find(p => p.sharedGateSource?.region === remote.region.id && p.sharedGateSource.port === remote.port.id);
                        ap = local.pose;
                        bp = projected ? C.portPose(onlyRegion, projected) : m;
                    }
                } else {
                    const aa = worldRegionOffset(a.region, g), bb = worldRegionOffset(b.region, g);
                    ap = {
                        x: aa.x + a.pose.x,
                        y: aa.y + a.pose.y
                    };
                    bp = {
                        x: bb.x + b.pose.x,
                        y: bb.y + b.pose.y
                    };
                }
                c.save();
                c.strokeStyle = "#999999";
                c.lineWidth = 1 / z;
                c.setLineDash([ 4 / z, 4 / z ]);
                c.beginPath();
                c.moveTo(ap.x, ap.y);
                c.lineTo(bp.x, bp.y);
                c.stroke();
                c.restore();
            }
        }
    }
    function paintWorldGates(c, z) {
        for (const gate of w.gates.filter(g => g.visible !== false && g.scenes.includes(sceneId))) {
            if (!exportingImage && !cleanPreview && gate.id === selectedGateId) continue;
            const a = w.regions.find(r => r.id === gate.a.region), b = w.regions.find(r => r.id === gate.b.region);
            if (!a || !b || !a.categories.gate.visible || !b.categories.gate.visible) continue;
            const am = previewRegion(a, z, true).markers.find(o => o.id === gate.a.marker), bm = previewRegion(b, z, true).markers.find(o => o.id === gate.b.marker);
            if (!am || !bm || !visible(a, am, "gate") || !visible(b, bm, "gate")) continue;
            c.save();
            c.globalAlpha *= Math.min(C.objectOpacity(a, am), C.objectOpacity(b, bm));
            const ap = scene().placements[a.id] || {
                x: 0,
                y: 0
            }, bp = scene().placements[b.id] || {
                x: 0,
                y: 0
            };
            c.strokeStyle = "#808080";
            c.lineWidth = 1 / z;
            c.setLineDash([ 6 / z, 5 / z ]);
            c.beginPath();
            c.moveTo(ap.x + am.x, ap.y + am.y);
            c.lineTo(bp.x + bm.x, bp.y + bm.y);
            c.stroke();
            c.setLineDash([]);
            c.restore();
        }
        paintSharedGateConnections(c, z);
    }
    function mapBackground() {
        return world ? w.settings.canvasBackground || "#000000" : reg()?.bg || "#000000";
    }
    function mapLabelColor() {
        const hex = mapBackground().slice(1);
        return parseInt(hex.slice(0, 2), 16) * .299 + parseInt(hex.slice(2, 4), 16) * .587 + parseInt(hex.slice(4, 6), 16) * .114 > 140 ? "#000000" : "#ffffff";
    }
    let drawPending = false;
    function draw() {
        if (drawPending || !active || !ctx || !w) return;
        drawPending = true;
        requestAnimationFrame(() => {
            drawPending = false;
            drawNow();
        });
    }
    function drawNow() {
        if (!active || !ctx || !w) return;
        const v = viewSize(), ratio = canvas.width / (v.w || 1);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, v.w, v.h);
        ctx.fillStyle = mapBackground();
        ctx.fillRect(0, 0, v.w, v.h);
        ctx.save();
        ctx.translate(cam.x, cam.y);
        ctx.scale(cam.z, cam.z);
        ctx.imageSmoothingEnabled = false;
        if (world) {
            for (const id of scene().regions) {
                const r = w.regions.find(r => r.id === id), p = scene().placements[id] || {
                    x: 0,
                    y: 0
                };
                if ((p.x + r.w) * cam.z + cam.x < -80 || p.x * cam.z + cam.x > v.w + 80 || (p.y + r.h) * cam.z + cam.y < -80 || p.y * cam.z + cam.y > v.h + 80) continue;
                ctx.save();
                ctx.translate(p.x, p.y);
                paintRegion(ctx, r, cam.z, {
                    simple: true,
                    clean: true,
                    symbols: false
                });
                if (!cleanPreview && w.settings.showRegionBounds) {
                    ctx.strokeStyle = mapLabelColor();
                    ctx.lineWidth = 1 / cam.z;
                    ctx.setLineDash([ 5 / cam.z, 5 / cam.z ]);
                    ctx.strokeRect(0, 0, r.w, r.h);
                    ctx.setLineDash([]);
                }
                ctx.restore();
            }
            paintWorldGateStorage(ctx, cam.z);
            paintWorldGates(ctx, cam.z);
            paintWorldSymbols(ctx, cam.z);
            paintWorldLabels(ctx, cam.z);
        } else if (reg()) {
            const r = reg();
            paintRegion(ctx, r, cam.z);
            if (!cleanPreview) {
                if (w.settings.showRegionBounds) {
                    ctx.strokeStyle = mapLabelColor();
                    ctx.lineWidth = 1 / cam.z;
                    ctx.setLineDash([ 5 / cam.z, 5 / cam.z ]);
                    ctx.strokeRect(0, 0, r.w, r.h);
                    ctx.setLineDash([]);
                }
                if (preview?.type === "room") {
                    ctx.strokeStyle = r.border;
                    ctx.lineWidth = 1 / cam.z;
                    ctx.setLineDash([ 5 / cam.z, 5 / cam.z ]);
                    ctx.strokeRect(preview.x, preview.y, preview.w, preview.h);
                    ctx.setLineDash([]);
                }
                if (polygon.length) {
                    ctx.strokeStyle = "#808080";
                    ctx.lineWidth = 1 / cam.z;
                    trace(ctx, {
                        points: polygon
                    });
                    ctx.stroke();
                }
            }
        }
        ctx.restore();
        canvas.style.filter = w.settings.invert ? "invert(1)" : "none";
        $("mapOverlay").style.filter = canvas.style.filter;
        drawOverlay();
        $("mapZoomValue").textContent = Math.round(cam.z * 50) + "%";
        $("mapCanvasLabel").textContent = "";
    }
    function canHit(o, category) {
        return (C.isRoomMarker(o) || contentShown(reg(), o)) && C.roomVisible(reg(), o) && !C.roomLocked(reg(), o) && (category === "rooms" ? reg().layers.find(l => l.id === o.layer)?.visible !== false : visible(reg(), o, category)) && !reg().layers.find(l => l.id === o.layer)?.locked && !reg().categories[category]?.locked;
    }
    function hit(p, onlyPorts = false) {
        const r = reg();
        if (!r) return null;
        const available = (o, category) => (C.isRoomMarker(o) || contentShown(r, o)) && C.roomVisible(r, o) && (category === "rooms" ? r.layers.find(l => l.id === o.layer)?.visible !== false : visible(r, o, category));
        for (const list of onlyPorts ? [ "ports" ] : [ "markers", "ports" ]) {
            let nearest = null, distance = Infinity;
            for (const o of r[list]) {
                if (!available(o, list === "markers" ? o.kind : "ports")) continue;
                const pose = list === "ports" ? C.portPose(r, o) : o, d = Math.min(Math.hypot(pose.x - p.x, pose.y - p.y), Math.hypot(o.x - p.x, o.y - p.y)) * cam.z, radius = Math.max(lastPointerType === "touch" ? 22 : 9, (list === "markers" ? markerSize(o) : portSize()) / 2 + 2);
                if (d <= radius && d < distance) {
                    nearest = o;
                    distance = d;
                }
            }
            if (nearest) return {
                list: list,
                id: nearest.id
            };
        }
        const lists = onlyPorts ? [ "ports" ] : [ "markers", "ports", "refs", ...roomId ? [ "shapes", "rooms" ] : [ "rooms", "shapes" ] ];
        for (const list of lists) {
            if (!onlyPorts && list === "rooms" && selection?.list === "rooms") {
                const current = selected();
                if (current && available(current, "rooms") && C.inside(p, current) && Math.min(p.x - current.x, p.y - current.y, current.x + current.w - p.x, current.y + current.h - p.y) < 7 / cam.z) return selection;
            }
            for (const o of [ ...r[list].filter(o => o.layer !== layerId), ...r[list].filter(o => o.layer === layerId) ].reverse()) {
                const category = list === "shapes" ? cat(o) : list === "markers" ? o.kind : list;
                if (!available(o, category)) continue;
                const radius = Math.max(downPointer !== null && touches.size ? 20 : 11, list === "markers" ? markerSize(o) / 2 + 2 : list === "ports" ? portSize() / 2 + 2 : 0) / cam.z, pose = list === "ports" ? C.portPose(r, o) : o, yes = list === "shapes" ? C.hitShape(o, p) : list === "markers" || list === "ports" ? Math.min(Math.hypot(pose.x - p.x, pose.y - p.y), Math.hypot(o.x - p.x, o.y - p.y)) < radius : C.inside(p, o);
                if (yes) return {
                    list: list,
                    id: o.id
                };
            }
        }
        return null;
    }
    function roomAt(p) {
        return room() || [ ...reg().rooms ].reverse().find(o => o.visible !== false && o.layer === layerId && C.inside(p, o));
    }
    function bounded(p, activeDrag = drag) {
        const r = reg(), box = w.settings.crossRoomEdit === false ? strokeOwner || room() || {
            x: 0,
            y: 0,
            w: r.w,
            h: r.h
        } : {
            x: 0,
            y: 0,
            w: r.w,
            h: r.h
        }, cellStroke = [ "line", "brush", "erase" ].includes(tool), odd = cellStroke && Math.max(1, Math.round(brush)) % 2 === 1, padding = odd ? .5 : 0, clamp = (value, start, size) => Math.max(start + padding, Math.min(start + size - padding, value));
        if (cellStroke && activeDrag?.mode === "draw") return {
            x: clamp(activeDrag.start.x + p.x - activeDrag.p.x, box.x, box.w),
            y: clamp(activeDrag.start.y + p.y - activeDrag.p.y, box.y, box.h)
        };
        const place = (value, start, size) => odd ? clamp(Math.floor(value) + .5, start, size) : Math.round(clamp(value, start, size));
        return {
            x: place(p.x, box.x, box.w),
            y: place(p.y, box.y, box.h)
        };
    }
    function shapeFor(a, b) {
        const decoration = activePaintLayer(), rm = decoration ? room() : w.settings.crossRoomEdit === false ? strokeOwner || roomAt(a) : null, common = {
            id: C.uid(),
            decoration: decoration,
            eraseAll: tool === "erase" || material === "air",
            material: decoration ? tool === "erase" || material === "air" ? "air" : "solid" : tool === "erase" && material !== "water" ? "air" : material,
            erase: tool === "erase",
            layer: layerId,
            depth: depth,
            roomId: rm?.id || null,
            width: Math.max(1, Math.round(brush)),
            .../^slope/.test(material) ? {
                slopeMode: "edge"
            } : {}
        };
        if ([ "line", "brush", "erase" ].includes(tool)) return {
            ...common,
            type: "line",
            points: [ a, b ]
        };
        return {
            ...common,
            type: tool,
            ...C.rect(a, b)
        };
    }
    function applyShape(s) {
        const r = reg(), cross = !s.decoration && w.settings.crossRoomEdit !== false, owner = cross ? null : strokeOwner || room() || roomAt(s.points?.[0] || s), box = owner || {
            x: 0,
            y: 0,
            w: r.w,
            h: r.h
        };
        const additions = [];
        for (const v of C.mirrored(s, symmetryState())) {
            let clip = C.intersection(C.bounds(v), box);
            if (owner?.roomType === "SHELTER") {
                const editable = C.shelterEditableBounds(owner);
                clip = editable && clip ? C.intersection(clip, editable) : null;
            }
            if (!clip) continue;
            v.clip = clip;
            v.roomId = owner?.id || null;
            let parts = [ v ];
            if (!cross && !owner) for (const rm of r.rooms.filter(rm => rm.layer === v.layer)) parts = parts.flatMap(p => C.subtract(p.clip, rm).map(clip => ({
                ...copy(p),
                id: C.uid(),
                clip: clip
            })));
            additions.push(...parts);
        }
        for (const v of additions) {
            if (C.lockedShapeForStroke(r, v)) throw Error("绘制范围内有锁定的地形，请先解锁。");
            const touched = r.rooms.filter(rm => rm.layer === v.layer && C.intersection(C.bounds(v), rm)), locked = touched.find(rm => rm.locked || C.roomPaintLayers(rm)[v.decoration || 0]?.locked);
            const reason = C.lockReason(r, {
                ...v,
                roomId: locked?.id || owner?.id
            }, cat(v), v.layer);
            if (reason) throw Error(reason + "；可点“全部解锁”。");
            if (v.eraseAll && !v.decoration) {
                for (const key of [ "geometry", "water" ]) if (r.categories[key].locked && r.shapes.some(o => o.layer === v.layer && !o.decoration && cat(o) === key && C.intersection(C.bounds(o), C.bounds(v)))) throw Error(C.categoryName(key) + "已锁定。");
            }
            r.categories[cat(v)].visible = true;
        }
        const previousShapeIds = new Set(r.shapes.map(o => o.id));
        r.shapes.push(...additions);
        for (const rm of r.rooms.filter(rm => rm.layer === s.layer)) C.cutShapes(r, rm);
        C.clipShelterEdits(r, r.shapes.filter(o => !previousShapeIds.has(o.id)).map(o => o.id));
        selection = null;
        strokeOwner = null;
    }
    function wireCanvas() {
        canvas.addEventListener("wheel", e => {
            e.preventDefault();
            zoom(Math.exp(-e.deltaY * .0015), eventPos(e));
        }, {
            passive: false
        });
        canvas.oncontextmenu = e => e.preventDefault();
        canvas.addEventListener("pointerdown", e => {
            if (!w) return;
            lastPointerType = e.pointerType || "mouse";
            snapGuides = [];
            downPointer = e.pointerId;
            canvas.focus({
                preventScroll: true
            });
            $("mapRecordCard")?.remove();
            closeDropdown();
            const p = eventPos(e), wp = toWorld(p);
            canvas.setPointerCapture(e.pointerId);
            if (e.pointerType === "touch") {
                if (!touches.size) touchSession = {
                    before: copy(w),
                    history: [ ...history ],
                    future: [ ...future ],
                    selection: selection ? copy(selection) : null,
                    connectStart: connectStart ? copy(connectStart) : null,
                    saved: saved,
                    saveError: saveError
                };
                touches.set(e.pointerId, {
                    ...p,
                    start: p
                });
                if (touches.size >= 2) {
                    resetPortPlacement();
                    setRegionTitleHover(null);
                    if (touchSession) {
                        w = copy(touchSession.before);
                        history = [ ...touchSession.history ];
                        future = [ ...touchSession.future ];
                        selection = touchSession.selection;
                        connectStart = touchSession.connectStart;
                        saved = touchSession.saved;
                        saveError = touchSession.saveError;
                        updateStatus();
                        document.querySelectorAll("dialog.map-dialog").forEach(d => d.close());
                    }
                    restoreBatchMove(drag);
                    if (drag?.mode === "batch-place") cutFrame = drag.frameBefore || null;
                    drag = null;
                    preview = null;
                    snapGuides = [];
                    const ts = [ ...touches.values() ];
                    gesture = {
                        start: Date.now(),
                        max: touches.size,
                        moved: false,
                        center: {
                            x: (ts[0].x + ts[1].x) / 2,
                            y: (ts[0].y + ts[1].y) / 2
                        },
                        distance: Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y),
                        cam: {
                            ...cam
                        }
                    };
                    draw();
                    return;
                }
            }
            if (e.button === 2) return;
            if (cleanPreview || tool === "pan" || spaceHeld || e.button === 1) {
                drag = {
                    mode: "pan",
                    p: p,
                    cam: {
                        ...cam
                    }
                };
                return;
            }
            if (batchPointerDown(wp, p, e)) return;
            if (tool === "link") {
                clickLinkPort(wp);
                return;
            }
            if (world) {
                selectedGateId = null;
                const symbol = worldSymbolAt(wp);
                if (symbol) {
                    drag = symbol.gate ? {
                        mode: "shared-gate-tap",
                        gate: symbol.gate,
                        p: p,
                        cam: {
                            ...cam
                        }
                    } : {
                        mode: "world-tap",
                        id: symbol.region,
                        marker: symbol.marker,
                        p: p,
                        cam: {
                            ...cam
                        }
                    };
                    return;
                }
                const title = hitRegionLabel(wp);
                if (title) {
                    setRegionTitleHover(title.id);
                    drag = {
                        mode: "region-label",
                        id: title.id,
                        p: p,
                        cam: e.pointerType === "touch" ? {
                            ...cam
                        } : null
                    };
                    return;
                }
                setRegionTitleHover(null);
                const id = [ ...scene().regions ].reverse().find(id => {
                    const r = w.regions.find(r => r.id === id), pp = scene().placements[id] || {
                        x: 0,
                        y: 0
                    };
                    return C.inside(wp, {
                        ...pp,
                        w: r.w,
                        h: r.h
                    });
                });
                if (id) {
                    selection = {
                        list: "world",
                        id: id
                    };
                    drag = !worldMovementEnabled() ? {
                        mode: "world-tap",
                        id: id,
                        p: p,
                        cam: {
                            ...cam
                        }
                    } : {
                        mode: "world",
                        id: id,
                        p: wp,
                        before: copy(w)
                    };
                } else drag = {
                    mode: "pan",
                    p: p,
                    cam: {
                        ...cam
                    }
                };
                draw();
                return;
            }
            if (!reg()) return;
            if (playerScale) {
                cursorPoint = wp;
                drawOverlay();
                return;
            }
            if (tool === "fill") {
                requireEdit(() => change(() => C.fillRegion(reg(), wp, {
                    ...fillOptions,
                    layer: layerId,
                    material: activePaintLayer() && material !== "air" ? "solid" : material,
                    decoration: activePaintLayer(),
                    depth: depth,
                    roomId: roomId,
                    crossRooms: w.settings.crossRoomEdit !== false
                })));
                return;
            }
            if (tool === "marquee") {
                startMarquee(wp, e);
                return;
            }
            if (tool === "region-resize") {
                const handle = C.hitRoomHandle(regionBox(), wp, (e.pointerType === "touch" ? 18 : 8) / cam.z);
                if (handle) requireEdit(() => {
                    if (downPointer === e.pointerId && touches.size < 2) {
                        drag = {
                            mode: "region-resize",
                            before: copy(w),
                            p: wp,
                            handle: handle
                        };
                        preview = {
                            type: "region-range",
                            x: 0,
                            y: 0,
                            w: reg().w,
                            h: reg().h
                        };
                        drawOverlay();
                    }
                }, {
                    regionScope: true
                });
                return;
            }
            if (symmetryHit(wp, e.pointerType === "touch")) {
                const sym = symmetryState();
                drag = {
                    mode: "symmetry",
                    before: copy(w),
                    p: wp,
                    center: {
                        x: sym.axisX,
                        y: sym.axisY
                    }
                };
                return;
            }
            if (tool === "room-resize") {
                const found = resizeHit(wp, e.pointerType === "touch");
                if (found) {
                    selection = {
                        list: "rooms",
                        id: found.rm.id
                    };
                    layerId = found.rm.layer;
                    if (C.needsNativeGeometryResize(found.rm) && !hasNativeResizeConsent(found.rm)) {
                        downPointer = null;
                        touches.clear();
                        requestNativeResize(found.rm, () => toast("已允许仅调整地形；请重新拖动房间边界。"));
                        return;
                    }
                    const before = copy(w);
                    requireEdit(() => {
                        if (touches.size < 2) {
                            drag = {
                                mode: "room-resize",
                                before: before,
                                p: wp,
                                id: found.rm.id,
                                handle: found.handle,
                                original: copy(found.rm),
                                geometryOnly: hasNativeResizeConsent(found.rm)
                            };
                            draw();
                        }
                    });
                } else {
                    const rm = editRooms().find(o => C.inside(wp, o));
                    selection = rm ? {
                        list: "rooms",
                        id: rm.id
                    } : null;
                    if (rm) {
                        layerId = rm.layer;
                        drag = {
                            mode: "move",
                            p: wp,
                            before: copy(w),
                            selection: copy(selection),
                            allowed: false
                        };
                    }
                    renderSide();
                    draw();
                }
                return;
            }
            if (tool === "split") {
                if (cutMethod === "frame") {
                    const handle = cutFrame && C.hitRoomHandle(cutFrame, wp, (e.pointerType === "touch" ? 18 : 8) / cam.z);
                    if (handle) {
                        drag = {
                            mode: "frame-resize",
                            frameBefore: copy(cutFrame),
                            p: wp,
                            handle: handle
                        };
                    } else if (cutFrame && C.inside(wp, cutFrame)) {
                        drag = {
                            mode: "frame-move",
                            frameBefore: copy(cutFrame),
                            p: wp
                        };
                    } else if (C.inside(wp, {
                        x: 0,
                        y: 0,
                        w: reg().w,
                        h: reg().h
                    })) {
                        placeCutFrame(wp);
                        renderTools();
                    }
                    draw();
                    return;
                }
                const rm = editRooms().find(o => C.inside(wp, o));
                if (!rm) return;
                selection = {
                    list: "rooms",
                    id: rm.id
                };
                layerId = rm.layer;
                requireEdit(() => {
                    drag = {
                        mode: "split",
                        id: rm.id,
                        p: wp,
                        before: copy(w)
                    };
                    preview = splitPreview(rm, wp);
                    draw();
                });
                return;
            }
            const symbolHit = [ "select", "link" ].includes(tool) ? hit(wp, tool === "link") : null, hitSymbol = symbolHit && [ "markers", "ports" ].includes(symbolHit.list);
            if (tool === "select" && !hitSymbol) {
                const projected = previewRegion(reg(), cam.z, false).rooms.find(rm => rm.sharedGateProjection && C.inside(wp, rm));
                if (projected) {
                    drag = {
                        mode: "shared-gate-tap",
                        gate: projected.sharedGateProjection,
                        p: p,
                        cam: {
                            ...cam
                        }
                    };
                    return;
                }
            }
            if (tool === "select" && room() && !C.inside(wp, room()) && !hitSymbol) {
                roomId = null;
                selection = null;
                refresh();
                return;
            }
            if (!C.inside(wp, {
                x: 0,
                y: 0,
                w: reg().w,
                h: reg().h
            }) && !hitSymbol) {
                selection = null;
                roomId = null;
                refresh();
                return;
            }
            if (tool === "select") {
                selection = hit(wp);
                if (selected()?.layer && !(selection.list === "markers" && C.isRoomMarker(selected()))) layerId = selected().layer;
                sidebar = "tools";
                renderSide();
                renderLayerSwitch();
                draw();
                if (selection) {
                    const obj = selected();
                    if (selection.list === "rooms" || [ "markers", "ports", "refs", "shapes" ].includes(selection.list)) drag = {
                        mode: "move",
                        p: wp,
                        before: copy(w),
                        selection: copy(selection),
                        allowed: false
                    };
                }
                return;
            }
            requireEdit(() => {
                const r = reg(), at = bounded(wp);
                if (tool === "port") {
                    updatePortPlacement(wp);
                    drag = {
                        mode: "port-place",
                        p: wp
                    };
                    return;
                }
                if (tool === "marker" && markerKind === "shelter") {
                    const rm = roomAt(at);
                    if (rm) {
                        shelterEntranceDialog(rm, at);
                    } else {
                        startShelterRoom(at);
                    }
                    return;
                }
                if (tool === "marker") {
                    placeNewMarker(at);
                    return;
                }
                if (tool === "polygon") {
                    polygon.push(at);
                    draw();
                    return;
                }
                strokeOwner = w.settings.crossRoomEdit === false ? room() || roomAt(wp) : null;
                drag = {
                    mode: "draw",
                    start: at,
                    p: wp,
                    before: copy(w)
                };
                preview = shapeFor(at, at);
                draw();
            });
        });
        canvas.addEventListener("pointermove", e => {
            const p = eventPos(e);
            if (touches.has(e.pointerId)) {
                const old = touches.get(e.pointerId);
                touches.set(e.pointerId, {
                    ...p,
                    start: old.start
                });
            }
            cursorPoint = toWorld(p);
            if (tool === "port" && !world && !cleanPreview && !gesture && (!drag || drag.mode === "port-place")) {
                updatePortPlacement(cursorPoint);
                if (drag?.mode === "port-place") return;
            }
            if (playerScale && !drag && !gesture) {
                canvas.style.cursor = "none";
                drawOverlay();
            } else if (!drag && !world && reg()) {
                const handle = tool === "region-resize" ? C.hitRoomHandle(regionBox(), cursorPoint, (e.pointerType === "touch" ? 18 : 8) / cam.z) : tool === "room-resize" ? resizeHit(cursorPoint, e.pointerType === "touch")?.handle : tool === "split" && cutFrame ? C.hitRoomHandle(cutFrame, cursorPoint, 8 / cam.z) : null;
                canvas.style.cursor = handle ? roomCursor(handle) : tool !== "region-resize" && symmetryHit(cursorPoint) ? "move" : tool === "split" ? "crosshair" : "default";
            }
            if (gesture && touches.size >= 2) {
                gesture.max = Math.max(gesture.max, touches.size);
                const ts = [ ...touches.values() ], center = {
                    x: (ts[0].x + ts[1].x) / 2,
                    y: (ts[0].y + ts[1].y) / 2
                }, distance = Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y), g = gesture, z = Math.max(.08, Math.min(40, g.cam.z * distance / (g.distance || 1)));
                if (Math.hypot(center.x - g.center.x, center.y - g.center.y) > 8 || Math.abs(distance - g.distance) > 8) g.moved = true;
                cam = {
                    x: center.x - (g.center.x - g.cam.x) * z / g.cam.z,
                    y: center.y - (g.center.y - g.cam.y) * z / g.cam.z,
                    z: z
                };
                draw();
                return;
            }
            if (!drag) {
                if (world) {
                    const title = hitRegionLabel(toWorld(p));
                    const id = title?.id || worldRegionAt(toWorld(p)) || null;
                    canvas.style.cursor = id ? "pointer" : "default";
                    const next = e.pointerType === "touch" ? null : id;
                    if (hoverRegionId !== next) {
                        hoverRegionId = next;
                        drawOverlay();
                    }
                    setRegionTitleHover(e.pointerType === "touch" ? null : title?.id || null);
                }
                if (!world && !cleanPreview && reg() && e.pointerType !== "touch") {
                    const wp = toWorld(p), rm = [ ...reg().rooms.filter(o => o.layer !== layerId), ...reg().rooms.filter(o => o.layer === layerId) ].reverse().find(o => contentShown(reg(), o) && o.visible !== false && reg().layers.find(l => l.id === o.layer)?.visible !== false && C.inside(wp, o));
                    const id = rm?.id || null;
                    if (id !== hoverRoomId) {
                        hoverRoomId = id;
                        drawOverlay();
                    }
                }
                return;
            }
            const wp = toWorld(p);
            if (drag.mode === "batch-place") {
                drag.moved ||= Math.hypot(wp.x - drag.p.x, wp.y - drag.p.y) * cam.z > (e.pointerType === "touch" ? 8 : 4);
                return;
            }
            if ([ "region-label", "world-tap", "shared-gate-tap" ].includes(drag.mode)) {
                if (Math.hypot(p.x - drag.p.x, p.y - drag.p.y) > 8) drag.moved = true;
                if (drag.moved) {
                    setRegionTitleHover(null);
                    if (drag.cam) {
                        cam.x = drag.cam.x + p.x - drag.p.x;
                        cam.y = drag.cam.y + p.y - drag.p.y;
                        draw();
                    }
                }
                return;
            }
            if (drag.mode === "symmetry") {
                C.setSymmetryCenter(reg(), room(), {
                    x: drag.center.x + wp.x - drag.p.x,
                    y: drag.center.y + wp.y - drag.p.y
                });
                drawOverlay();
                return;
            }
            if (drag.mode === "marquee") {
                drag.moved = Math.hypot(wp.x - drag.p.x, wp.y - drag.p.y) * cam.z > 3;
                selectionBox = C.rect(drag.p, wp);
                drawOverlay();
                return;
            }
            if (drag.mode === "selection-move") {
                w = copy(drag.before);
                multiSelection = copy(drag.refs);
                try {
                    C.transformSelection(reg(), multiSelection, {
                        dx: Math.round(wp.x - drag.p.x),
                        dy: Math.round(wp.y - drag.p.y),
                        crossRooms: w.settings.crossRoomEdit !== false
                    });
                    drag.error = "";
                } catch (error) {
                    w = copy(drag.before);
                    multiSelection = copy(drag.refs);
                    drag.error = error.message;
                }
                draw();
                return;
            }
            if (drag.mode === "region-resize") {
                preview = {
                    type: "region-range",
                    ...alignBox(C.regionResizeBox(reg(), drag.handle, wp.x - drag.p.x, wp.y - drag.p.y), {
                        handle: drag.handle,
                        region: true
                    })
                };
                drawOverlay();
                return;
            }
            if (drag.mode === "room-resize") {
                const previous = w;
                w = copy(drag.before);
                try {
                    C.resizeRoom(reg(), reg().rooms.find(o => o.id === drag.id), alignBox(C.roomResizeBox(reg(), drag.original, drag.handle, wp.x - drag.p.x, wp.y - drag.p.y), {
                        handle: drag.handle,
                        excludeId: drag.id
                    }), {
                        geometryOnly: drag.geometryOnly === true
                    });
                    drag.error = "";
                } catch (error) {
                    w = previous;
                    snapGuides = [];
                    drag.error = error.message;
                }
                draw();
                return;
            }
            if (drag.mode === "frame-resize") {
                cutFrame = alignBox({
                    ...drag.frameBefore,
                    ...C.roomResizeBox(reg(), drag.frameBefore, drag.handle, wp.x - drag.p.x, wp.y - drag.p.y)
                }, {
                    handle: drag.handle,
                    frame: true
                });
                drawOverlay();
                return;
            }
            if (drag.mode === "frame-move") {
                const before = drag.frameBefore;
                cutFrame = {
                    ...before,
                    x: Math.round(Math.max(0, Math.min(reg().w - before.w, before.x + wp.x - drag.p.x))),
                    y: Math.round(Math.max(0, Math.min(reg().h - before.h, before.y + wp.y - drag.p.y)))
                };
                cutFrame = alignBox(cutFrame, {
                    frame: true
                });
                drawOverlay();
                return;
            }
            if (drag.mode === "split") {
                preview = splitPreview(reg().rooms.find(o => o.id === drag.id), wp);
                drawOverlay();
                return;
            }
            if (drag.mode === "pan") {
                cam.x = drag.cam.x + p.x - drag.p.x;
                cam.y = drag.cam.y + p.y - drag.p.y;
                draw();
                return;
            }
            if (drag.mode === "world") {
                if (Math.hypot(wp.x - drag.p.x, wp.y - drag.p.y) * cam.z < 4 && !drag.moved) return;
                drag.moved = true;
                const original = drag.before.scenes.find(s => s.id === sceneId).placements[drag.id] || {
                    x: 0,
                    y: 0
                };
                scene().placements[drag.id] = {
                    x: Math.round(original.x + wp.x - drag.p.x),
                    y: Math.round(original.y + wp.y - drag.p.y)
                };
                draw();
                return;
            }
            if (drag.mode === "move") {
                if (!drag.allowed) {
                    if (Math.hypot(wp.x - drag.p.x, wp.y - drag.p.y) * cam.z < (e.pointerType === "touch" ? 8 : 4)) return;
                    const d = drag;
                    requireEdit(() => {
                        if (drag === d) drag.allowed = true;
                    });
                    if (!drag?.allowed) return;
                }
                w = copy(drag.before);
                const r = reg(), o = selected(), dx = Math.round(wp.x - drag.p.x), dy = Math.round(wp.y - drag.p.y);
                try {
                    if (selection.list === "ports") {
                        const origin = C.portPose(r, o), suggestion = suggestEditorPort({
                            x: origin.x + wp.x - drag.p.x,
                            y: origin.y + wp.y - drag.p.y
                        }, o);
                        if (suggestion.valid) {
                            Object.assign(o, suggestion.position, {
                                facing: suggestion.facing,
                                roomId: suggestion.roomId
                            });
                            drag.error = "";
                        } else drag.error = suggestion.reason;
                    } else if (selection.list === "rooms") {
                        const box = alignBox({
                            ...o,
                            x: Math.round(Math.max(0, Math.min(r.w - o.w, o.x + dx))),
                            y: Math.round(Math.max(0, Math.min(r.h - o.h, o.y + dy)))
                        }, {
                            excludeId: o.id,
                            excludeContents: true
                        });
                        C.moveRoom(r, o, box.x - o.x, box.y - o.y);
                    } else {
                        const b = C.bounds(o), bx = Number.isFinite(b.w) ? b.w : 0, by = Number.isFinite(b.h) ? b.h : 0;
                        let mx = Math.max(-b.x, Math.min(dx, r.w - b.x - bx)), my = Math.max(-b.y, Math.min(dy, r.h - b.y - by));
                        if (o.roomId && !C.isRoomMarker(o)) {
                            const rm = r.rooms.find(a => a.id === o.roomId);
                            if (rm) {
                                mx = Math.max(rm.x - b.x, Math.min(mx, rm.x + rm.w - b.x - bx));
                                my = Math.max(rm.y - b.y, Math.min(my, rm.y + rm.h - b.y - by));
                            }
                        }
                        const box = alignBox({
                            x: b.x + mx,
                            y: b.y + my,
                            w: bx,
                            h: by
                        }, {
                            excludeId: o.id,
                            owner: o.roomId && !C.isRoomMarker(o) ? r.rooms.find(rm => rm.id === o.roomId) : null
                        });
                        C.shift(o, box.x - b.x, box.y - b.y);
                    }
                } catch {
                    snapGuides = [];
                }
                draw();
                return;
            }
            if (drag.mode === "draw") {
                const b = bounded(wp);
                if (tool === "brush" || tool === "erase") {
                    const last = preview.points.at(-1);
                    if (Math.hypot(last.x - b.x, last.y - b.y) > .4) preview.points.push(b);
                } else preview = shapeFor(drag.start, b);
                draw();
            }
        });
        const finish = (e, cancel = false) => {
            const hadGuides = snapGuides.length;
            snapGuides = [];
            if (hadGuides) drawOverlay();
            if (downPointer === e.pointerId) downPointer = null;
            if (touches.has(e.pointerId)) touches.delete(e.pointerId);
            if (gesture) {
                if (!touches.size) {
                    const g = gesture;
                    gesture = null;
                    touchSession = null;
                    resetPortPlacement();
                    refresh();
                    if (!g.moved && Date.now() - g.start < 330 && !cancel) {
                        const now = Date.now(), count = g.max;
                        if (lastTap[count] && now - lastTap[count] < 380) {
                            count === 2 ? undo() : count === 3 ? redo() : null;
                            lastTap[count] = 0;
                        } else lastTap[count] = now;
                    }
                }
                drag = null;
                preview = null;
                return;
            }
            if (!touches.size) touchSession = null;
            if (!drag) return;
            const d = drag;
            drag = null;
            if (cancel) {
                resetPortPlacement();
                setRegionTitleHover(null);
                if (d.refs) multiSelection = d.refs;
                if (d.before) w = d.before;
                if (d.frameBefore) cutFrame = d.frameBefore; else if (d.mode === "batch-place") cutFrame = null;
                restoreBatchMove(d);
                preview = null;
                draw();
                return;
            }
            if (d.mode === "frame-resize" && batchCreateEnabled() && cutIntent === "create" && cutFrame) {
                pendingRoomPreset = {
                    ...pendingRoomPreset,
                    w: cutFrame.w,
                    h: cutFrame.h
                };
                renderTools();
            }
            if (d.mode === "batch-place") {
                finishBatchPlacement(d, toWorld(eventPos(e)));
                draw();
                return;
            }
            if (d.mode === "port-place") {
                updatePortPlacement(toWorld(eventPos(e)));
                placeSuggestedPort();
                return;
            }
            if (d.mode === "move" && d.allowed && selection?.list === "ports") {
                finishPortDrag(d, toWorld(eventPos(e)));
                restoreBatchMove(d);
                return;
            }
            if (d.mode === "marquee") {
                if (marqueeTarget === "rooms") {
                    const click = !d.moved, box = click ? {
                        x: d.p.x,
                        y: d.p.y,
                        w: .001,
                        h: .001
                    } : selectionBox, hits = C.selectRooms(reg(), layerId, box).filter(ref => contentShown(reg(), reg().rooms.find(rm => rm.id === ref.id)));
                    multiSelection = d.additive ? click && hits.length && d.refs.some(ref => ref.id === hits[0].id) ? d.refs.filter(ref => ref.id !== hits[0].id) : [ ...new Map([ ...d.refs, ...hits ].map(ref => [ ref.id, ref ])).values() ] : hits;
                    selectionBox = null;
                } else finishContentSelection(d.p, toWorld(eventPos(e)));
                renderTools();
                renderSide();
                drawOverlay();
                return;
            }
            if (d.mode === "selection-move") {
                selectionMoveArmed = false;
                const after = copy(w);
                w = d.before;
                if (d.error) toast(d.error); else change(() => w = after);
                draw();
                return;
            }
            if (d.mode === "shared-gate-tap") {
                if (!d.moved) openSharedGate(w.gates.find(g => g.id === d.gate));
                return;
            }
            if (d.mode === "world-tap") {
                if (!d.moved) {
                    if (d.marker) {
                        openRegion(d.id);
                        activateMarker(reg().markers.find(m => m.id === d.marker));
                    } else tapWorldRegion(d.id);
                }
                return;
            }
            if (d.mode === "world" && !d.moved) {
                if (e.pointerType === "touch" && !d.batchMove) tapWorldRegion(d.id);
                return;
            }
            if (d.mode === "region-label") {
                setRegionTitleHover(null);
                if (!d.moved) regionTitleDialog(w.regions.find(r => r.id === d.id));
                return;
            }
            if (d.mode === "move" && !d.allowed && d.batchMove) {
                restoreBatchMove(d);
                draw();
                return;
            }
            if (d.mode === "move" && !d.allowed && selection) {
                const now = Date.now(), key = selection.list + ":" + selection.id, twice = e.pointerType === "touch" && lastObjectTap?.key === key && now - lastObjectTap.time < 420;
                lastObjectTap = twice ? null : {
                    key: key,
                    time: now
                };
                if (selection.list === "ports") {
                    const shelter = linkedShelter(reg(), selected());
                    if (shelter) {
                        openLinkedShelter(shelter);
                        return;
                    }
                }
                if (selection.list === "markers") {
                    activateMarker(selected(), twice);
                    return;
                }
                if (twice && selection.list === "rooms") {
                    focusRoom(selected());
                    return;
                }
            }
            if (d.mode === "region-resize") {
                const box = preview;
                preview = null;
                if (box) change(() => C.resizeRegion(w, reg(), box));
                draw();
                return;
            }
            if (d.mode === "split") {
                const cut = preview;
                preview = null;
                if (cut) change(() => {
                    C.splitRoom(reg(), reg().rooms.find(o => o.id === cut.roomId), cut.vertical, cut.at);
                    selection = null;
                });
            }
            if ((d.mode === "room-resize" || d.mode === "move" && selection?.list === "ports") && d.error) toast(d.error);
            if (d.mode === "draw") {
                if (preview) {
                    const endpoint = bounded(toWorld(eventPos(e)), d);
                    if ([ "brush", "erase" ].includes(tool)) {
                        const last = preview.points.at(-1);
                        if (Math.hypot(last.x - endpoint.x, last.y - endpoint.y) > 1e-8) preview.points.push(endpoint);
                    } else preview = shapeFor(d.start, endpoint);
                }
                const shape = preview;
                preview = null;
                if (shape) {
                    if (tool === "room") {
                        change(() => {
                            if (shape.w < 4 || shape.h < 4) throw Error("拖出至少 4×4 格的房间。");
                            const rm = C.addRoom(reg(), {
                                ...shape,
                                layer: layerId
                            });
                            selection = {
                                list: "rooms",
                                id: rm.id
                            };
                        });
                    } else change(() => applyShape(shape));
                }
            } else if ([ "move", "world", "room-resize", "symmetry" ].includes(d.mode)) {
                const after = copy(w);
                w = d.before;
                change(() => w = after);
            }
            restoreBatchMove(d);
            draw();
        };
        canvas.addEventListener("pointerup", e => finish(e));
        canvas.addEventListener("pointercancel", e => finish(e, true));
        canvas.addEventListener("pointerleave", () => {
            cursorPoint = null;
            if (!drag) portPlacement = null;
            hoverRoomId = null;
            hoverRegionTitleId = null;
            hoverRegionId = null;
            drawOverlay();
        });
        canvas.addEventListener("dblclick", e => {
            if (lastPointerType === "touch" || batchCreationKind() || tool === "link") return;
            const wp = toWorld(eventPos(e));
            if (world) {
                const title = hitRegionLabel(wp);
                if (title && !cleanPreview) {
                    e.preventDefault?.();
                    regionTitleDialog(title);
                    return;
                }
                const id = [ ...scene().regions ].reverse().find(id => {
                    const rr = w.regions.find(r => r.id === id), p = scene().placements[id] || {
                        x: 0,
                        y: 0
                    };
                    return C.inside(wp, {
                        ...p,
                        w: rr.w,
                        h: rr.h
                    });
                });
                if (id) openRegion(id);
            } else if (!cleanPreview && tool === "polygon") finishPolygon(); else if (tool === "select" || cleanPreview) {
                const chosen = hit(wp);
                if (chosen?.list === "ports") {
                    const shelter = linkedShelter(reg(), reg().ports.find(p => p.id === chosen.id));
                    if (shelter) {
                        openLinkedShelter(shelter);
                        return;
                    }
                }
                if (chosen?.list === "markers") {
                    activateMarker(reg().markers.find(o => o.id === chosen.id), true);
                    return;
                }
                const rm = [ ...reg().rooms ].reverse().find(r => contentShown(reg(), r) && r.visible !== false && reg().layers.find(l => l.id === r.layer)?.visible !== false && C.inside(wp, r));
                if (rm) focusRoom(rm);
            }
        });
    }
    function finishPolygon() {
        if (polygon.length < 3) {
            toast("多边形至少需要三个顶点。");
            return;
        }
        requireEdit(() => {
            const pts = polygon;
            polygon = [];
            change(() => applyShape({
                id: C.uid(),
                type: "polygon",
                points: pts,
                material: activePaintLayer() && material !== "air" ? "solid" : material,
                decoration: activePaintLayer(),
                layer: layerId,
                depth: depth,
                width: brush,
                .../^slope/.test(material) ? {
                    slopeMode: "edge"
                } : {},
                roomId: room()?.id || null
            }));
        });
    }
    function keyboard(e) {
        if (active && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            if (document.querySelector("dialog[open]")) {
                toast("请先完成当前窗口的修改。");
                return;
            }
            manualSave();
            return;
        }
        if (!active || [ "INPUT", "TEXTAREA", "SELECT" ].includes(document.activeElement?.tagName) || document.querySelector("dialog[open]") || document.activeElement?.isContentEditable) return;
        if (!world && !cleanPreview) {
            const chord = C.shortcutChord(e), action = Object.entries(favorites().shortcuts).find(([, key]) => key === chord)?.[0];
            if (action) {
                e.preventDefault();
                if (!e.repeat) useFavorite(action);
                return;
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            e.shiftKey ? redo() : undo();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
            e.preventDefault();
            redo();
        } else if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "z") {
            e.preventDefault();
            cycleLayer();
        } else if (e.code === "Space") {
            e.preventDefault();
            spaceHeld = true;
        } else if (e.key === "Delete" && !world && !cleanPreview && selected()) {
            e.preventDefault();
            if (!e.repeat) requireEdit(() => {
                const wasRoom = selection?.list === "rooms";
                if (change(removeSelected) && wasRoom) toast("已删除房间及内容，可按 Ctrl+Z 撤回。");
            });
        } else if (e.key === "Escape") {
            connectStart = null;
            batchPlacement = null;
            pendingGateConnection = null;
            cancelDrag();
            if (batchCreateEnabled()) {
                tool = "select";
                pendingRoomType = null;
                pendingRoomPreset = null;
                pendingMarker = {};
            }
            selectionMessage = "";
            selectionMoveArmed = false;
            multiSelection = [];
            selectionBox = null;
            cutFrame = null;
            playerScale = false;
            if (canvas) canvas.style.cursor = "default";
            renderTools();
            closeDropdown();
            $("mapRecordCard")?.remove();
            roomId = null;
            polygon = [];
            preview = null;
            drag = null;
            selection = null;
            $("mapSide").classList.remove("panel-open");
            $("mapPanel").setAttribute("aria-expanded", "false");
            draw();
            renderSide();
        } else if (e.key === "Enter" && tool === "split") confirmCutFrame(); else if (e.key === "Enter" && tool === "polygon") finishPolygon(); else if (!e.ctrlKey && !e.metaKey && !e.altKey && !world && !cleanPreview) {
            const key = e.key.toLowerCase();
            if (key === "v") setTool("select"); else if (key === "m") setTool("marquee"); else if (key === "g") setTool("fill"); else if (key === "r") setTool("room-resize"); else if (key === "c") setTool("split"); else if (key === "b") setTool(lastDrawTool);
        }
    }
    function panelExtent(v) {
        return Math.max(20, Math.min(70, Number(v) || 30));
    }
    function wirePanelResize() {
        const h = $("mapSideResize"), side = $("mapSide");
        let d = null, percent = 30;
        const set = v => {
            percent = panelExtent(v);
            side.style.setProperty("--map-panel-extent", percent + "%");
            h.setAttribute("aria-valuenow", Math.round(percent));
            resize();
        };
        h.onpointerdown = e => {
            e.preventDefault();
            h.setPointerCapture(e.pointerId);
            const box = side.parentElement.getBoundingClientRect();
            d = {
                x: e.clientX,
                y: e.clientY,
                value: percent,
                w: box.width,
                h: box.height,
                horizontal: box.width > box.height && (window.OCUIPreferences?.viewport?.().layoutHeight || innerHeight) < 440
            };
        };
        h.onpointermove = e => {
            if (d) set(d.value + (d.horizontal ? (d.x - e.clientX) / d.w : (d.y - e.clientY) / d.h) * 100);
        };
        h.onpointerup = h.onpointercancel = () => d = null;
        h.onkeydown = e => {
            if ([ "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End" ].includes(e.key)) {
                e.preventDefault();
                set(e.key === "Home" ? 20 : e.key === "End" ? 70 : percent + ([ "ArrowUp", "ArrowLeft" ].includes(e.key) ? 5 : -5));
            }
        };
    }
    function wireUndo() {
        const h = $("mapUndoHandle"), bar = $("mapUndo");
        let d = null;
        h.onpointerdown = e => {
            h.setPointerCapture(e.pointerId);
            d = {
                x: e.clientX,
                y: e.clientY,
                left: bar.offsetLeft,
                top: bar.offsetTop,
                moved: false
            };
        };
        h.onpointermove = e => {
            if (!d || w?.settings.undoLocked) return;
            d.moved ||= Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5;
            if (!d.moved) return;
            bar.style.left = Math.max(0, Math.min($("mapStage").clientWidth - bar.offsetWidth, d.left + (e.clientX - d.x) / (window.OCUIPreferences?.pageScale || 1))) + "px";
            bar.style.top = Math.max(0, Math.min($("mapStage").clientHeight - bar.offsetHeight, d.top + (e.clientY - d.y) / (window.OCUIPreferences?.pageScale || 1))) + "px";
        };
        h.onpointerup = () => {
            if (!d) return;
            const moved = d.moved;
            d = null;
            if (moved) {
                clampMapFloats();
                change(() => w.settings.undoPosition = {
                    x: bar.offsetLeft,
                    y: bar.offsetTop
                });
            } else {
                const icon = lockButton(w.settings.undoLocked, () => false, "浮条位置");
                dropdown(h, [ [ w.settings.undoLocked ? "解锁浮条位置" : "锁定浮条位置", () => change(() => w.settings.undoLocked = !w.settings.undoLocked), icon ], [ "重置位置", () => {
                    bar.style.left = "14px";
                    bar.style.top = "14px";
                    change(() => delete w.settings.undoPosition);
                } ] ]);
            }
        };
        h.onpointercancel = () => d = null;
    }
    function download(data, name, type, options) {
        return OCStandalone.download(data, name, type, options);
    }
    function zip(files) {
        const enc = new TextEncoder, chunks = [], entries = [];
        let offset = 0;
        const crc = bytes => {
            let c = -1;
            for (const b of bytes) {
                c ^= b;
                for (let i = 0; i < 8; i++) c = c >>> 1 ^ (c & 1 ? 3988292384 : 0);
            }
            return (c ^ -1) >>> 0;
        };
        for (const [name, value] of Object.entries(files)) {
            const n = enc.encode(name), data = typeof value === "string" ? enc.encode(value) : value, header = new Uint8Array(30 + n.length), v = new DataView(header.buffer), sum = crc(data);
            v.setUint32(0, 67324752, true);
            v.setUint16(4, 20, true);
            v.setUint16(6, 2048, true);
            v.setUint32(14, sum, true);
            v.setUint32(18, data.length, true);
            v.setUint32(22, data.length, true);
            v.setUint16(26, n.length, true);
            header.set(n, 30);
            chunks.push(header, data);
            entries.push({
                n: n,
                data: data,
                sum: sum,
                offset: offset
            });
            offset += header.length + data.length;
        }
        const start = offset;
        for (const e of entries) {
            const h = new Uint8Array(46 + e.n.length), v = new DataView(h.buffer);
            v.setUint32(0, 33639248, true);
            v.setUint16(4, 20, true);
            v.setUint16(6, 20, true);
            v.setUint16(8, 2048, true);
            v.setUint32(16, e.sum, true);
            v.setUint32(20, e.data.length, true);
            v.setUint32(24, e.data.length, true);
            v.setUint16(28, e.n.length, true);
            v.setUint32(42, e.offset, true);
            h.set(e.n, 46);
            chunks.push(h);
            offset += h.length;
        }
        const end = new Uint8Array(22), v = new DataView(end.buffer);
        v.setUint32(0, 101010256, true);
        v.setUint16(8, entries.length, true);
        v.setUint16(10, entries.length, true);
        v.setUint32(12, offset - start, true);
        v.setUint32(16, start, true);
        chunks.push(end);
        return new Blob(chunks, {
            type: "application/zip"
        });
    }
    function exportPadding(c, z) {
        let pad = Math.max(50, Math.ceil(markerSize({
            kind: "echo"
        }, world) / 2) + 8);
        if (world) {
            pad = Math.max(pad, 48 * uiTextScale());
            for (const id of scene().regions) {
                const r = w.regions.find(r => r.id === id), metrics = regionLabelMetrics(c, r, z);
                pad = Math.max(pad, Math.ceil((metrics.width - r.w) * z) + 10, Math.ceil(-metrics.top * z) + 10);
            }
        }
        return Math.ceil(pad);
    }
    function importBackup() {
        const f = el("input");
        f.type = "file";
        f.accept = ".rainoc,.json";
        f.onchange = async () => {
            try {
                if (!f.files[0]) return;
                if (f.files[0].size > 100 * 1024 * 1024) throw Error("文件超过 100 MB，请拆分素材。");
                const v = JSON.parse(await f.files[0].text());
                let message = "已导入为独立项目。";
                if (v.format === "rw-oc-map-bundle") {
                    const m = C.validate(v.mapWorkspace);
                    rememberDraft();
                    importing = true;
                    try {
                        await bridge.importBundle(v.ocProject);
                        await loadProject();
                    } finally {
                        importing = false;
                    }
                    change(() => {
                        w = m;
                        sceneId = w.activeScene;
                        world = true;
                        regionId = null;
                    });
                } else if (v.format === "rw-oc-region") {
                    const m = C.validate(v);
                    message = "地图草稿已导入。";
                    change(() => {
                        w = m;
                        sceneId = w.activeScene;
                        regionId = null;
                        world = true;
                    });
                } else if (v.project) {
                    rememberDraft();
                    importing = true;
                    try {
                        await bridge.importBundle(v);
                        await loadProject();
                    } finally {
                        importing = false;
                    }
                } else throw Error("未识别的文件格式。");
                libraryDocs = bridge.getProject().documents || [];
                synchronizeRecords();
                const missing = w.regions.flatMap(r => r.markers).filter(m => [ "pearl", "broadcast", "echo" ].includes(m.kind) && m.docId && !libraryDocs.some(d => d.id === m.docId)).length;
                refresh();
                fit();
                toast(message + (missing ? " " + missing + " 个珍珠 / 广播缺少关联文字，请导入RainOC 项目或重新绑定。" : ""));
            } catch (e) {
                toast(e.message);
            }
        };
        f.click();
    }
    let manualSavePending = null;
    function manualSave() {
        if (manualSavePending) return manualSavePending;
        document.activeElement?.blur?.();
        const key = projectKey;
        if (!w || !key) {
            toast("尚未打开项目。");
            return Promise.resolve(false);
        }
        const control = $("mapSave");
        control.disabled = true;
        manualSavePending = (async () => {
            await flush();
            if (key !== projectKey) return false;
            if (!saved && !saveError) await flush();
            if (key !== projectKey) return false;
            const ok = saved && !saveError && OCStandalone.persistent;
            toast(ok ? "已保存" : saveError ? "保存失败：" + saveError : "未保存，请导出备份。");
            return !!ok;
        })().finally(() => {
            manualSavePending = null;
            control.disabled = false;
        });
        return manualSavePending;
    }
    function withExportContext(snapshot, mode, fn) {
        const previous = {
            w: w,
            world: world,
            sceneId: sceneId,
            regionId: regionId,
            roomId: roomId,
            layerId: layerId
        };
        try {
            w = snapshot;
            sceneId = w.activeScene;
            world = mode !== "current";
            regionId = world ? null : w.regions[0].id;
            roomId = null;
            layerId = world ? null : reg().layers.find(l => !C.isDedicatedLayer(l))?.id;
            return fn();
        } finally {
            ({w: w, world: world, sceneId: sceneId, regionId: regionId, roomId: roomId, layerId: layerId} = previous);
        }
    }
    async function preparePngAssets(snapshot) {
        await (document.fonts?.load("18px " + OCMapExport.fontFamily(snapshot.settings), "区域 INDUSTRIAL COMPLEX"));
        const sources = new Set, iteratorTasks = [];
        for (const r of snapshot.regions) {
            if (r.categories.shelter?.visible !== false) for (const rm of r.rooms) if (rm.roomType === "SHELTER" && C.roomVisible(r, rm) && r.layers.find(l => l.id === rm.layer)?.visible !== false) sources.add(C.shelterIconSource(r, rm));
            if (r.detailsVisible !== false && r.categories.ports.visible) for (const p of r.ports) if (C.roomVisible(r, p) && r.layers.find(l => l.id === p.layer)?.visible !== false) sources.add(portAsset(p.kind));
            for (const m of r.markers) {
                if (r.categories[m.kind]?.visible === false || !C.roomVisible(r, m) || r.layers.find(l => l.id === m.layer)?.visible === false) continue;
                if (m.kind === "iterator" && window.OCIteratorIcons?.prepareMap) {
                    iteratorTasks.push(window.OCIteratorIcons.prepareMap(m, libraryDocs));
                    continue;
                }
                if (m.kind === "shelter") {
                    sources.add(C.shelterIconSource(r, m));
                    continue;
                }
                if (m.icon) {
                    sources.add(m.icon);
                    continue;
                }
                if ([ "pearl", "broadcast", "token" ].includes(m.kind)) continue;
                let filename = {
                    shelter: C.shelterIcon(r, m),
                    gate: "gate",
                    echo: "echo-symbol",
                    toll: "toll",
                    shop: "shop",
                    iterator: "iterator",
                    creature: creatureIcons[m.creatureType] || "lizard"
                }[m.kind];
                if (m.kind === "gate") filename = C.gateIcon(snapshot, snapshot.activeScene, m);
                sources.add("rainworld-icons/" + filename + ".png");
            }
        }
        for (const n of snapshot.pngGateNotes || []) for (const k of [ n.from, n.to ]) sources.add(OCMapExport.karmaSource(k));
        await Promise.all([ ...iteratorTasks, ...[ ...sources ].map(async src => {
            const img = getImage(src);
            if (img.complete) {
                if (img.naturalWidth) return;
                throw Error("图片加载失败：" + src);
            }
            if (img.decode) await img.decode(); else await new Promise((resolve, reject) => {
                img.addEventListener("load", resolve, {
                    once: true
                });
                img.addEventListener("error", () => reject(Error("图片加载失败：" + src)), {
                    once: true
                });
            });
            if (!img.naturalWidth) throw Error("图片加载失败：" + src);
        }) ]);
        iconCache.clear();
    }
    function renderPng(snapshot, mode, outputOptions = {}) {
        exportingImage = true;
        try {
            return withExportContext(snapshot, mode, () => {
                const out = el("canvas"), box = world ? sceneBounds() : {
                    x: 0,
                    y: 0,
                    w: reg().w,
                    h: reg().h
                }, scale = Math.min(6, 3e3 / Math.max(box.w, box.h)), measure = out.getContext("2d");
                let pad = exportPadding(measure, scale);
                if (!world) pad = Math.max(pad, 48 * uiTextScale(), (regionLabelMetrics(measure, reg(), scale).width - reg().w) * scale + 10);
                const versionCaption = OCMapOutput.caption(outputOptions), versionFooter = versionCaption ? 36 : 0;
                const gateLayout = OCMapExport.layout(!world ? snapshot.pngGateNotes || [] : [], reg() || box, scale, measure, mapFontFamily());
                pad = Math.ceil(Math.max(pad, gateLayout.pad));
                out.width = Math.ceil(box.w * scale + pad * 2);
                out.height = Math.ceil(box.h * scale + pad * 2 + gateLayout.extraBottom + versionFooter);
                const c = out.getContext("2d");
                c.fillStyle = mapBackground();
                c.fillRect(0, 0, out.width, out.height);
                c.save();
                c.translate(pad - box.x * scale, pad - box.y * scale);
                c.scale(scale, scale);
                c.imageSmoothingEnabled = false;
                if (world) {
                    for (const id of scene().regions) {
                        const r = w.regions.find(r => r.id === id), p = scene().placements[id] || {
                            x: 0,
                            y: 0
                        };
                        c.save();
                        c.translate(p.x, p.y);
                        paintRegion(c, r, scale, {
                            simple: true,
                            clean: true,
                            symbols: false
                        });
                        c.restore();
                    }
                    paintWorldGateStorage(c, scale);
                    paintWorldGates(c, scale);
                    paintWorldSymbols(c, scale);
                    paintWorldLabels(c, scale);
                } else {
                    paintRegion(c, reg(), scale, {
                        decorations: false,
                        clean: true
                    });
                    paintRegionLabel(c, reg(), scale);
                }
                c.restore();
                if (!world && gateLayout.rows.length) {
                    c.save();
                    c.translate(pad, pad);
                    OCMapExport.paint(c, gateLayout, getImage);
                    c.restore();
                }
                if (versionCaption) {
                    c.save();
                    c.fillStyle = "#b8b8b8";
                    c.font = "14px " + mapFontFamily();
                    c.textAlign = "right";
                    c.fillText(versionCaption, out.width - 18, out.height - 13, Math.max(1, out.width - 36));
                    c.restore();
                }
                if (w.settings.invert) {
                    const ic = c.getImageData(0, 0, out.width, out.height);
                    for (let i = 0; i < ic.data.length; i += 4) {
                        ic.data[i] = 255 - ic.data[i];
                        ic.data[i + 1] = 255 - ic.data[i + 1];
                        ic.data[i + 2] = 255 - ic.data[i + 2];
                    }
                    c.putImageData(ic, 0, 0);
                }
                return {
                    canvas: out,
                    name: OCMapOutput.fileName({
                        ...outputOptions,
                        name: outputOptions.name || OCMapOutput.defaultName(scene(), w.regions, mode),
                        format: "png"
                    })
                };
            });
        } finally {
            exportingImage = false;
            presentationCache.clear();
        }
    }
    async function pngExport(mode = (world ? "world" : "current"), ids, outputOptions = {}) {
        const selected = mode === "current" ? [ regionId ] : mode === "selected" ? ids : scene().regions, snapshot = OCMapExport.prepare(w, sceneId, selected, mode, libraryDocs, pngOptions);
        await Promise.all([ preparePngAssets(snapshot), document.fonts?.ready ]);
        const {canvas: canvas, name: name} = renderPng(snapshot, mode, outputOptions), blob = await new Promise((resolve, reject) => canvas.toBlob(v => v ? resolve(v) : reject(Error("图片生成失败，请缩小导出范围。")), "image/png"));
        download(blob, name, "image/png");
        return {
            canvas: canvas,
            name: name
        };
    }
    const pngOptions = {
        gates: true,
        pearls: true,
        tokens: true
    };
    function exportDialog() {
        dialog("导出", (b, a, close, err) => {
            const O = window.OCMapOutput, chosen = new Set(scene().regions), prefs = w.settings.exportNaming || {}, [ff, format] = select("格式", "project", {
                project: "RainOC 项目 · 全部内容",
                map: "地图草稿 · JSON",
                png: "地图图片 · PNG",
                rained: "Rained 房间 · ZIP"
            }), options = el("div", "map-export-options");
            let range = !world && reg() && !reg().gateStorageOnly ? "current" : "world", manualName = false, rainedScope = "all", rainedCache = null, rainedPending = null, rainedGeneration = 0;
            const selectedRooms = new Set;
            const [nf, ni] = input("导出文件名", ""), versions = el("details", "map-section map-fold"), summary = el("summary", "", "版本与图片标注"), [mf, mi] = input("地图版本（自定义）", scene().contentVersion || ""), [pf, pi] = input("项目版本（自定义）", w.settings.projectVersion || ""), filePreview = el("p", "map-muted");
            mi.maxLength = pi.maxLength = 40;
            ni.maxLength = 140;
            versions.append(summary, mf, pf);
            let includeVersion = prefs.includeVersion !== false, showMapVersion = prefs.showMapVersion === true, showProjectVersion = prefs.showProjectVersion === true;
            const imageVersionControls = el("div");
            imageVersionControls.append(check("PNG 显示地图版本", showMapVersion, v => showMapVersion = v), check("PNG 显示项目版本", showProjectVersion, v => showProjectVersion = v));
            versions.append(check("文件名包含版本号", includeVersion, v => {
                includeVersion = v;
                updateFileName();
            }), imageVersionControls, note("未填写自定义版本时，文件名使用 RainocTool 1.1.2。图片中的版本号仅在勾选且填写后显示。"));
            const ids = () => format.value === "png" ? range === "current" ? [ regionId ] : range === "selected" ? [ ...chosen ] : scene().regions : [ ...chosen ];
            const outputOptions = () => ({
                name: ni.value,
                format: format.value,
                includeVersion: includeVersion,
                mapVersion: mi.value.trim(),
                projectVersion: pi.value.trim(),
                showMapVersion: showMapVersion,
                showProjectVersion: showProjectVersion
            });
            function updateFileName() {
                if (!manualName) {
                    const selected = w.regions.filter(r => ids().includes(r.id));
                    ni.value = format.value === "project" ? bridge.getProject().name : O.defaultName(scene(), selected, format.value === "png" ? range : "selected");
                }
                filePreview.textContent = O.fileName(outputOptions());
                imageVersionControls.hidden = format.value !== "png";
            }
            ni.oninput = () => {
                manualName = true;
                updateFileName();
            };
            mi.oninput = pi.oninput = updateFileName;
            b.append(ff, nf, filePreview, versions, options);
            const regions = () => {
                const list = el("div", "map-export-regions");
                list.append(row(button("全选", () => {
                    scene().regions.forEach(id => chosen.add(id));
                    render();
                }), button("全不选", () => {
                    chosen.clear();
                    render();
                })));
                for (const id of scene().regions) {
                    const r = w.regions.find(r => r.id === id);
                    list.append(check(r.name + " / " + r.english, chosen.has(id), v => {
                        v ? chosen.add(id) : chosen.delete(id);
                        rainedCache = null;
                        rainedGeneration++;
                        render();
                    }));
                }
                options.append(list);
            };
            async function prepareRained() {
                const key = JSON.stringify([ ...chosen ].sort());
                if (rainedCache?.key === key) return rainedCache;
                if (rainedPending?.key === key) return rainedPending.promise;
                const generation = ++rainedGeneration, promise = (async () => {
                    await new Promise(resolve => setTimeout(resolve, 0));
                    const data = C.exportWorkspace(w, sceneId, [ ...chosen ]), result = C.rainedExportFiles(data, {
                        baseline: w.exportSettings?.rainedBaseline
                    });
                    if (generation !== rainedGeneration) return null;
                    rainedCache = {
                        key: key,
                        data: data,
                        result: result
                    };
                    selectedRooms.clear();
                    result.roomCandidates.forEach(room => selectedRooms.add(room.key));
                    return rainedCache;
                })();
                rainedPending = {
                    key: key,
                    promise: promise
                };
                try {
                    return await promise;
                } finally {
                    if (rainedPending?.promise === promise) rainedPending = null;
                }
            }
            function roomSelection(result) {
                return C.selectRainedExportRooms(result, {
                    baseline: w.exportSettings?.rainedBaseline,
                    ...rainedScope === "changed" ? {
                        changedOnly: true
                    } : rainedScope === "selected" ? {
                        roomKeys: [ ...selectedRooms ]
                    } : {}
                });
            }
            function renderRained() {
                options.append(note("建议启用 SBCameraScroll。"));
                const [sf, si] = select("房间工程", rainedScope, {
                    all: "全部房间",
                    changed: "上次导出后新增或修改",
                    selected: "手动勾选房间"
                }), list = el("div", "map-export-rooms");
                options.append(sf, list);
                si.onchange = () => {
                    rainedScope = si.value;
                    render();
                };
                list.append(note("正在整理房间工程…"));
                prepareRained().then(cache => {
                    if (!cache || format.value !== "rained") return;
                    list.replaceChildren();
                    const result = roomSelection(cache.result);
                    list.append(note(result.count + " / " + result.totalCount + " 个房间工程；区域与连接交接表始终完整。"));
                    if (rainedScope === "selected") {
                        list.append(row(button("全选房间", () => {
                            cache.result.roomCandidates.forEach(room => selectedRooms.add(room.key));
                            render();
                        }), button("全不选房间", () => {
                            selectedRooms.clear();
                            render();
                        })));
                        for (const room of result.roomCandidates) list.append(check(room.name + " · " + {
                            new: "新增",
                            changed: "已修改",
                            unchanged: "未修改"
                        }[room.status], selectedRooms.has(room.key), v => {
                            v ? selectedRooms.add(room.key) : selectedRooms.delete(room.key);
                            render();
                        }));
                    } else if (rainedScope === "changed" && !result.count) list.append(note("没有需要重新导出的房间，仍可导出交接表。"));
                }).catch(e => {
                    list.replaceChildren(warningNote(e.message || String(e)));
                });
            }
            const render = () => {
                options.replaceChildren();
                updateFileName();
                if (format.value === "project") {
                    options.append(note("包含图片、文字、所有地图和绑定关系。"));
                    return;
                }
                if (format.value === "png") {
                    const [f, i] = select("范围", range, {
                        ...!world && reg() && !reg().gateStorageOnly ? {
                            current: "当前区域"
                        } : {},
                        world: "整个地图",
                        selected: "勾选区域"
                    });
                    i.onchange = () => {
                        range = i.value;
                        render();
                    };
                    options.append(f);
                    if (range === "selected") regions();
                    const marks = fold("标注", options, "png-marks", false);
                    marks.append(check("业力门与目标区域", pngOptions.gates, v => pngOptions.gates = v), check("有色珍珠", pngOptions.pearls, v => pngOptions.pearls = v), check("竞技场代币", pngOptions.tokens, v => pngOptions.tokens = v));
                    options.append(note("完整庇护所、业力门及透明度沿用“显示”中的设置。"));
                    return;
                }
                regions();
                if (format.value === "rained") renderRained();
            };
            const remember = () => {
                const next = {
                    includeVersion: includeVersion,
                    showMapVersion: showMapVersion,
                    showProjectVersion: showProjectVersion
                };
                if (scene().contentVersion !== mi.value.trim() || w.settings.projectVersion !== pi.value.trim() || JSON.stringify(w.settings.exportNaming) !== JSON.stringify(next)) change(() => {
                    scene().contentVersion = mi.value.trim();
                    w.settings.projectVersion = pi.value.trim();
                    w.settings.exportNaming = next;
                });
            };
            format.onchange = render;
            const save = button("导出", async () => {
                save.disabled = true;
                try {
                    document.activeElement?.blur?.();
                    if (!ni.value.trim()) throw Error("请填写导出文件名。");
                    if (format.value === "png" && !ids().length && scene().regions.length) throw Error("请至少选择一个区域。");
                    remember();
                    const output = outputOptions(), filename = O.fileName(output);
                    if (format.value === "project") {
                        const base = await bridge.exportBundle();
                        download({
                            format: "rw-oc-map-bundle",
                            version: 1,
                            ocProject: base,
                            mapWorkspace: copy(w),
                            created: (new Date).toISOString()
                        }, filename);
                    } else if (format.value === "png") await pngExport(range, [ ...chosen ], output); else {
                        const cached = format.value === "rained" ? await prepareRained() : null, data = cached?.data || C.exportWorkspace(w, sceneId, [ ...chosen ]);
                        if (format.value === "map") download(data, filename); else {
                            if (!cached) throw Error("房间列表已变化，请重新导出。");
                            const result = roomSelection(cached.result), exportProjectKey = projectKey, deliver = () => {
                                download(zip(result.files), filename, "application/zip", {
                                    onRequested: () => {
                                        if (projectKey !== exportProjectKey) return;
                                        change(() => {
                                            w.exportSettings ||= {};
                                            w.exportSettings.rainedBaseline = copy(result.nextBaseline);
                                        });
                                        rainedCache = null;
                                        render();
                                    }
                                });
                            };
                            const isShown = p => {
                                if (p.code?.startsWith("SHORTCUT_")) return true;
                                const roomIds = p.rooms || [ p.room ];
                                return data.regions.some(r => r.rooms.some(rm => (roomIds.includes(rm.id) || p.room === rm.name) && warningEnabled(w.regions.find(o => o.id === r.id) || r, w.regions.find(o => o.id === r.id)?.rooms.find(o => o.id === rm.id) || rm, "export")));
                            }, problems = () => result.roomWarnings.filter(isShown), repairs = () => result.repairs.filter(isShown);
                            if (problems().length || repairs().length) {
                                dialog("房间与通道检查", (body, actions, dismiss) => {
                                    const show = () => {
                                        body.replaceChildren();
                                        for (const p of problems()) body.append(warningNote(p.message));
                                        for (const item of repairs()) body.append(warningNote(item.room + "：" + item.repairs.map(p => p.message).join(" ")));
                                        body.append(note("有效连线会生成实际捷径。未连接或无法生成的部分保留问题说明，不会自动猜测配对。庇护所门机构与外墙在导出副本中保持安全结构。"));
                                        const roomIds = new Set(problems().filter(p => !p.code?.startsWith("SHORTCUT_")).flatMap(p => p.rooms || [ p.room ]));
                                        for (const r of w.regions) for (const rm of r.rooms) if (roomIds.has(rm.id)) body.append(row(el("span", "", rm.name), button("本次关闭", () => {
                                            muteRoomWarning(r, rm, false);
                                            show();
                                        }), button("永久关闭", () => {
                                            muteRoomWarning(r, rm, true);
                                            show();
                                        })));
                                    };
                                    show();
                                    actions.append(button("返回编辑", dismiss), button("导出并保留问题说明", () => {
                                        deliver();
                                        dismiss();
                                    }, "primary"));
                                });
                            } else deliver();
                        }
                    }
                } catch (e) {
                    err(e);
                } finally {
                    save.disabled = false;
                }
            }, "primary");
            a.append(button("关闭", close), save);
            render();
        });
    }
    function gateDisplayName(g) {
        if (g.sharedRoom) {
            const a = w.regions.find(r => r.id === g.a.region), b = w.regions.find(r => r.id === g.b.region);
            return (g.name || sharedGateRoom(g)?.room.name || "业力门") + " · " + (a?.name || "未绑定") + " ↔ " + (b?.name || "未绑定");
        }
        const endpoint = side => {
            const r = w.regions.find(r => r.id === side.region), m = r?.markers.find(m => m.id === side.marker), rm = r?.rooms.find(rm => rm.id === m?.roomId);
            return rm?.name || m?.name || r?.code || "?";
        };
        return endpoint(g.a) + " - " + endpoint(g.b);
    }
    function focusRegionOnWorld(r) {
        world = true;
        regionId = null;
        roomId = null;
        selection = {
            list: "world",
            id: r.id
        };
        const p = scene().placements[r.id] || {
            x: 0,
            y: 0
        }, v = viewSize();
        cam.z = Math.min(v.w / (r.w + 60), v.h / (r.h + 60));
        cam.x = v.w / 2 - (p.x + r.w / 2) * cam.z;
        cam.y = v.h / 2 - (p.y + r.h / 2) * cam.z;
        refresh();
    }
    function focusGate(g) {
        if (!g.a.region || !g.b.region) {
            gateDialog(g);
            return;
        }
        selectedGateId = g.id;
        world = true;
        regionId = null;
        roomId = null;
        selection = null;
        const points = [ g.a, g.b ].map(side => {
            const r = w.regions.find(r => r.id === side.region), p = scene().placements[side.region] || {
                x: 0,
                y: 0
            }, m = r?.markers.find(m => m.id === side.marker);
            if (r) {
                r.categories.gate.visible = true;
                const l = r.layers.find(l => l.id === m?.layer);
                if (l) l.visible = true;
                const rm = r.rooms.find(rm => rm.id === m?.roomId);
                if (rm) rm.visible = true;
            }
            return {
                x: p.x + (m?.x ?? r.w / 2),
                y: p.y + (m?.y ?? r.h / 2)
            };
        });
        const v = viewSize(), a = points[0], b = points[1];
        cam.z = Math.min(5, v.w / (Math.abs(a.x - b.x) + 60), v.h / (Math.abs(a.y - b.y) + 60));
        cam.x = v.w / 2 - (a.x + b.x) / 2 * cam.z;
        cam.y = v.h / 2 - (a.y + b.y) / 2 * cam.z;
        refresh();
    }
    function mergeLayerDialog(source) {
        dialog("合并图层", (b, a, close, err) => {
            const targets = reg().layers.filter(l => l.id !== source.id && !C.isDedicatedLayer(l)), [f, i] = select("合并到", targets[0]?.id || "", Object.fromEntries(targets.map(l => [ l.id, l.name ])));
            b.append(f);
            a.append(button("合并", () => {
                let issue;
                const ok = change(() => {
                    try {
                        C.mergeLayers(reg(), source.id, i.value);
                        layerId = i.value;
                    } catch (e) {
                        issue = e;
                        throw e;
                    }
                });
                if (ok) close(); else err(issue || "没有可合并的图层");
            }, "primary"));
        });
    }
    function refreshWorkflowFloats() {
        const dock = $("mapDock");
        dock.classList.toggle("dock-folded", dockCollapsed);
        $("mapDockFold").textContent = dockCollapsed ? "◂" : "▸";
        $("mapDockFold").setAttribute("aria-expanded", String(!dockCollapsed));
        const f = $("mapPreviewFloat");
        if (f) {
            f.hidden = !cleanPreview;
            f.classList.toggle("is-folded", previewCollapsed);
            const toggle = f.querySelector(".map-preview-toggle");
            if (toggle) toggle.textContent = previewCollapsed ? "▸" : "◂";
        }
    }
    function renderFillOptions(n) {
        const s = section("填充设置");
        s.append(select("取样", fillOptions.sampleAll ? "all" : "current", {
            current: "当前空间层",
            all: "所有可见空间层"
        }, v => fillOptions.sampleAll = v === "all")[0], fieldNumber("扩展 / 格", fillOptions.expansion, v => fillOptions.expansion = v, -4, 4), fieldNumber("边缘容差 / %", fillOptions.tolerance, v => fillOptions.tolerance = v, 0, 100), check("平滑边缘取样", fillOptions.antialias, v => fillOptions.antialias = v));
        n.append(s);
    }
    function setMarqueeTarget(target) {
        setTool(target === "rooms" ? "room-select" : "marquee");
    }
    function updateRoomSelectionActions() {
        const actions = $("mapRoomSelectionActions");
        if (!actions) return;
        const single = tool !== "marquee" && selection?.list === "rooms" ? selected() : null;
        actions.hidden = world || cleanPreview || !single && (tool !== "marquee" || !multiSelection.length && !selectionMessage);
        if (actions.hidden) return;
        const rooms = !!single || marqueeTarget === "rooms", ids = single ? [ single.id ] : multiSelection.filter(ref => ref.list === "rooms").map(ref => ref.id);
        let reason = single ? "" : selectionMessage;
        const merge = $("mapMergeRooms"), content = $("mapContentSelectionActions");
        let transforms = document.getElementById("mapRoomTransforms");
        if (!transforms || !transforms.dataset.attached) {
            transforms = el("div");
            transforms.id = "mapRoomTransforms";
            transforms.dataset.attached = "true";
            actions.append(transforms);
        }
        transforms.hidden = !rooms || !ids.length;
        const transformKey = ids.join(":");
        if (!transforms.hidden && transforms.dataset.selection !== transformKey) {
            transforms.dataset.selection = transformKey;
            transforms.replaceChildren(roomTransformControls(ids));
        }
        merge.hidden = !rooms || !!single;
        content.hidden = rooms || !multiSelection.length;
        if (rooms && !single) {
            try {
                C.roomMergePlan(reg(), ids);
            } catch (e) {
                reason = e.message;
            }
            merge.textContent = "合并房间";
            merge.disabled = !!reason;
            merge.title = reason || "合并所有选中的房间";
            merge.setAttribute("aria-label", "合并房间");
            merge.setAttribute("aria-describedby", "mapMergeReason");
            merge.onclick = mergeRoomSelection;
        } else if (!rooms && multiSelection.length) {
            if (!content.dataset.wired) {
                content.dataset.wired = "true";
                const move = button("移动", () => {
                    selectionMoveArmed = !selectionMoveArmed;
                    canvas.style.cursor = selectionMoveArmed ? "move" : "default";
                    updateRoomSelectionActions();
                });
                move.id = "mapMoveContent";
                move.title = "点击后拖动画布移动选区，也可直接拖动选区";
                content.append(move, button("左右翻转", () => transformContentSelection({
                    flipX: true
                })), button("上下翻转", () => transformContentSelection({
                    flipY: true
                })), button("复制到图层", copyContentSelection));
                for (const [label, dx, dy] of [ [ "←", -1, 0 ], [ "↑", 0, -1 ], [ "↓", 0, 1 ], [ "→", 1, 0 ] ]) {
                    const nudge = button(label, () => transformContentSelection({
                        dx: dx,
                        dy: dy
                    }));
                    nudge.setAttribute("aria-label", {
                        "←": "左",
                        "↑": "上",
                        "↓": "下",
                        "→": "右"
                    }[label] + "移一格");
                    content.append(nudge);
                }
            }
            $("mapMoveContent").setAttribute("aria-pressed", String(selectionMoveArmed));
            if (selectionMoveArmed) reason = "拖动画布移动选区";
        }
        const note = $("mapMergeReason");
        note.textContent = reason;
        note.hidden = !reason;
        requestAnimationFrame(clampMapFloats);
    }
    function contentSelectionOptions() {
        const r = reg();
        return {
            layers: contentSelectionScope === "current" ? [ layerId ] : r.layers.filter(l => l.visible !== false).map(l => l.id),
            filter: (o, list) => visible(r, o, list === "shapes" ? cat(o) : list === "markers" ? o.kind : list) && (list !== "shapes" || C.paintLayerVisible(r, o) && (!o.decoration || C.backgroundsShown(w.settings, cam.z)))
        };
    }
    function finishContentSelection(start, end) {
        const r = reg(), options = contentSelectionOptions(), scope = w.settings.crossRoomEdit === false ? room() || [ ...r.rooms ].reverse().find(rm => options.layers.includes(rm.layer) && contentShown(r, rm) && C.roomVisible(r, rm) && C.inside(start, rm)) : null;
        let box = C.rect(start, end);
        if (scope) box = C.intersection(box, scope);
        selectionBox = box || C.rect(start, end);
        const candidates = C.selectContents(r, layerId, box, scope?.id || null, {
            ...options,
            includeLocked: true
        }), reasons = candidates.map(ref => {
            const o = r[ref.list].find(o => o.id === ref.id);
            return C.lockReason(r, o, ref.list === "shapes" ? cat(o) : ref.list === "markers" ? o.kind : ref.list);
        });
        if (!candidates.length) {
            multiSelection = [];
            selectionMessage = contentSelectionScope === "current" ? "当前图层的选框内没有可选内容；可切换到“可见图层”。" : "选框内没有可选的可见内容。请检查图层、显示范围或房间限制。";
            return;
        }
        if (reasons.every(Boolean)) {
            multiSelection = [];
            selectionMessage = [ ...new Set(reasons) ].join("；") + "。请解锁后再选择。";
            return;
        }
        requireEdit(() => {
            let failure = "";
            change(() => {
                try {
                    multiSelection = C.isolateSelection(reg(), layerId, box, scope?.id || null, options);
                } catch (e) {
                    failure = e.message;
                    throw e;
                }
            });
            selectionMessage = multiSelection.length ? "" : failure || "选框内没有可编辑内容。";
            if (multiSelection.length) selectionBox = null;
            renderTools();
            renderSide();
            drawOverlay();
        }, {
            regionScope: true
        });
    }
    function transformContentSelection(options) {
        requireEdit(() => {
            selectionMoveArmed = false;
            change(() => C.transformSelection(reg(), multiSelection, {
                ...options,
                crossRooms: w.settings.crossRoomEdit !== false
            }));
            renderTools();
            renderSide();
            draw();
        }, {
            regionScope: true
        });
    }
    function renderMarqueeControls() {
        const n = el("div", "map-marquee-actions");
        if (marqueeTarget === "contents") {
            const scope = button((contentSelectionScope === "visible" ? "可见图层" : "当前图层") + " ▾", () => dropdown(scope, [ [ "可见图层", () => {
                contentSelectionScope = "visible";
                selectionMessage = "";
                renderTools();
                drawOverlay();
            } ], [ "仅当前图层", () => {
                contentSelectionScope = "current";
                selectionMessage = "";
                renderTools();
                drawOverlay();
            } ] ]));
            scope.id = "mapSelectionScope";
            scope.title = "内容选区的图层范围";
            n.append(scope);
        }
        if (multiSelection.length || selectionMessage) {
            const cancel = button("×", () => {
                selectionMessage = "";
                selectionMoveArmed = false;
                multiSelection = [];
                selectionBox = null;
                renderTools();
                renderSide();
                drawOverlay();
            });
            cancel.setAttribute("aria-label", "取消选区");
            n.append(cancel);
        }
        return n;
    }
    function mergeRoomSelection() {
        requireEdit(() => {
            const count = multiSelection.length;
            if (change(() => {
                const rm = C.mergeSelectedRooms(reg(), multiSelection.map(ref => ref.id));
                multiSelection = [ {
                    list: "rooms",
                    id: rm.id
                } ];
                selection = null;
                selectionBox = null;
                roomId = null;
            })) toast("已将 " + count + " 个房间合并，可按 Ctrl+Z 撤回。");
        }, {
            regionScope: true
        });
    }
    function startMarquee(p, e) {
        selectionMessage = "";
        if (multiSelection.length && !e.shiftKey) {
            const box = C.selectionBounds(reg(), multiSelection);
            if (box && (C.inside(p, box) || marqueeTarget === "contents" && selectionMoveArmed)) {
                requireEdit(() => {
                    if (downPointer === e.pointerId) drag = {
                        mode: "selection-move",
                        p: p,
                        before: copy(w),
                        refs: copy(multiSelection)
                    };
                }, {
                    regionScope: true
                });
                return;
            }
        }
        const refs = copy(multiSelection);
        selection = null;
        multiSelection = [];
        selectionBox = {
            x: p.x,
            y: p.y,
            w: 0,
            h: 0
        };
        drag = {
            mode: "marquee",
            p: p,
            additive: marqueeTarget === "rooms" && e.shiftKey,
            refs: refs
        };
        drawOverlay();
    }
    function renderSelectionActions(n) {
        const s = section(marqueeTarget === "rooms" ? "框选房间" : "选区");
        if (marqueeTarget === "rooms") {
            s.append(el("div", "map-muted", multiSelection.length ? "已选 " + multiSelection.length + " 个房间，拖动选区可一起移动；点击右下角“合并房间”可合并这些房间。" : "在地图上框选房间。Shift 可追加或取消选择。"));
            if (multiSelection.length) {
                try {
                    C.roomMergePlan(reg(), multiSelection.map(ref => ref.id));
                } catch (e) {
                    if (multiSelection.length > 1) s.append(el("div", "map-muted", e.message));
                }
                s.append(roomTransformControls(multiSelection.map(ref => ref.id)), row(...[ [ "←", -1, 0 ], [ "↑", 0, -1 ], [ "↓", 0, 1 ], [ "→", 1, 0 ] ].map(([label, dx, dy]) => button(label, () => requireEdit(() => change(() => C.moveRooms(reg(), multiSelection.map(ref => ref.id), dx, dy)), {
                    regionScope: true
                })))));
            }
            n.append(s);
            return;
        }
        s.append(el("span", "map-muted", multiSelection.length ? "拖动选区可移动；右下角可移动、翻转或复制到图层。" : selectionMessage || "拖动框选内容。"));
        n.append(s);
    }
    function copyContentSelection() {
        dialog("复制选区", (b, a, close, err) => {
            const [f, i] = select("目标层", "new", {
                new: "新建层",
                ...Object.fromEntries(reg().layers.filter(l => !C.isDedicatedLayer(l)).map(l => [ l.id, l.name ]))
            }), [nf, ni] = input("新层名称", C.nextLayerName(reg(), "选区副本"));
            i.onchange = () => nf.hidden = i.value !== "new";
            b.append(f, nf);
            a.append(button("复制", () => {
                let issue;
                const ok = change(() => {
                    try {
                        const target = i.value === "new" ? C.addLayer(reg(), ni.value.trim() || "选区副本").id : i.value;
                        multiSelection = C.copySelection(reg(), multiSelection, target);
                        layerId = target;
                    } catch (e) {
                        issue = e;
                        throw e;
                    }
                });
                if (ok) {
                    selectionBox = null;
                    selectionMessage = "";
                    renderTools();
                    renderSide();
                    drawOverlay();
                    close();
                } else err(issue || "未复制");
            }, "primary"));
        });
    }
    function drawActiveSelection(line, point) {
        const r = reg(), color = w.settings.selectionColor || "#ffff00";
        let boxes = [];
        const o = selected();
        if (o && selection.list === "links") {
            const a = r.ports.find(p => p.id === o.a), b = r.ports.find(p => p.id === o.b);
            if (a && b) {
                const p = point(C.portPose(r, a)), q = point(C.portPose(r, b)), mid = (p.x + q.x) / 2;
                line("path", {
                    d: "M" + p.x + " " + p.y + " C" + mid + " " + p.y + " " + mid + " " + q.y + " " + q.x + " " + q.y,
                    stroke: color,
                    "stroke-width": 3
                }, "map-connection-glow");
            }
        }
        if (o && selection.list !== "links" && C.roomVisible(r, o)) {
            const pose = selection.list === "ports" ? C.portPose(r, o) : o, size = selection.list === "markers" ? markerSize(o) : portSize();
            boxes.push([ "markers", "ports" ].includes(selection.list) ? {
                x: pose.x - size / 2 / cam.z,
                y: pose.y - size / 2 / cam.z,
                w: size / cam.z,
                h: size / cam.z
            } : C.bounds(o));
        }
        if (multiSelection.length) {
            if (multiSelection[0].list === "rooms") boxes.push(...multiSelection.map(ref => r.rooms.find(rm => rm.id === ref.id)).filter(Boolean));
            if (multiSelection[0].list !== "rooms" || multiSelection.length > 1) boxes.push(C.selectionBounds(r, multiSelection));
        } else if (selectionBox && tool === "marquee") boxes.push(selectionBox);
        for (const b of boxes.filter(Boolean)) {
            const p = point(b);
            line("rect", {
                x: p.x - 2,
                y: p.y - 2,
                width: b.w * cam.z + 4,
                height: b.h * cam.z + 4,
                stroke: color,
                "stroke-width": 2
            }, "map-selection-glow");
        }
        if (o && selection.list === "ports" && tool !== "port" && C.roomVisible(r, o) && visible(r, o, "ports")) drawPortFacing(line, point, C.portPose(r, o), (shelterEntranceShown(r, o) ? markerSize({
            kind: "shelter"
        }) : portSize()) / 2);
    }
    function drawRegionHover(svg) {
        if (!hoverRegionId || drag) return;
        const r = w.regions.find(r => r.id === hoverRegionId), p = scene().placements[hoverRegionId];
        if (!r || !p) return;
        const e = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        for (const [key, value] of Object.entries({
            x: p.x * cam.z + cam.x,
            y: p.y * cam.z + cam.y,
            width: r.w * cam.z,
            height: r.h * cam.z,
            class: "map-region-hover"
        })) e.setAttribute(key, value);
        svg.append(e);
    }
    function drawWorldSelection(svg) {
        const add = (tag, attrs, cls) => {
            const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
            for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
            e.setAttribute("class", cls);
            svg.append(e);
        };
        if (selection?.list === "world") {
            const r = w.regions.find(r => r.id === selection.id), p = scene().placements[r?.id];
            if (r && p) add("rect", {
                x: p.x * cam.z + cam.x,
                y: p.y * cam.z + cam.y,
                width: r.w * cam.z,
                height: r.h * cam.z,
                stroke: w.settings.selectionColor || "#ffff00",
                "stroke-width": 2
            }, "map-selection-glow");
        }
        const g = w.gates.find(g => g.id === selectedGateId && g.visible !== false && g.scenes.includes(sceneId));
        if (g) {
            const p = [ g.a, g.b ].map(side => {
                const r = w.regions.find(r => r.id === side.region), m = r?.markers.find(m => m.id === side.marker), pos = scene().placements[r?.id] || {
                    x: 0,
                    y: 0
                };
                return m ? {
                    x: (pos.x + m.x) * cam.z + cam.x,
                    y: (pos.y + m.y) * cam.z + cam.y
                } : null;
            });
            if (p.every(Boolean)) add("path", {
                d: "M" + p[0].x + " " + p[0].y + "L" + p[1].x + " " + p[1].y,
                stroke: w.settings.connectionHighlight || "#ffff00",
                "stroke-width": 4
            }, "map-connection-glow");
        }
    }
    function wireWorkflowFloats() {
        $("mapDockFold").onclick = () => {
            dockCollapsed = !dockCollapsed;
            refreshWorkflowFloats();
        };
        const bar = el("div", "map-preview-float");
        bar.id = "mapPreviewFloat";
        bar.hidden = true;
        const handle = button("⠿", () => {}), exit = button("预览模式", () => $("mapPreview").click()), toggle = button("◂", () => {
            previewCollapsed = !previewCollapsed;
            refreshWorkflowFloats();
        }, "map-preview-toggle");
        exit.title = "点击退出预览";
        handle.title = "拖动预览栏";
        bar.append(handle, exit, toggle);
        $("mapStage").append(bar);
        let d = null;
        handle.onpointerdown = e => {
            handle.setPointerCapture(e.pointerId);
            d = {
                x: e.clientX,
                y: e.clientY,
                left: bar.offsetLeft,
                top: bar.offsetTop
            };
        };
        handle.onpointermove = e => {
            if (!d) return;
            bar.style.left = Math.max(0, Math.min($("mapStage").clientWidth - bar.offsetWidth, d.left + (e.clientX - d.x) / (window.OCUIPreferences?.pageScale || 1))) + "px";
            bar.style.top = Math.max(0, Math.min($("mapStage").clientHeight - bar.offsetHeight, d.top + (e.clientY - d.y) / (window.OCUIPreferences?.pageScale || 1))) + "px";
        };
        handle.onpointerup = handle.onpointercancel = () => d = null;
    }
    function textArea(label, value) {
        const f = el("label", "", label), i = el("textarea");
        i.rows = 4;
        i.value = value || "";
        f.append(i);
        return [ f, i ];
    }
    function regionTitleDialog(r) {
        const id = r?.id;
        let current = w.regions.find(o => o.id === id);
        if (!current) return;
        if (regionTitleModal?.id === id && regionTitleModal.dialog.open) {
            regionTitleModal.dialog.focus();
            return;
        }
        synchronizeRecords();
        current = w.regions.find(o => o.id === id);
        let ni, ei, si, ci, ti, no, draftName = current.name, draftEnglish = current.english, recordId = current.textDocId || "";
        const getProfile = () => {
            const d = libraryDocs.find(d => d.id === recordId && !d.archived), existing = d?.details?.regionProfiles?.find(p => p.sceneId === sceneId);
            return copy(existing || (!d ? current.textDetails?.[sceneId] : null) || {
                id: C.uid(),
                sceneId: sceneId,
                title: scene().name,
                synopsis: d?.details?.synopsis || "",
                content: d?.content || "",
                tags: d?.details?.tags || [],
                notes: ""
            });
        };
        let profile = getProfile();
        const d = dialog("区域名称", (b, a, close, err) => {
            const capture = () => {
                if (ni) {
                    draftName = ni.value;
                    draftEnglish = ei.value;
                }
                if (si) {
                    profile.synopsis = si.value;
                    profile.content = ci.value;
                    profile.tags = ti.value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
                    profile.notes = no.value;
                }
            };
            const render = () => {
                capture();
                current = w.regions.find(o => o.id === id);
                if (!current) {
                    close();
                    return;
                }
                b.replaceChildren();
                const preview = el("div", "map-region-title-preview"), nf = input("中文名", draftName), ef = input("英文名", draftEnglish);
                ni = nf[1];
                ei = ef[1];
                const update = () => fillRegionTitle(preview, {
                    ...current,
                    name: ni.value,
                    english: ei.value
                });
                ni.oninput = ei.oninput = update;
                update();
                b.append(preview, nf[0], ef[0]);
                const doc = libraryDocs.find(d => d.id === recordId && !d.archived), binding = el("div", "map-record-binding"), same = C.exactRegionRecords(libraryDocs, {
                    name: draftName,
                    english: draftEnglish
                });
                binding.append(el("strong", "", doc ? "已绑定 · " + doc.title : recordId ? "绑定词条未找到" : same.length > 1 ? "有 " + same.length + " 个同名词条，请选择" : "未绑定"));
                const choose = d => {
                    capture();
                    recordId = d.id;
                    change(() => {
                        const live = w.regions.find(o => o.id === id);
                        live.textDocId = d.id;
                        live.bindingDismissed = false;
                    });
                    profile = getProfile();
                    draftName = d.title || draftName;
                    draftEnglish = d.details?.english || draftEnglish;
                    ni = si = null;
                    render();
                };
                binding.append(button(doc ? "更换词条" : "选择词条", () => bindingRegionChooser(choose)));
                if (doc || recordId) binding.append(button("解除绑定", () => {
                    capture();
                    recordId = "";
                    change(() => {
                        const live = w.regions.find(o => o.id === id);
                        delete live.textDocId;
                        live.bindingDismissed = true;
                        live.textDetails = {
                            ...live.textDetails,
                            [sceneId]: copy(profile)
                        };
                    });
                    render();
                })); else if (same.length) binding.append(button("保持独立", () => {
                    change(() => w.regions.find(o => o.id === id).bindingDismissed = true);
                    render();
                }));
                if (doc) binding.append(button("跳转到词条", async () => {
                    if (await save()) {
                        close();
                        exit();
                        bridge.openRecord(doc.id);
                    }
                }));
                b.append(binding);
                b.append(el("h3", "", scene().name));
                const sf = textArea("简介", profile.synopsis), cf = textArea("详情", profile.content), tf = input("标签", Array.isArray(profile.tags) ? profile.tags.join("，") : ""), nof = textArea("备注", profile.notes);
                [si, ci, ti, no] = [ sf[1], cf[1], tf[1], nof[1] ];
                b.append(sf[0], cf[0]);
                const meta = fold("标签与备注", b);
                meta.append(tf[0], nof[0]);
                if (!doc) b.append(button("新建文字词条并绑定", async () => {
                    try {
                        capture();
                        if (!ni.value.trim() || !ei.value.trim()) throw Error("请填写中英文名。");
                        const record = C.makeAreaRecord(ni.value.trim(), ei.value.trim(), profile), created = await bridge.createRecord(record);
                        libraryDocs = bridge.getProject().documents || [];
                        choose(created);
                    } catch (e) {
                        err(e);
                    }
                }, "map-full"));
                const style = fold("标题样式", b);
                style.append(check("显示阴影", current.labelShadow !== false, v => {
                    change(() => w.regions.find(o => o.id === id).labelShadow = v);
                    render();
                }), input("阴影颜色", current.labelColor || "#ffffff", "color", v => {
                    change(() => w.regions.find(o => o.id === id).labelColor = v);
                    render();
                })[0]);
                regionLabelControls(style, render);
            };
            const save = async () => {
                capture();
                const name = draftName.trim(), english = draftEnglish.trim();
                if (!name || !english) {
                    err("请填写中英文名。");
                    return false;
                }
                try {
                    const doc = libraryDocs.find(d => d.id === recordId && !d.archived);
                    if (doc) {
                        const next = copy(doc);
                        next.title = name;
                        next.details = {
                            ...next.details,
                            english: english,
                            regionProfiles: [ ...(next.details?.regionProfiles || []).filter(p => p.sceneId !== sceneId), {
                                ...profile,
                                sceneId: sceneId,
                                title: scene().name
                            } ]
                        };
                        await bridge.updateRecord(next);
                        libraryDocs = bridge.getProject().documents || [];
                    }
                    change(() => {
                        const live = w.regions.find(o => o.id === id);
                        Object.assign(live, {
                            name: name,
                            english: english,
                            textDocId: recordId,
                            textDetails: {
                                ...live.textDetails,
                                [sceneId]: copy(profile)
                            }
                        });
                    });
                    synchronizeRecords();
                    return true;
                } catch (e) {
                    err(e);
                    return false;
                }
            };
            render();
            if (world) a.append(button("进入区域", () => {
                close();
                openRegion(id);
            }));
            a.append(button("保存", async () => {
                if (await save()) close();
            }, "primary"));
        });
        regionTitleModal = {
            id: id,
            dialog: d
        };
    }
    function bindingRegionChooser(fn) {
        return bindingPicker("region", fn);
    }
    function ensureMarkerRecord(o) {
        if (!o || ![ "echo", "broadcast", "pearl" ].includes(o.kind) || o.docId || o.recordMode === "plain" || o.recordMode === "colored" || o.bindingDismissed) return Promise.resolve();
        const matching = C.exactRecords(libraryDocs, o.kind, [ o.name ]);
        if (matching.length === 1) {
            change(() => C.bindRecord(o, matching[0]));
            return Promise.resolve();
        }
        if (matching.length > 1) {
            showRecordCard(o);
            return Promise.resolve();
        }
        if (markerRecordPending.has(o.id)) return markerRecordPending.get(o.id);
        const targetProject = projectKey, r = reg();
        const pending = (async () => {
            try {
                const record = C.makeRegionRecord(o.kind, o.name, r);
                record.details.appearance = copy(o.appearance || {
                    baseColor: o.color || "#cccccc"
                });
                if (o.kind === "echo") record.details.echo = {
                    karma: o.karma || 1,
                    type: o.echoType || "once",
                    room: r.rooms.find(rm => rm.id === o.roomId)?.name || "",
                    typeNote: ""
                };
                const doc = await bridge.createRecord(record);
                if (projectKey !== targetProject) return;
                libraryDocs = bridge.getProject().documents || [];
                change(() => {
                    const live = w.regions.flatMap(r => r.markers).find(m => m.id === o.id);
                    if (live) C.bindRecord(live, doc);
                });
            } catch (e) {
                toast("文字词条尚未创建：" + e.message);
            }
        })();
        markerRecordPending.set(o.id, pending);
        return pending.finally(() => markerRecordPending.delete(o.id));
    }
    function synchronizeRecords() {
        if (!w) return;
        let changed = false;
        for (const r of w.regions) {
            if (!r.textDocId && !r.bindingDismissed) {
                const matches = C.exactRegionRecords(libraryDocs, r);
                if (matches.length === 1) {
                    r.textDocId = matches[0].id;
                    changed = true;
                }
            }
            const area = libraryDocs.find(d => d.id === r.textDocId && !d.archived);
            if (area) {
                if (area.title && r.name !== area.title) {
                    r.name = area.title;
                    changed = true;
                }
                if (area.details?.english && r.english !== area.details.english) {
                    r.english = area.details.english;
                    changed = true;
                }
            }
            for (const m of r.markers) {
                if (m.kind === "iterator" && !m.iteratorDocId && !m.bindingDismissed) {
                    const matches = C.exactRecords(libraryDocs, "iterator", [ m.name ]);
                    if (matches.length === 1) {
                        m.iteratorDocId = matches[0].id;
                        changed = true;
                    }
                }
                if (!m.docId && !m.bindingDismissed && [ "pearl", "broadcast", "echo" ].includes(m.kind) && ![ "plain", "colored" ].includes(m.recordMode)) {
                    const matches = C.exactRecords(libraryDocs, m.kind, [ m.name ]);
                    if (matches.length === 1) {
                        C.bindRecord(m, matches[0]);
                        changed = true;
                    }
                }
                const doc = libraryDocs.find(d => d.id === (m.kind === "iterator" ? m.iteratorDocId : m.docId) && !d.archived);
                if (!doc) continue;
                if (doc.title && m.name !== doc.title) {
                    m.name = doc.title;
                    changed = true;
                }
                if (m.kind === "echo") {
                    const e = doc.details?.echo || {}, echoRoom = r.rooms.find(rm => rm.name === e.room);
                    if (echoRoom && echoRoom.id !== m.roomId) {
                        m.roomId = echoRoom.id;
                        m.layer = echoRoom.layer;
                        if (!C.inside(m, echoRoom)) {
                            m.x = echoRoom.x + echoRoom.w / 2;
                            m.y = echoRoom.y + echoRoom.h / 2;
                        }
                        changed = true;
                    }
                    const next = {
                        karma: e.karma || 1,
                        echoType: e.type || "once",
                        dialogue: doc.content || ""
                    };
                    if (JSON.stringify([ m.karma, m.echoType, m.dialogue ]) !== JSON.stringify([ next.karma, next.echoType, next.dialogue ])) {
                        Object.assign(m, next);
                        changed = true;
                    }
                }
            }
        }
        if (changed) scheduleSave();
        window.OCMapRecords?.setContext(w);
    }
    function recordDialog(o) {
        synchronizeRecords();
        $("mapRecordCard")?.remove();
        dialog(o.name || C.categories[o.kind], (b, a, close, err) => {
            let doc = libraryDocs.find(d => d.id === o.docId), [nf, ni] = input("名称", doc?.title || o.name || ""), [sf, si] = textArea("简介", doc?.details?.synopsis || o.synopsis || "");
            const binding = el("div", "map-record-binding");
            binding.append(el("strong", "", doc ? "已绑定 · " + doc.title : o.docId ? "绑定词条未找到" : "未绑定"), button(doc ? "更换绑定" : "绑定已有词条", () => bindingPicker(o.kind, d => {
                change(() => C.bindRecord(o, d));
                close();
                recordDialog(o);
            })));
            if (doc) binding.append(button("解除绑定", () => {
                change(() => {
                    delete o.docId;
                    o.recordMode = "blank";
                    o.bindingDismissed = true;
                    o.synopsis = si.value;
                });
                close();
                recordDialog(o);
            }));
            b.append(nf, binding, sf);
            let echoFields = null;
            if (o.kind === "echo") {
                const e = doc?.details?.echo || {
                    karma: o.karma || 1,
                    type: o.echoType || "once",
                    room: reg().rooms.find(rm => rm.id === o.roomId)?.name || ""
                }, [kf, ki] = input("给予业力", e.karma, "number"), [tf, ti] = select("回响类型", e.type, {
                    once: "一次回响",
                    twice: "二次回响",
                    other: "其他类型"
                }), [rf, ri] = input("所属房间", e.room), [cf, ci] = textArea("回响文本", doc?.content || o.dialogue || "");
                ki.min = 1;
                ki.max = 10;
                b.append(kf, tf, rf, cf);
                echoFields = {
                    ki: ki,
                    ti: ti,
                    ri: ri,
                    ci: ci
                };
            }
            const save = async (forceRecord = false) => {
                try {
                    const reason = C.lockReason(reg(), o, o.kind);
                    if (reason) throw Error(reason);
                    if (markerRecordPending.has(o.id)) await markerRecordPending.get(o.id);
                    let live = reg().markers.find(m => m.id === o.id);
                    doc = libraryDocs.find(d => d.id === live?.docId);
                    if (!live) throw Error("标记已不存在");
                    if (!forceRecord && !doc && (o.bindingDismissed || o.kind === "pearl" && [ "plain", "colored" ].includes(o.recordMode))) {
                        change(() => {
                            live.name = ni.value.trim() || C.categories[o.kind];
                            live.synopsis = si.value;
                            if (echoFields) {
                                live.karma = Math.max(1, Math.min(10, +echoFields.ki.value || 1));
                                live.echoType = echoFields.ti.value;
                                live.dialogue = echoFields.ci.value;
                                const rm = reg().rooms.find(r => r.name === echoFields.ri.value);
                                if (rm) {
                                    live.roomId = rm.id;
                                    live.layer = rm.layer;
                                }
                            }
                        });
                        return live;
                    }
                    if (!doc && live.docId) throw Error("绑定词条未找到，请重新选择词条或解除绑定。");
                    if (!doc && !live.bindingDismissed) {
                        const matches = C.exactRecords(libraryDocs, o.kind, [ ni.value.trim() ]);
                        if (matches.length > 1) throw Error("有多个同名词条，请先选择绑定。");
                        doc = matches[0] || null;
                    }
                    let next = doc ? copy(doc) : C.makeRegionRecord(o.kind, ni.value.trim(), reg());
                    next.title = ni.value.trim() || C.categories[o.kind];
                    next.details = {
                        ...next.details,
                        synopsis: si.value,
                        ...o.kind === "pearl" ? {
                            appearance: copy(o.appearance || {
                                baseColor: o.color || "#cccccc"
                            })
                        } : {}
                    };
                    if (echoFields) {
                        const {ki: ki, ti: ti, ri: ri, ci: ci} = echoFields;
                        next.details.echo = {
                            ...next.details.echo,
                            karma: Math.max(1, Math.min(10, +ki.value || 1)),
                            type: ti.value,
                            room: ri.value
                        };
                        next.content = ci.value;
                    }
                    const savedDoc = doc ? await bridge.updateRecord(next) : await bridge.createRecord(next);
                    libraryDocs = bridge.getProject().documents || [];
                    change(() => C.bindRecord(live, savedDoc));
                    synchronizeRecords();
                    return savedDoc;
                } catch (e) {
                    err(e);
                    return null;
                }
            };
            if (o.kind === "pearl") b.append(input("珍珠颜色", o.color || "#cccccc", "color", v => change(() => {
                o.color = v;
                o.appearance = {
                    ...o.appearance,
                    baseColor: v
                };
            }))[0]);
            b.append(button("文字详情", async () => {
                const d = doc || await save(true);
                if (d) {
                    close();
                    exit();
                    bridge.openRecord(d.id);
                }
            }));
            const maps = fold("地图关联", b);
            maps.append(check("所有共用地图", !o.sceneIds?.length, v => change(() => o.sceneIds = v ? [] : [ sceneId ])));
            for (const ss of w.scenes) maps.append(check(ss.name, !o.sceneIds?.length || o.sceneIds.includes(ss.id), v => change(() => {
                const ids = new Set(o.sceneIds?.length ? o.sceneIds : w.scenes.map(s => s.id));
                v ? ids.add(ss.id) : ids.delete(ss.id);
                o.sceneIds = [ ...ids ];
                if (!o.sceneIds.length) o.sceneIds = [ sceneId ];
            })));
            b.append(row(button("复制", () => {
                change(() => {
                    const q = {
                        ...copy(o),
                        id: C.uid(),
                        x: Math.min(reg().w, o.x + 2)
                    };
                    reg().markers.push(q);
                    selection = {
                        list: "markers",
                        id: q.id
                    };
                });
                close();
            }), button("删除", () => {
                selection = {
                    list: "markers",
                    id: o.id
                };
                requireEdit(() => {
                    change(removeSelected);
                    close();
                });
            })));
            a.append(button("保存", async () => {
                if (await save()) close();
            }, "primary"));
        });
    }
    function renderPendingRooms(n) {
        const pending = w.regions.filter(r => r.gateStorageOnly).flatMap(r => r.rooms.filter(rm => rm.pendingRegionAssignment).map(rm => ({
            r: r,
            rm: rm
        })));
        if (!pending.length) return;
        const section = fold("待归属房间", n, "pending-rooms", true), regions = scene().regions.map(id => w.regions.find(r => r.id === id)).filter(r => r && !r.gateStorageOnly);
        for (const {r: r, rm: rm} of pending) {
            const line = row(button("编辑 " + rm.name, () => {
                openRegion(r.id);
                focusRoom(rm);
            }));
            if (regions.length) {
                const [f, i] = select("归属区域 · " + rm.name, "", {
                    "": "选择区域",
                    ...Object.fromEntries(regions.map(rr => [ rr.id, rr.name + " / " + rr.code ]))
                });
                i.onchange = () => {
                    if (i.value) change(() => C.assignPendingRoomRegion(w, {
                        region: r.id,
                        room: rm.id
                    }, i.value, sceneId));
                };
                line.append(f);
            }
            section.append(line);
        }
        if (!regions.length) section.append(button("新建区域", () => regionDialog(), "map-full"));
    }
    function renderWorldOverview(n) {
        const ss = scene();
        ss.groups ||= [];
        const assigned = new Set(ss.groups.flatMap(g => g.regions)), groups = [ ...ss.groups, {
            id: "ungrouped",
            name: "未分组",
            regions: ss.regions.filter(id => !assigned.has(id))
        } ];
        const move = (rid, gid) => change(() => {
            for (const g of ss.groups) g.regions = g.regions.filter(id => id !== rid);
            const target = ss.groups.find(g => g.id === gid);
            if (target && !target.regions.includes(rid)) target.regions.push(rid);
        });
        const rename = (g = null) => dialog(g ? "分组名称" : "新建分组", (b, a, close, err) => {
            const [f, i] = input("名称", g?.name || "");
            b.append(f);
            a.append(button("保存", () => {
                const name = i.value.trim();
                if (!name) {
                    err("请填写名称");
                    return;
                }
                change(() => {
                    if (g) g.name = name; else ss.groups.push({
                        id: C.uid(),
                        name: name,
                        regions: []
                    });
                });
                close();
            }, "primary"));
        });
        n.append(button("新建分组", () => rename(), "map-full"));
        for (const group of groups) {
            if (group.id === "ungrouped" && !group.regions.length) continue;
            const body = fold(group.name, n, "region-group:" + group.id, true), summary = body.querySelector("summary");
            summary.draggable = group.id !== "ungrouped";
            summary.ondragstart = e => e.dataTransfer.setData("application/rainoc-group", group.id);
            body.ondragover = e => e.preventDefault();
            body.ondrop = e => {
                e.preventDefault();
                e.stopPropagation();
                const rid = e.dataTransfer.getData("application/rainoc-region"), gid = e.dataTransfer.getData("application/rainoc-group");
                if (ss.regions.includes(rid)) move(rid, group.id); else if (gid && gid !== group.id && group.id !== "ungrouped") change(() => {
                    const from = ss.groups.findIndex(g => g.id === gid), to = ss.groups.findIndex(g => g.id === group.id);
                    if (from >= 0 && to >= 0) ss.groups.splice(to, 0, ss.groups.splice(from, 1)[0]);
                });
            };
            if (group.id !== "ungrouped") {
                const more = button("⋯", e => {
                    e?.preventDefault?.();
                    dropdown(more, [ [ "重命名", () => rename(group) ], [ "上移", () => change(() => {
                        const i = ss.groups.indexOf(group);
                        if (i > 0) [ss.groups[i - 1], ss.groups[i]] = [ ss.groups[i], ss.groups[i - 1] ];
                    }) ], [ "下移", () => change(() => {
                        const i = ss.groups.indexOf(group);
                        if (i < ss.groups.length - 1) [ss.groups[i + 1], ss.groups[i]] = [ ss.groups[i], ss.groups[i + 1] ];
                    }) ], [ "解散分组", () => change(() => ss.groups = ss.groups.filter(g => g.id !== group.id)) ] ]);
                });
                summary.append(more);
            }
            for (const id of group.regions.filter(id => ss.regions.includes(id))) {
                const rr = w.regions.find(r => r.id === id), line = row(), name = button("", () => regionTitleDialog(rr), "map-full"), more = button("⋯", () => dropdown(more, [ [ "进入区域", () => openRegion(id) ], [ "定位", () => focusRegionOnWorld(rr) ], ...groups.filter(g => g.id !== group.id).map(g => [ "移到 " + g.name, () => move(id, g.id) ]) ]));
                fillRegionTitle(name, rr);
                line.append(name, more);
                line.draggable = true;
                line.ondragstart = e => {
                    e.stopPropagation();
                    e.dataTransfer.setData("application/rainoc-region", id);
                };
                body.append(line);
            }
        }
        renderPendingRooms(n);
    }
    function searchFeatures() {
        dialog("检索", (b, a, close) => {
            const [sf, si] = input("名称 / 标签 / 内容", ""), [tf, ti] = select("类型", "all", {
                all: "全部",
                region: "区域",
                room: "房间",
                gate: "业力门",
                pearl: "珍珠",
                broadcast: "广播",
                iterator: "迭代器",
                echo: "回响",
                ports: "通道井",
                record: "文字词条"
            }), results = el("div", "map-search-results");
            b.append(sf, tf, results);
            const render = () => {
                results.replaceChildren();
                const query = si.value.trim().toLowerCase();
                if (!query) return;
                const entries = [];
                for (const r of w.regions) {
                    const maps = w.scenes.filter(s => s.regions.includes(r.id));
                    if (!maps.length) continue;
                    const sid = maps.some(s => s.id === sceneId) ? sceneId : maps[0].id;
                    entries.push({
                        kind: "region",
                        name: r.name + " / " + r.english,
                        tags: libraryDocs.find(d => d.id === r.textDocId)?.details?.tags || [],
                        r: r,
                        sid: sid
                    });
                    for (const [list, kind] of [ [ "rooms", "room" ], [ "markers", null ], [ "ports", "ports" ] ]) for (const o of r[list]) {
                        const doc = libraryDocs.find(d => d.id === o.docId);
                        entries.push({
                            kind: kind || o.kind,
                            name: o.name || C.categories[o.kind] || C.portKinds[o.kind],
                            tags: [ ...doc?.details?.tags || [], ...o.tags || [], o.notes || "", o.externalId || "" ],
                            r: r,
                            o: o,
                            list: list,
                            sid: sid
                        });
                    }
                }
                for (const doc of libraryDocs.filter(d => !d.archived)) entries.push({
                    kind: "record",
                    name: doc.title,
                    tags: [ doc.category, doc.content, doc.details?.synopsis, ...doc.details?.tags || [], ...(doc.details?.regionProfiles || []).flatMap(p => [ p.title, p.synopsis, p.content, ...p.tags || [] ]) ],
                    doc: doc
                });
                const found = entries.filter(e => (ti.value === "all" || e.kind === ti.value) && [ e.name, ...e.tags ].join(" ").toLowerCase().includes(query));
                for (const e of found.slice(0, 150)) results.append(button(e.name + " · " + {
                    region: "区域",
                    room: "房间",
                    record: "文字",
                    ports: "通道井",
                    ...C.categories
                }[e.kind], () => {
                    close();
                    if (e.doc) {
                        exit();
                        bridge.openRecord(e.doc.id);
                        return;
                    }
                    if (sceneId !== e.sid) switchScene(e.sid);
                    if (e.kind === "region") {
                        focusRegionOnWorld(e.r);
                        return;
                    }
                    openRegion(e.r.id);
                    layerId = e.o.layer;
                    selection = {
                        list: e.list,
                        id: e.o.id
                    };
                    roomId = null;
                    const category = e.list === "markers" ? e.o.kind : e.list;
                    if (reg().categories[category]) change(() => {
                        reg().categories[category].visible = true;
                        const l = reg().layers.find(l => l.id === e.o.layer);
                        if (l) l.visible = true;
                        const rm = reg().rooms.find(rm => rm.id === e.o.roomId);
                        if (rm) rm.visible = true;
                        if (e.list === "ports") reg().detailsVisible = true;
                    });
                    const v = viewSize();
                    cam.z = e.list === "rooms" ? Math.min(v.w / (e.o.w + 30), v.h / (e.o.h + 30)) : 5;
                    cam.x = v.w / 2 - (e.o.x + (e.o.w || 0) / 2) * cam.z;
                    cam.y = v.h / 2 - (e.o.y + (e.o.h || 0) / 2) * cam.z;
                    sidebar = e.list === "rooms" ? "layers" : "objects";
                    $("mapSide").classList.add("panel-open");
                    refresh();
                }, "map-full"));
                if (!found.length) results.append(note("没有匹配结果"));
            };
            si.oninput = ti.onchange = render;
            si.focus();
        });
    }
    function importMenu() {
        dropdown($("mapMenu"), [ [ "RainOC 项目 / 地图 JSON", importBackup ], ...!world && reg() ? [ [ "Rained 房间覆盖", () => rainedImportDialog(room() || (selection?.list === "rooms" ? selected() : null)) ] ] : [] ]);
    }
    async function readRainedFile(file) {
        if (file.size > 50 * 1024 * 1024) throw Error("房间文件超过 50 MB。");
        if (!file.name.toLowerCase().endsWith(".rwlz")) return file.text();
        const bytes = new Uint8Array(await file.arrayBuffer()), v = new DataView(bytes.buffer);
        let end = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 101010256) {
            end = i;
            break;
        }
        if (end < 0) throw Error("RWLZ 文件目录损坏。");
        let at = v.getUint32(end + 16, true);
        for (let i = 0; i < v.getUint16(end + 10, true); i++) {
            if (v.getUint32(at, true) !== 33639248) throw Error("RWLZ 文件目录无效。");
            const method = v.getUint16(at + 10, true), size = v.getUint32(at + 20, true), full = v.getUint32(at + 24, true), nl = v.getUint16(at + 28, true), el = v.getUint16(at + 30, true), cl = v.getUint16(at + 32, true), local = v.getUint32(at + 42, true), name = (new TextDecoder).decode(bytes.slice(at + 46, at + 46 + nl));
            if (/^[^/\\]+\.txt$/i.test(name)) {
                if (full > 40 * 1024 * 1024 || size > 50 * 1024 * 1024) throw Error("解压后的房间过大。");
                const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
                if (start + size > bytes.length) throw Error("房间数据不完整。");
                const data = bytes.slice(start, start + size);
                if (method === 0) return (new TextDecoder).decode(data);
                if (method !== 8) throw Error("不支持此压缩方式。");
                const stream = new Blob([ data ]).stream().pipeThrough(new DecompressionStream("deflate-raw")), reader = stream.getReader(), chunks = [];
                let total = 0;
                for (;;) {
                    const {done: done, value: value} = await reader.read();
                    if (done) break;
                    total += value.length;
                    if (total > 40 * 1024 * 1024) {
                        reader.cancel();
                        throw Error("解压后的房间过大。");
                    }
                    chunks.push(value);
                }
                return new Blob(chunks).text();
            }
            at += 46 + nl + el + cl;
        }
        throw Error("RWLZ 中没有房间 TXT。");
    }
    function rainedImportDialog(initial = null) {
        dialog("Rained 房间覆盖", (b, a, close, err) => {
            const r = reg(), [rf, ri] = select("覆盖房间", initial?.id || r.rooms[0]?.id || "", Object.fromEntries(r.rooms.map(rm => [ rm.id, rm.name ]))), file = el("input"), info = el("p");
            file.type = "file";
            file.accept = ".txt,.rwlz";
            file.setAttribute("aria-label", "Rained 房间文件");
            let data = null;
            const review = () => {
                if (!data) return;
                try {
                    const test = copy(w), rr = test.regions.find(rr => rr.id === r.id), result = C.replaceRoomFromRained(test, rr, ri.value, data);
                    info.textContent = data.w + " × " + data.h + " 格；移动 " + result.moved.length + " 个邻近房间" + (result.expanded ? "；扩展区域范围" : "");
                    apply.disabled = false;
                } catch (e) {
                    info.textContent = e.message;
                    apply.disabled = true;
                }
            };
            file.onchange = async () => {
                try {
                    if (!file.files[0]) return;
                    data = C.parseRainedRoom(await readRainedFile(file.files[0]));
                    review();
                } catch (e) {
                    data = null;
                    err(e);
                    apply.disabled = true;
                }
            };
            ri.onchange = review;
            b.append(rf, file, info);
            b.append(note("覆盖房间几何、镜头和水深；RWLZ 光照图不导入。"));
            const apply = button("覆盖", () => {
                if (!data) return;
                let issue;
                const ok = change(() => {
                    try {
                        C.replaceRoomFromRained(w, reg(), ri.value, data);
                        selection = {
                            list: "rooms",
                            id: ri.value
                        };
                    } catch (e) {
                        issue = e;
                        throw e;
                    }
                });
                if (ok) {
                    close();
                    fit();
                } else err(issue || "未覆盖");
            }, "primary");
            apply.disabled = true;
            a.append(button("取消", close), apply);
        });
    }
    function sharedGateProjection(r, g) {
        const source = sharedGateRoom(g), side = g.a.region === r.id ? g.a : g.b.region === r.id ? g.b : null, m = side && r.markers.find(m => m.id === side.marker), localLayer = C.gateLayer(r), sourceLayer = source && C.gateLayer(source.region);
        if (!source || !m || !localLayer || source.region.id === r.id || g.visible === false || !g.scenes.includes(sceneId) || m.visible === false || m.sceneIds?.length && !m.sceneIds.includes(sceneId) || localLayer.visible === false || !C.roomVisible(source.region, source.room) || sourceLayer?.visible === false || !((source.room.fullDisplay ?? sourceLayer?.fullDisplay) === true || linkViewEnabled() || !cleanPreview && layerId === localLayer.id)) return null;
        const rm = source.room, base = {
            x: Math.max(0, Math.min(r.w - rm.w, m.x - rm.w / 2)),
            y: Math.max(0, Math.min(r.h - rm.h, m.y - rm.h / 2)),
            w: rm.w,
            h: rm.h
        }, points = [ base, ...r.rooms.flatMap(o => [ {
            ...base,
            x: o.x - rm.w - 2
        }, {
            ...base,
            x: o.x + o.w + 2
        }, {
            ...base,
            y: o.y - rm.h - 2
        }, {
            ...base,
            y: o.y + o.h + 2
        } ]) ], fits = p => p.x >= 0 && p.y >= 0 && p.x + p.w <= r.w && p.y + p.h <= r.h && !r.rooms.some(o => C.intersection(p, o)), at = points.filter(fits).sort((a, b) => Math.hypot(a.x - base.x, a.y - base.y) - Math.hypot(b.x - base.x, b.y - base.y))[0] || base, prefix = "shared-view-" + g.id + "-", dx = at.x - rm.x, dy = at.y - rm.y, project = o => {
            const next = copy(o);
            C.shift(next, dx, dy);
            next.id = prefix + o.id;
            next.roomId = prefix + rm.id;
            next.layer = localLayer.id;
            return next;
        }, projected = {
            ...copy(rm),
            ...at,
            id: prefix + rm.id,
            layer: localLayer.id,
            fullDisplay: true,
            sharedGateProjection: g.id
        };
        return {
            room: projected,
            layer: {
                ...localLayer,
                fullDisplay: true,
                opacity: C.opacity(sourceLayer)
            },
            shapes: source.region.shapes.filter(o => o.roomId === rm.id).map(project),
            ports: source.region.ports.filter(o => o.roomId === rm.id).map(o => ({
                ...project(o),
                sharedGateSource: {
                    region: source.region.id,
                    port: o.id
                }
            })),
            markers: source.region.markers.filter(o => o.roomId === rm.id && o.kind !== "gate").map(project),
            refs: source.region.refs.filter(o => o.roomId === rm.id).map(project),
            source: source.region
        };
    }
    function previewRegion(r, z, preview) {
        r = presentationSources.get(r) || r;
        const hidden = w.gates.filter(g => g.sharedRoom?.region === r.id && (g.visible === false || !g.scenes.includes(sceneId) || world && !r.sharedGateWorldView && ![ g.a.region, g.b.region ].includes(r.id))).map(g => g.sharedRoom.room), gates = !world ? w.gates.filter(g => g.sharedRoom?.region !== r.id && [ g.a.region, g.b.region ].includes(r.id)) : [], signature = JSON.stringify([ hidden, world, cleanPreview, layerId, linkViewEnabled(), gates.map(g => [ g.id, g.visible, g.scenes, g.sharedRoom, C.gateLayer(w.regions.find(rr => rr.id === g.sharedRoom.region) || {
            layers: []
        }) ]) ]), sources = gates.map(g => w.regions.find(rr => rr.id === g.sharedRoom.region)), key = r.id + ":shared-view", cached = presentationCache.get(key);
        if (cached?.source === r && cached.signature === signature && sources.every((source, i) => source === cached.sources[i])) return cached.region;
        const projections = gates.map(g => sharedGateProjection(r, g)).filter(Boolean);
        const linking = linkViewEnabled();
        if (!hidden.length && !projections.length && !linking) return r;
        const region = {
            ...r,
            ...linking ? {
                detailsVisible: true,
                categories: {
                    ...r.categories,
                    ports: {
                        ...r.categories.ports,
                        visible: true
                    },
                    connections: {
                        ...r.categories.connections,
                        visible: true
                    }
                }
            } : {},
            rooms: [ ...r.rooms.map(rm => hidden.includes(rm.id) ? {
                ...rm,
                visible: false
            } : linking && rm.roomType === "GATE" ? {
                ...rm,
                fullDisplay: true
            } : rm), ...projections.map(p => p.room) ],
            layers: r.layers.map(l => {
                const shown = projections.find(p => p.layer.id === l.id)?.layer || l;
                return linking && l.id === C.gateLayer(r)?.id ? {
                    ...shown,
                    fullDisplay: true
                } : shown;
            })
        };
        for (const list of [ "shapes", "ports", "markers", "refs" ]) region[list] = [ ...r[list], ...projections.flatMap(p => p[list]) ];
        presentationSources.set(region, r);
        presentationCache.set(key, {
            source: r,
            signature: signature,
            sources: sources,
            region: region
        });
        return region;
    }
    window.OCMapEditor = {
        exportProjectTransfer: async () => {
            mount();
            const p = bridge.getProject(), key = p.uid || p.id;
            const stored = projectKey === key && w ? copy(w) : projectDrafts.get(key)?.value || (await read(key))?.value || C.workspace(), base = await bridge.exportBundle();
            download({
                format: "rw-oc-map-bundle",
                version: 1,
                ocProject: base,
                mapWorkspace: C.validate(stored),
                created: (new Date).toISOString()
            }, p.name + ".rainoc");
        },
        importProjectTransfer: async payload => {
            const data = C.validate(payload.mapWorkspace);
            mount();
            rememberDraft();
            importing = true;
            try {
                await bridge.importBundle(payload.ocProject);
                await enter();
                change(() => {
                    w = data;
                    sceneId = w.activeScene;
                    world = true;
                    regionId = null;
                    roomId = null;
                    selection = null;
                });
                fit();
                toast("已导入，请保存或导出备份。");
            } finally {
                importing = false;
            }
        }
    };
    window.addEventListener("oc-project-render", mount);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
