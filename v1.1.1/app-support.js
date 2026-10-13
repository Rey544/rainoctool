(function(root) {
    "use strict";
    const base = new URL("./", location.href), emptyIcon = "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%221%22%20height=%221%22/%3E";
    let registration = null, cacheState = "准备中", persistState = "检查中", persistAttempted = false, persistPromise = null, iconQueue = Promise.resolve(), iconGeneration = 0, settingsGeneration = 0, lastIconKey = "", dialog = null;
    const node = (tag, text) => {
        const e = document.createElement(tag);
        if (text !== undefined) e.textContent = text;
        return e;
    };
    const req = r => new Promise((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
    const appRead = () => root.OCStandalone.transaction("readonly", (_, __, settings) => req(settings.get("app")));
    const appWrite = fn => root.OCStandalone.transaction("readwrite", async (_, __, settings) => {
        const value = {
            id: "app",
            title: "Rainworld OC Collection PWA",
            ...await req(settings.get("app"))
        };
        fn(value);
        await req(settings.put(value));
        return value;
    });
    function dataBlob(data) {
        const [header, body] = data.split(","), bytes = Uint8Array.from(atob(body), c => c.charCodeAt(0));
        return new Blob([ bytes ], {
            type: header.match(/^data:([^;]+)/)?.[1] || "image/png"
        });
    }
    function image(src) {
        return new Promise((resolve, reject) => {
            const img = new Image;
            img.onload = () => resolve(img);
            img.onerror = () => reject(Error("应用图标无法读取。"));
            img.src = src;
        });
    }
    async function resizeIcon(data, size) {
        if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data || "")) throw Error("请先导入并保存应用图标。");
        const img = await image(data), canvas = node("canvas");
        canvas.width = canvas.height = size;
        const c = canvas.getContext("2d");
        c.clearRect(0, 0, size, size);
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = "high";
        c.drawImage(img, 0, 0, size, size);
        return dataBlob(canvas.toDataURL("image/png"));
    }
    function link(rel) {
        let value = document.head.querySelector('link[rel="' + rel + '"]');
        if (!value) {
            value = node("link");
            value.rel = rel;
            document.head.append(value);
        }
        return value;
    }
    async function applySettings(value) {
        const generation = ++settingsGeneration;
        document.title = value?.title || "Rainworld OC Collection PWA";
        const current = root.OCProjectIcon?.current, icon = current?.explicit ? current.iconData : null;
        if (icon) {
            const favicon = link("icon");
            favicon.href = icon;
            favicon.type = "image/png";
            const apple = link("apple-touch-icon");
            apple.href = icon;
            apple.sizes = "512x512";
        } else if (current?.explicit) {
            const favicon = link("icon");
            favicon.href = emptyIcon;
            favicon.type = "image/svg+xml";
            document.head.querySelector('link[rel="apple-touch-icon"]')?.remove();
        } else if (value?.icon512) {
            const data = await new Promise((resolve, reject) => {
                const reader = new FileReader;
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(value.icon512);
            });
            if (generation !== settingsGeneration) return;
            const favicon = link("icon");
            favicon.href = data;
            favicon.type = "image/png";
            link("apple-touch-icon").href = data;
        }
        if (location.protocol !== "file:") {
            const bytes = await root.OCStandalone.crypto.subtle.digest("SHA-256", (new TextEncoder).encode(JSON.stringify([ value?.iconVersion || "", value?.title || "" ]))), version = Array.from(new Uint8Array(bytes)).map(n => n.toString(16).padStart(2, "0")).join("");
            if (generation !== settingsGeneration) return;
            const manifest = link("manifest");
            manifest.href = new URL("manifest.webmanifest?v=" + version, base).href;
        }
    }
    function syncIcon(detail) {
        if (!detail || !detail.explicit || typeof detail.iconData !== "string") return iconQueue;
        const key = JSON.stringify([ detail.projectId, detail.iconData ]);
        if (key === lastIconKey) return iconQueue;
        lastIconKey = key;
        const generation = ++iconGeneration;
        iconQueue = iconQueue.catch(() => {}).then(async () => {
            if (generation !== iconGeneration) return;
            const data = detail.iconData;
            const small = data ? await resizeIcon(data, 192) : null, large = data ? await resizeIcon(data, 512) : null;
            if (generation !== iconGeneration) return;
            const version = data ? Array.from(new Uint8Array(await root.OCStandalone.crypto.subtle.digest("SHA-256", (new TextEncoder).encode(data)))).map(n => n.toString(16).padStart(2, "0")).join("") : "";
            const value = await appWrite(app => {
                if (data) {
                    app.icon192 = small;
                    app.icon512 = large;
                    app.iconVersion = version;
                } else {
                    delete app.icon192;
                    delete app.icon512;
                    delete app.iconVersion;
                }
            });
            if (generation === iconGeneration) await applySettings(value);
        }).catch(error => {
            lastIconKey = "";
            showNotice(error.message || "应用图标同步失败，请重新保存图标。");
        });
        return iconQueue;
    }
    function showNotice(message) {
        const text = document.getElementById("noticeText"), wrap = document.getElementById("notice");
        if (text && wrap) {
            text.textContent = message;
            wrap.hidden = false;
        }
    }
    function refreshStatus() {
        const p = document.getElementById("appStorageStatus"), c = document.getElementById("appOfflineStatus");
        if (p) p.textContent = "持久存储：" + persistState;
        if (c) c.textContent = "离线缓存：" + cacheState;
    }
    async function checkPersistence() {
        if (!root.OCStandalone.persistent) {
            persistState = "临时保存";
        } else if (navigator.storage?.persisted) {
            persistState = await navigator.storage.persisted().catch(() => false) ? "已允许" : "由浏览器管理";
        } else persistState = "浏览器不支持";
        refreshStatus();
    }
    async function requestPersistence(force = false) {
        if (persistPromise) return persistPromise;
        if (persistAttempted && !force) return;
        persistAttempted = true;
        persistPromise = (async () => {
            if (root.OCStandalone.persistent && navigator.storage?.persist) {
                try {
                    const saved = await (navigator.storage.persisted?.());
                    if (!saved) await navigator.storage.persist();
                } catch {}
            }
            await checkPersistence();
        })().finally(() => persistPromise = null);
        return persistPromise;
    }
    async function offlineStatus() {
        try {
            const expected = new URL("sw.js", base).href;
            cacheState = navigator.serviceWorker?.controller?.scriptURL === expected ? "已就绪" : registration?.active ? "刷新后就绪" : "准备中";
        } catch {
            cacheState = "暂不可用";
        }
        refreshStatus();
    }
    async function setupOffline() {
        if (location.protocol === "file:") {
            cacheState = "本地文件";
            refreshStatus();
            return;
        }
        if (!root.isSecureContext || !navigator.serviceWorker) {
            cacheState = "浏览器不支持";
            refreshStatus();
            return;
        }
        try {
            registration = await navigator.serviceWorker.register(new URL("sw.js", base), {
                scope: base.href,
                updateViaCache: "none"
            });
            navigator.serviceWorker.addEventListener("controllerchange", () => {
                offlineStatus();
                appRead().then(applySettings).catch(() => {});
            });
            const watch = worker => worker?.addEventListener("statechange", () => {
                if (worker.state === "redundant") {
                    cacheState = "准备失败";
                    refreshStatus();
                } else offlineStatus();
            });
            watch(registration.installing);
            registration.addEventListener("updatefound", () => watch(registration.installing));
            await offlineStatus();
            registration.update().catch(() => {});
        } catch {
            cacheState = "准备失败";
            refreshStatus();
        }
    }
    async function downloadIcon(size) {
        await iconQueue;
        const current = root.OCProjectIcon?.current;
        let blob;
        if (current?.explicit) {
            blob = await resizeIcon(current.iconData, size);
        } else {
            const settings = await appRead();
            blob = settings?.["icon" + size];
            if (!blob) throw Error("请先导入并保存应用图标。");
        }
        if (!blob.size) throw Error("应用图标为空。");
        root.OCStandalone.download(blob, "app-icon-" + size + ".png", "image/png");
    }
    async function openSettings() {
        if (dialog?.open) return;
        await iconQueue;
        const app = await appRead();
        dialog = node("dialog");
        dialog.className = "sheet app-settings-dialog";
        dialog.setAttribute("aria-label", "应用设置");
        const header = node("div");
        header.className = "sheet-heading";
        const close = node("button", "×");
        close.setAttribute("aria-label", "关闭应用设置");
        close.onclick = () => dialog.close();
        header.append(node("h2", "应用设置"), close);
        const label = node("label", "网页标题"), title = node("input");
        title.value = app?.title || "Rainworld OC Collection PWA";
        title.maxLength = 100;
        title.setAttribute("aria-label", "网页标题");
        label.append(title);
        const preview = node("img");
        preview.alt = "当前应用图标";
        preview.className = "app-icon-preview";
        const own = root.OCProjectIcon?.current;
        preview.hidden = !(own?.iconData || !own?.explicit && app?.icon512);
        if (own?.iconData) preview.src = own.iconData; else if (!own?.explicit && app?.icon512) {
            preview.src = URL.createObjectURL(app.icon512);
            const url = preview.src;
            dialog.addEventListener("close", () => URL.revokeObjectURL(url), {
                once: true
            });
        }
        const actions = node("div");
        actions.className = "app-icon-actions";
        const make = (name, fn) => {
            const b = node("button", name);
            b.type = "button";
            b.onclick = () => Promise.resolve().then(fn).catch(e => status.textContent = e.message);
            return b;
        };
        const status = node("p", "");
        status.setAttribute("role", "status");
        actions.append(make("导入 / 裁切应用图标", () => {
            dialog.close();
            document.getElementById("projectIconButton")?.click();
        }), make("下载 192 PNG", () => downloadIcon(192)), make("下载 512 PNG", () => downloadIcon(512)));
        const storage = node("p");
        storage.id = "appStorageStatus";
        const offline = node("p");
        offline.id = "appOfflineStatus";
        const footer = node("div");
        footer.className = "sheet-actions";
        footer.append(make("申请持久存储", () => requestPersistence(true)), make("保存", async () => {
            const value = title.value.trim();
            if (!value) throw Error("请填写网页标题。");
            await applySettings(await appWrite(app => app.title = value));
            await requestPersistence();
            status.textContent = "已保存";
        }));
        dialog.append(header, label, preview, actions, storage, offline, status, footer);
        dialog.addEventListener("close", () => {
            dialog.remove();
            dialog = null;
        }, {
            once: true
        });
        document.getElementById("projectDialog")?.close();
        document.body.append(dialog);
        await checkPersistence();
        dialog.showModal();
    }
    root.addEventListener("oc-project-icon-change", event => syncIcon(event.detail));
    async function start() {
        await root.OCStandalone.init();
        const actions = document.querySelector("#projectDialog .sheet-actions");
        if (actions && !document.getElementById("applicationSettingsButton")) {
            const settings = node("button", "应用设置");
            settings.id = "applicationSettingsButton";
            settings.onclick = () => openSettings().catch(e => showNotice(e.message));
            actions.append(settings);
        }
        await checkPersistence();
        setupOffline();
        if (root.OCProjectIcon?.current) await syncIcon(root.OCProjectIcon.current);
        await applySettings(await appRead());
        document.addEventListener("click", event => {
            if (event.isTrusted && event.target.closest?.("#textSaveButton,#imageSaveButton,#importUpdateButton,#importCopyButton,#mapSave,.project-icon-dialog .sheet-actions button")) requestPersistence();
        }, true);
    }
    root.OCAppSupport = {
        openSettings: openSettings,
        downloadIcon: downloadIcon,
        requestPersistence: requestPersistence,
        syncIcon: syncIcon,
        resizeIcon: resizeIcon,
        get settled() {
            return iconQueue;
        }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => start().catch(e => showNotice(e.message)), {
        once: true
    }); else start().catch(e => showNotice(e.message));
})(window);
