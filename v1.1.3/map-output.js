(function(root, factory) {
    const api = factory();
    if (typeof module === "object") module.exports = api; else root.OCMapOutput = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    "use strict";
    const appVersion = "1.1.3";
    function clean(value, fallback = "地图") {
        let s = String(value ?? "").normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").trim().slice(0, 140);
        if (!s) s = fallback;
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)) s = "_" + s;
        return s;
    }
    function defaultName(scene, regions, mode) {
        if (mode === "project") return "项目";
        if (!regions.length) return scene?.name || "地图";
        if (mode === "current" && regions[0]) return regions[0].name;
        if (regions.length === 1) return regions[0].name;
        if (mode === "selected" && regions.length <= 3) return regions.map(r => r.name).join("+");
        return (scene?.name || "地图") + (mode === "selected" ? "-" + regions.length + "个区域" : "");
    }
    function versions(value = {}) {
        return {
            map: String(value.map || "").trim().slice(0, 40),
            project: String(value.project || "").trim().slice(0, 40)
        };
    }
    function fileName({name: name, format: format = "png", includeVersion: includeVersion = true, mapVersion: mapVersion = "", projectVersion: projectVersion = ""} = {}) {
        const ext = {
            project: "rainoc",
            map: "json",
            png: "png",
            rained: "zip"
        }[format] || "json";
        let base = clean(name).replace(/\.(?:rainoc|json|png|zip)$/i, "");
        const v = versions({
            map: mapVersion,
            project: projectVersion
        }), parts = [];
        if (includeVersion) {
            if (v.map) parts.push("地图-" + clean(v.map));
            if (v.project) parts.push("项目-" + clean(v.project));
            if (!parts.length) parts.push("RainocTool-" + appVersion);
        }
        if (format === "rained") parts.push("Rained");
        return [ base, ...parts ].join("-") + "." + ext;
    }
    function caption({showMapVersion: showMapVersion = false, showProjectVersion: showProjectVersion = false, mapVersion: mapVersion = "", projectVersion: projectVersion = ""} = {}) {
        const v = versions({
            map: mapVersion,
            project: projectVersion
        });
        return [ showMapVersion && v.map ? "地图版本 " + v.map : "", showProjectVersion && v.project ? "项目版本 " + v.project : "" ].filter(Boolean).join("  ·  ");
    }
    return {
        appVersion: appVersion,
        clean: clean,
        defaultName: defaultName,
        versions: versions,
        fileName: fileName,
        caption: caption
    };
});
