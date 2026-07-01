var ByteArray = imports.byteArray;
var Cairo = imports.cairo;
var Clutter = imports.gi.Clutter;
var Gio = imports.gi.Gio;
var GLib = imports.gi.GLib;
var Pango = imports.gi.Pango;
var St = imports.gi.St;

var ExtensionUtils = imports.misc.extensionUtils;
var Main = imports.ui.main;
var MessageTray = imports.ui.messageTray;
var PopupMenu = imports.ui.popupMenu;
var Me = ExtensionUtils.getCurrentExtension();

var CONFIG_PATH = GLib.build_filenamev([Me.path, 'config.json']);

function readInstallConfig() {
    try {
        var result = GLib.file_get_contents(CONFIG_PATH);
        var ok = result[0];
        var bytes = result[1];
        if (!ok)
            return {};
        return JSON.parse(ByteArray.toString(bytes));
    } catch (e) {
        return {};
    }
}

var INSTALL_CONFIG = readInstallConfig();
var PYTHON_PATH = INSTALL_CONFIG.python_bin || '/usr/bin/python3';

var CACHE_DIR = GLib.build_filenamev([
    GLib.get_home_dir(),
    '.cache',
    'quotahalo',
]);
var LABEL_PATH = GLib.build_filenamev([
    GLib.get_home_dir(),
    '.cache',
    'quotahalo',
    'usage-label.txt',
]);
var JSON_PATH = GLib.build_filenamev([
    GLib.get_home_dir(),
    '.cache',
    'quotahalo',
    'usage-status.json',
]);
var COPILOT_JSON_PATH = GLib.build_filenamev([
    GLib.get_home_dir(),
    '.cache',
    'copilot-usage',
    'status.json',
]);
var DEBUG_PATH = GLib.build_filenamev([
    GLib.get_home_dir(),
    '.cache',
    'quotahalo',
    'extension-debug.json',
]);
var REFRESH_DEBUG_PATH = GLib.build_filenamev([
    GLib.get_home_dir(),
    '.cache',
    'quotahalo',
    'extension-refresh-debug.json',
]);
var UPDATE_DEBUG_PATH = GLib.build_filenamev([
    GLib.get_home_dir(),
    '.cache',
    'quotahalo',
    'extension-update-debug.json',
]);
var PANEL_LAYOUT_PATH = GLib.build_filenamev([
    CACHE_DIR,
    'panel-layout.json',
]);
var UPDATE_DISMISSED_PATH = GLib.build_filenamev([
    CACHE_DIR,
    'update-dismissed.json',
]);
var SCRIPT_PATH = INSTALL_CONFIG.status_script || GLib.build_filenamev([
    GLib.get_home_dir(),
    '3_work_tools',
    'QuotaHalo-Linux',
    'quota_halo_status.py',
]);
var COPILOT_SCRIPT_PATH = INSTALL_CONFIG.copilot_script || GLib.build_filenamev([
    GLib.get_home_dir(),
    '3_work_tools',
    'QuotaHalo-Linux',
    'copilot_status_service.py',
]);
var OPENAI_ICON_PATH = GLib.build_filenamev([Me.path, 'openai-icon.png']);
var CLAUDE_ICON_PATH = GLib.build_filenamev([Me.path, 'claude-icon.png']);
var COPILOT_ICON_PATH = GLib.build_filenamev([Me.path, 'github-copilot-icon.png']);
var SYSTEM_UPDATE_SECONDS = 2;
var USAGE_REFRESH_SECONDS = 30;
var GPU_CACHE_USEC = 3 * 1000 * 1000;
var PROXY_IPINFO_URL = 'https://ipinfo.io/json';
var PROXY_UPDATE_SECONDS = 60;
var PROXY_CANDIDATES = [
    { name: 'FlClash', url: 'http://127.0.0.1:7890', interfaceName: 'FlClash' },
    { name: 'Clash/Mihomo', url: 'http://127.0.0.1:7890' },
    { name: 'Clash Verge', url: 'http://127.0.0.1:7897' },
    { name: 'Clash/Mihomo', url: 'http://127.0.0.1:7891' },
    { name: 'Local proxy', url: 'http://127.0.0.1:8080' },
    { name: 'Direct public IP', direct: true },
];

var usageIndicator = null;
var systemIndicator = null;

function fallbackStatus() {
    var label = 'Codex --';
    try {
        var result = GLib.file_get_contents(LABEL_PATH);
        var ok = result[0];
        var bytes = result[1];
        if (!ok)
            return { label: label };
        var text = ByteArray.toString(bytes).trim();
        label = text || label;
    } catch (e) {
    }
    return { label: label };
}

function readStatus() {
    try {
        var result = GLib.file_get_contents(JSON_PATH);
        var ok = result[0];
        var bytes = result[1];
        if (!ok)
            return fallbackStatus();

        var status = JSON.parse(ByteArray.toString(bytes));
        status.label = status.label || 'Codex --';
        return status;
    } catch (e) {
        return fallbackStatus();
    }
}

function fallbackCopilotStatus() {
    return {
        provider: 'GitHub Copilot',
        state: 'missing',
        label: 'Copilot --',
        updated: 'Never',
        top_models: [],
    };
}

function readCopilotStatus() {
    try {
        var result = GLib.file_get_contents(COPILOT_JSON_PATH);
        if (!result[0])
            return fallbackCopilotStatus();

        var status = JSON.parse(ByteArray.toString(result[1]));
        status.label = status.label || 'Copilot --';
        status.top_models = status.top_models || [];
        return status;
    } catch (e) {
        return fallbackCopilotStatus();
    }
}

function updateAvailable(update) {
    return !!(update && update.update_available &&
        update.latest_version && update.current_version &&
        String(update.latest_version) !== String(update.current_version));
}

function updateChangelogText(update, limit) {
    var changelog = update && update.changelog ? update.changelog : [];
    var parts = [];
    var i;

    limit = limit || 4;
    for (i = 0; i < Math.min(changelog.length, limit); i++) {
        if (changelog[i])
            parts.push(String(changelog[i]));
    }
    if (changelog.length > limit)
        parts.push('More changes available on GitHub');
    return parts.join('\n');
}

function updateReminderText(update) {
    var latest;

    if (!updateAvailable(update))
        return '';
    latest = String(update.latest_version);
    return 'Update available: ' + latest;
}

function readDismissedUpdateVersion() {
    try {
        var result = GLib.file_get_contents(UPDATE_DISMISSED_PATH);
        var parsed;
        if (!result[0])
            return '';
        parsed = JSON.parse(ByteArray.toString(result[1]));
        return String(parsed.dismissed_version || '');
    } catch (e) {
        return '';
    }
}

function writeDismissedUpdateVersion(version) {
    try {
        GLib.mkdir_with_parents(CACHE_DIR, 448);
        GLib.file_set_contents(UPDATE_DISMISSED_PATH, JSON.stringify({
            dismissed_version: String(version || ''),
            dismissed_at: new Date().toISOString(),
        }, null, 2) + '\n');
    } catch (e) {
        log('quotahalo update dismiss write failed: ' + e);
    }
}

function resetText(value) {
    if (!value || value === '--' || value === 'unknown')
        return 'unknown';
    return value;
}

function clampPercent(value) {
    var n = Number(value);
    if (isNaN(n))
        return 0;
    if (n < 0)
        return 0;
    if (n > 100)
        return 100;
    return n;
}

function resetEpochFor(status, usedKey) {
    var key;
    var n;

    if (!status)
        return 0;
    key = usedKey === 'weekly_used_pct' ? 'weekly_reset_epoch' : 'session_reset_epoch';
    n = Number(status[key]);
    if (isNaN(n) || n <= 0)
        return 0;
    if (n > 100000000000)
        n = n / 1000;
    return n;
}

function isRateLimitExpired(status, usedKey) {
    var epoch = resetEpochFor(status, usedKey);

    return epoch > 0 && epoch * 1000 <= Date.now();
}

function usedPercent(status, usedKey) {
    if (!status)
        return 0;
    if (isRateLimitExpired(status, usedKey))
        return 0;
    return clampPercent(status[usedKey]);
}

function resetTextFor(status, usedKey, value) {
    if (isRateLimitExpired(status, usedKey))
        return 'now';
    return resetText(value);
}

function usageRingColor(value, provider) {
    var pct = clampPercent(value);
    if (pct > 80)
        return [0.89, 0.29, 0.29, 1.0];
    if (pct > 50)
        return [0.91, 0.66, 0.24, 1.0];
    if (provider === 'copilot')
        return [0.34, 0.62, 0.96, 1.0];
    if (provider === 'claude')
        return [0.85, 0.47, 0.34, 1.0];
    return [0.06, 0.64, 0.50, 1.0];
}

function copilotModelColor(model, index) {
    var text = String(model || '').toLowerCase();
    var palette = [
        [0.34, 0.62, 0.96, 1.0],
        [0.06, 0.64, 0.50, 1.0],
        [0.69, 0.48, 0.97, 1.0],
        [0.91, 0.66, 0.24, 1.0],
        [0.93, 0.42, 0.52, 1.0],
        [0.20, 0.74, 0.80, 1.0],
    ];

    if (text.indexOf('codex') >= 0)
        return [0.06, 0.64, 0.50, 1.0];
    if (text.indexOf('gpt-5.4') >= 0)
        return [0.34, 0.62, 0.96, 1.0];
    if (text.indexOf('gpt-5.3') >= 0)
        return [0.69, 0.48, 0.97, 1.0];
    return palette[index % palette.length];
}

function shortCopilotModelName(model) {
    var text = String(model || 'Model').trim();

    return text.replace(/^Auto:\s*/i, '');
}

function copilotModelSegments(status) {
    var models = status && status.top_models ? status.top_models : [];
    var used = Number(status && (status.usage_used !== undefined ?
        status.usage_used : status.requests_used));
    var pct = clampPercent(status ? status.pct_used : 0);
    var total = 0;
    var denom;
    var segments = [];
    var i;
    var quantity;
    var model;
    var segmentPct;
    var share;
    var remainder;

    if (!models.length || pct <= 0)
        return [];

    for (i = 0; i < models.length; i++) {
        quantity = Number(models[i].quantity || 0);
        if (!isNaN(quantity) && quantity > 0)
            total += quantity;
    }
    if (total <= 0)
        return [];
    if (isNaN(used) || used <= 0)
        used = total;
    denom = Math.max(used, total);

    for (i = 0; i < models.length; i++) {
        quantity = Number(models[i].quantity || 0);
        if (isNaN(quantity) || quantity <= 0)
            continue;
        model = shortCopilotModelName(models[i].model);
        segmentPct = pct * quantity / denom;
        share = 100 * quantity / denom;
        segments.push({
            pct: segmentPct,
            share: share,
            label: model,
            color: copilotModelColor(model, segments.length),
        });
    }

    remainder = used - total;
    if (remainder > 0.01) {
        segments.push({
            pct: pct * remainder / denom,
            share: 100 * remainder / denom,
            label: 'Other',
            color: [0.58, 0.64, 0.72, 1.0],
        });
    }
    return segments;
}

function copilotModelBreakdownText(segments) {
    var parts = [];
    var i;
    var segment;

    for (i = 0; i < Math.min(segments.length, 3); i++) {
        segment = segments[i];
        parts.push(segment.label + ' ' + String(Math.round(segment.share)) + '%');
    }
    if (segments.length > 3)
        parts.push('Other models');
    return parts.join('  ·  ');
}

function drawSegmentedProgressBar(area, pctValue, segments) {
    var alloc = area.get_allocation_box();
    var width = alloc.x2 - alloc.x1;
    var height = alloc.y2 - alloc.y1;
    var padding = 4;
    var y = Math.max(4, height / 2);
    var usable = Math.max(0, width - padding * 2);
    var pct = clampPercent(pctValue);
    var cr = area.get_context();
    var lineWidth = Math.max(5, Math.min(7, height - 2));
    var half = lineWidth / 2;
    var usedEnd = padding + usable * pct / 100;
    var x = padding;
    var i;
    var segment;
    var next;
    var color;
    var firstColor = null;
    var lastColor = null;
    var totalPct = 0;

    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(lineWidth);
    cr.setSourceRGBA(1.0, 1.0, 1.0, 0.12);
    cr.moveTo(padding, y);
    cr.lineTo(width - padding, y);
    cr.stroke();

    if (pct <= 0) {
        cr.$dispose();
        return;
    }

    for (i = 0; i < segments.length; i++) {
        segment = segments[i];
        totalPct += clampPercent(segment.pct);
        next = padding + usable * Math.min(totalPct, pct) / 100;
        if (next <= x)
            continue;
        color = segment.color || usageRingColor(pct, 'copilot');
        if (!firstColor)
            firstColor = color;
        lastColor = color;
        cr.setSourceRGBA(color[0], color[1], color[2], color[3]);
        cr.rectangle(x, y - half, next - x, lineWidth);
        cr.fill();
        x = next;
        if (x >= usedEnd)
            break;
    }

    if (x < usedEnd) {
        color = [0.58, 0.64, 0.72, 1.0];
        if (!firstColor)
            firstColor = color;
        lastColor = color;
        cr.setSourceRGBA(color[0], color[1], color[2], color[3]);
        cr.rectangle(x, y - half, usedEnd - x, lineWidth);
        cr.fill();
    }

    if (firstColor) {
        cr.setSourceRGBA(firstColor[0], firstColor[1], firstColor[2], firstColor[3]);
        cr.arc(padding, y, half, 0, Math.PI * 2);
        cr.fill();
    }
    if (lastColor) {
        cr.setSourceRGBA(lastColor[0], lastColor[1], lastColor[2], lastColor[3]);
        cr.arc(usedEnd, y, half, 0, Math.PI * 2);
        cr.fill();
    }

    cr.$dispose();
}

function drawProgressBar(area, pctValue, provider, segments) {
    var alloc = area.get_allocation_box();
    var width = alloc.x2 - alloc.x1;
    var height = alloc.y2 - alloc.y1;
    var padding = 4;
    var y = Math.max(4, height / 2);
    var usable = Math.max(0, width - padding * 2);
    var pct = clampPercent(pctValue);
    var color = usageRingColor(pct, provider);
    var end = padding + usable * pct / 100;
    var cr;

    if (provider === 'copilot' && segments && segments.length) {
        drawSegmentedProgressBar(area, pct, segments);
        return;
    }

    cr = area.get_context();
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(Math.max(5, Math.min(7, height - 2)));

    cr.setSourceRGBA(1.0, 1.0, 1.0, 0.12);
    cr.moveTo(padding, y);
    cr.lineTo(width - padding, y);
    cr.stroke();

    if (pct > 0) {
        cr.setSourceRGBA(color[0], color[1], color[2], color[3]);
        cr.moveTo(padding, y);
        cr.lineTo(Math.max(padding + 0.1, end), y);
        cr.stroke();
    }

    cr.$dispose();
}

function hasCodexProvider(status) {
    return hasCodexQuota(status);
}

function hasCodexQuota(status) {
    if (!status || status.provider !== 'Codex' || !status.available)
        return false;
    if (status.source === 'none' || status.source === 'config')
        return false;
    return status.session_used_pct !== undefined && status.session_used_pct !== null;
}

function codexLabelText(status) {
    if (!hasCodexProvider(status))
        return '';
    if (!hasCodexQuota(status))
        return '--';
    return String(Math.round(usedPercent(status, 'session_used_pct'))) + '%';
}

function panelLabelText(status) {
    return codexLabelText(status);
}

function hasClaudeProvider(status) {
    var claude = status && status.claude ? status.claude : null;
    return !!(claude && claude.available && hasClaudeQuota(claude));
}

function hasClaudeQuota(status) {
    if (!status)
        return false;
    if (status.source === 'none' || status.source === 'config' ||
        status.source === 'logs' || status.source === 'credentials')
        return false;
    return status.session_used_pct !== undefined && status.session_used_pct !== null;
}

function claudeLabelText(status) {
    var claude = status && status.claude ? status.claude : null;

    if (!hasClaudeProvider(status))
        return '';
    if (!hasClaudeQuota(claude))
        return '--';
    return String(Math.round(usedPercent(claude, 'session_used_pct'))) + '%';
}

function claudeWeeklyUsedPercent(status) {
    var claude = status && status.claude ? status.claude : null;

    if (!claude || !claude.available || !hasClaudeQuota(claude))
        return 0;
    return usedPercent(claude, 'weekly_used_pct');
}

function copilotUsedPercent(status) {
    if (!status || status.state === 'missing' || status.state === 'error')
        return 0;
    return clampPercent(status.pct_used);
}

function hasCopilotProvider(status) {
    return !!(status && status.state === 'ready' &&
        status.pct_used !== undefined && status.pct_used !== null);
}

function copilotLabelText(status) {
    if (!hasCopilotProvider(status))
        return '';
    return String(Math.round(clampPercent(status.pct_used))) + '%';
}

function usageNumberText(value, status) {
    var n = Number(value);

    if (isNaN(n))
        return '--';
    if (status && status.unit === 'credits') {
        if (Math.abs(n) >= 100)
            return String(Math.round(n));
        return n.toFixed(1).replace(/\.0$/, '');
    }
    return String(Math.round(n));
}

function providerModelText(status, provider) {
    var model;

    if (!status || !status.model)
        return '';
    model = String(status.model).trim();
    if (provider === 'claude')
        model = model.replace(/^claude[-_\s]*/i, '');
    return model;
}

function providerHeaderMetaText(status, provider) {
    var parts = [];
    var model;

    if (!status)
        return 'No data';
    if (status.plan)
        parts.push(String(status.plan));
    model = providerModelText(status, provider);
    if (model)
        parts.push(model);
    if (status.stale)
        parts.push('stale');
    if (status.updated && status.updated !== 'Never')
        parts.push(compactUpdatedText(status.updated));
    return parts.length ? parts.join('  ·  ') : 'No data';
}

function copilotUnitText(status) {
    if (status && status.unit === 'credits')
        return 'credits';
    return 'req';
}

function remainingPercent(status, usedKey, remainingKey) {
    var value;

    if (!status)
        return null;
    if (isRateLimitExpired(status, usedKey))
        return 100;
    value = status[remainingKey];
    if (value !== undefined && value !== null)
        return Math.round(clampPercent(value));
    value = status[usedKey];
    if (value === undefined || value === null)
        return null;
    return Math.round(100 - clampPercent(value));
}

function quotaText(status, usedKey, remainingKey) {
    var used;
    var remaining = remainingPercent(status, usedKey, remainingKey);

    if (remaining === null)
        return '--';
    if (status[usedKey] === undefined || status[usedKey] === null)
        return String(remaining) + '% remaining';
    used = Math.round(usedPercent(status, usedKey));
    return String(used) + '% used (' + String(remaining) + '% remaining)';
}

function updatedText(value) {
    var text = value || 'Never';
    if (text.indexOf('Updated ') === 0)
        return 'Updated: ' + text.slice(8);
    if (text.indexOf('Updated: ') === 0)
        return text;
    return 'Updated: ' + text;
}

function compactUpdatedText(value) {
    return updatedText(value).replace(/^Updated: /, 'Updated ');
}

function itemActor(item) {
    if (!item)
        return null;
    return item.actor || item;
}

function setItemVisible(item, visible) {
    var actor = itemActor(item);

    if (!actor)
        return;
    if (visible)
        actor.show();
    else
        actor.hide();
}

function setLabelEllipsize(label) {
    if (!label || !label.clutter_text)
        return;
    if (label.clutter_text.set_line_wrap)
        label.clutter_text.set_line_wrap(false);
    if (label.clutter_text.set_ellipsize)
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
}

function addItemStyle(item, styleClass) {
    var actor = itemActor(item);

    if (actor && actor.add_style_class_name)
        actor.add_style_class_name(styleClass);
}

function providerSourceText(status) {
    var parts = [];
    var source;

    if (!status)
        return 'No data';
    if (status.plan)
        parts.push(String(status.plan));
    if (status.model)
        parts.push(String(status.model));
    if (status.unit_label && !status.plan)
        parts.push(String(status.unit_label));
    source = status.source ? String(status.source) : '';
    if (source && source !== 'none' && source !== 'oauth' && source !== 'sessions')
        parts.push(source);
    if (status.updated && status.updated !== 'Never')
        parts.push(compactUpdatedText(status.updated));
    return parts.length ? parts.join('  ·  ') : 'No data';
}

function statusErrorText(status) {
    if (!status)
        return '';
    return String(status.error || status.refresh_error || '');
}

function compactErrorText(message) {
    var text = String(message || 'Refresh command failed').trim();

    if (!text)
        text = 'Refresh command failed';
    text = text.replace(/\s+/g, ' ');
    if (text.length > 240)
        text = text.slice(0, 237) + '...';
    return text;
}

function parsedHttpError(message) {
    var text = String(message || '');
    var match = text.match(/HTTP\s+(\d+)/i);
    var brace = text.indexOf('{');
    var payload = null;

    if (brace >= 0) {
        try {
            payload = JSON.parse(text.slice(brace));
        } catch (e) {
            payload = null;
        }
    }
    return {
        code: match ? Number(match[1]) : 0,
        type: payload && payload.error ? String(payload.error.type || '') : '',
        message: payload && payload.error ? String(payload.error.message || '') : '',
    };
}

function friendlyErrorText(message, providerName) {
    var text = String(message || '');
    var lower = text.toLowerCase();
    var provider = providerName || 'QuotaHalo';
    var parsed = parsedHttpError(text);

    if (parsed.code === 429 || parsed.type === 'rate_limit_error')
        return provider + ' usage check hit a rate limit. Please try again later.';
    if (parsed.code === 401 || parsed.type === 'authentication_error')
        return provider + ' usage check could not authenticate. Sign in again and refresh.';
    if (lower.indexOf('backoff') >= 0 || lower.indexOf('recent failure') >= 0)
        return provider + ' usage check is paused after a recent failure. Try again in a few minutes.';
    if (lower.indexOf('timed out') >= 0 || lower.indexOf('timeout') >= 0)
        return provider + ' usage check timed out. Please try again later.';
    return compactErrorText(parsed.message || text);
}

function providerIconPath(providerName) {
    var name = String(providerName || '').toLowerCase();

    if (name === 'copilot')
        return COPILOT_ICON_PATH;
    if (name === 'codex')
        return OPENAI_ICON_PATH;
    if (name === 'claude')
        return CLAUDE_ICON_PATH;
    return '';
}

function unavailableDetailText(status) {
    var error = statusErrorText(status);

    if (error)
        return 'Usage unavailable  ·  details sent as notification';
    return 'Usage unavailable  ·  ' + providerSourceText(status);
}

function actorSummary(actor) {
    if (!actor)
        return null;
    return {
        text: actor.toString(),
        visible: actor.visible,
        mapped: actor.mapped,
        width: actor.width,
        height: actor.height,
    };
}

function writeDebug(payload) {
    try {
        GLib.file_set_contents(DEBUG_PATH, JSON.stringify(payload, null, 2));
    } catch (e) {
    }
}

function writeRefreshDebug(payload) {
    try {
        GLib.file_set_contents(REFRESH_DEBUG_PATH, JSON.stringify(payload, null, 2));
    } catch (e) {
    }
}

function writeUpdateUiDebug(payload) {
    try {
        GLib.file_set_contents(UPDATE_DEBUG_PATH, JSON.stringify(payload, null, 2));
    } catch (e) {
    }
}

function normalizePanelPosition(value, fallback) {
    if (value === 'left' || value === 'right')
        return value;
    return fallback;
}

function readPanelLayout() {
    var layout = { usage: 'right', system: 'left' };
    var result;
    var raw;
    var parsed;

    try {
        result = GLib.file_get_contents(PANEL_LAYOUT_PATH);
        if (!result[0])
            return layout;
        raw = ByteArray.toString(result[1]);
        parsed = JSON.parse(raw);
        layout.usage = normalizePanelPosition(parsed.usage, layout.usage);
        layout.system = normalizePanelPosition(parsed.system, layout.system);
    } catch (e) {
    }
    return layout;
}

function writePanelLayout(layout) {
    try {
        GLib.mkdir_with_parents(CACHE_DIR, 448);
        GLib.file_set_contents(PANEL_LAYOUT_PATH, JSON.stringify({
            usage: normalizePanelPosition(layout.usage, 'right'),
            system: normalizePanelPosition(layout.system, 'left'),
        }, null, 2) + '\n');
    } catch (e) {
        log('quotahalo layout write failed: ' + e);
    }
}

function panelPosition(kind) {
    var layout = readPanelLayout();

    if (kind === 'system')
        return normalizePanelPosition(layout.system, 'left');
    return normalizePanelPosition(layout.usage, 'right');
}

function setPanelPosition(kind, position) {
    var layout = readPanelLayout();

    if (kind === 'system')
        layout.system = normalizePanelPosition(position, 'left');
    else
        layout.usage = normalizePanelPosition(position, 'right');
    writePanelLayout(layout);
}

function panelBoxForPosition(position) {
    return position === 'left' ? Main.panel._leftBox : Main.panel._rightBox;
}

function movePanelActor(actor, position) {
    var box = panelBoxForPosition(position);
    var parent;
    var index;

    if (!actor || !box)
        return;
    parent = actor.get_parent ? actor.get_parent() : null;
    if (parent && parent.remove_child)
        parent.remove_child(actor);
    index = position === 'left' && box.get_children ? box.get_children().length : 0;
    box.insert_child_at_index(actor, index);
}

function removeActorChildren(actor) {
    var children;
    var i;

    if (!actor || !actor.get_children || !actor.remove_child)
        return;
    children = actor.get_children();
    for (i = 0; i < children.length; i++)
        actor.remove_child(children[i]);
}

function setButtonLabel(button, text) {
    if (!button)
        return;
    if (button.set_label)
        button.set_label(text);
    else
        button.label = text;
}

function setButtonEnabled(button, enabled) {
    if (!button)
        return;
    if (button.set_reactive)
        button.set_reactive(enabled);
    else
        button.reactive = enabled;
    button.can_focus = enabled;
    button.opacity = enabled ? 255 : 150;
}

function makeActionButton(label, styleClass) {
    return new St.Button({
        label: label,
        can_focus: true,
        reactive: true,
        track_hover: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: styleClass,
    });
}

function makePositionButton(label) {
    return makeActionButton(label, 'quotahalo-position-option');
}

function addPanelPositionControl(menu, kind, callback) {
    var item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
    var row = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'quotahalo-position-row',
    });
    var spacer = new St.Widget({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    var control;
    var button = makePositionButton('');

    function render(position) {
        position = normalizePanelPosition(position, panelPosition(kind));
        removeActorChildren(row);
        if (position === 'left') {
            setButtonLabel(button, 'Switch to Right');
            row.add_child(spacer);
            row.add_child(button);
        } else {
            setButtonLabel(button, 'Switch to Left');
            row.add_child(button);
            row.add_child(spacer);
        }
    }

    function apply(position) {
        position = normalizePanelPosition(position, panelPosition(kind));
        setPanelPosition(kind, position);
        render(position);
        if (callback)
            callback(position);
    }

    control = {
        item: item,
        button: button,
    };
    addItemStyle(item, 'quotahalo-position-item');
    button.connect('clicked', function() {
        var current = panelPosition(kind);
        apply(current === 'left' ? 'right' : 'left');
    });
    item.add_child(row);
    menu.addMenuItem(item);
    render(panelPosition(kind));
    return control;
}

function addUsageActionsControl(menu, refreshCallback, positionCallback) {
    var item = new PopupMenu.PopupBaseMenuItem();
    var row = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'quotahalo-actions-row',
    });
    var spacer = new St.Widget({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    var refreshButton = makeActionButton('Refresh now', 'quotahalo-action-button quotahalo-refresh-button');
    var positionButton = makeActionButton('', 'quotahalo-action-button quotahalo-position-option');
    var control;

    function render(position) {
        position = normalizePanelPosition(position, panelPosition('usage'));
        removeActorChildren(row);
        if (position === 'left') {
            setButtonLabel(positionButton, 'Switch to Right');
            row.add_child(refreshButton);
            row.add_child(spacer);
            row.add_child(positionButton);
        } else {
            setButtonLabel(positionButton, 'Switch to Left');
            row.add_child(positionButton);
            row.add_child(spacer);
            row.add_child(refreshButton);
        }
    }

    function apply(position) {
        position = normalizePanelPosition(position, panelPosition('usage'));
        setPanelPosition('usage', position);
        render(position);
        if (positionCallback)
            positionCallback(position);
    }

    control = {
        item: item,
        refreshButton: refreshButton,
        positionButton: positionButton,
        render: render,
        refreshClickedId: 0,
        positionClickedId: 0,
    };
    addItemStyle(item, 'quotahalo-actions-item');
    control.refreshClickedId = refreshButton.connect('clicked', function() {
        if (refreshCallback)
            refreshCallback();
    });
    control.positionClickedId = positionButton.connect('clicked', function() {
        var current = panelPosition('usage');
        apply(current === 'left' ? 'right' : 'left');
    });
    item.add_child(row);
    menu.addMenuItem(item);
    render(panelPosition('usage'));
    return control;
}

function readTextFile(path) {
    try {
        var result = GLib.file_get_contents(path);
        if (!result[0])
            return null;
        return ByteArray.toString(result[1]);
    } catch (e) {
        return null;
    }
}

function parseNumber(text) {
    var n = Number(text);
    if (isNaN(n))
        return 0;
    return n;
}

function pctText(value) {
    var text = String(Math.round(clampPercent(value)));

    while (text.length < 3)
        text = ' ' + text;
    return text + '%';
}

function unavailablePctText() {
    return ' --%';
}

function formatRate(bytesPerSecond) {
    var b = Math.max(0, Number(bytesPerSecond) || 0);
    if (b >= 1024 * 1024 * 1024)
        return (b / (1024 * 1024 * 1024)).toFixed(1) + 'G';
    if (b >= 1024 * 1024)
        return (b / (1024 * 1024)).toFixed(1) + 'M';
    if (b >= 1024)
        return (b / 1024).toFixed(1) + 'K';
    return Math.round(b) + 'B';
}

function formatBytes(bytes) {
    var b = Math.max(0, Number(bytes) || 0);
    if (b >= 1024 * 1024 * 1024)
        return (b / (1024 * 1024 * 1024)).toFixed(1) + ' GiB';
    if (b >= 1024 * 1024)
        return (b / (1024 * 1024)).toFixed(1) + ' MiB';
    if (b >= 1024)
        return (b / 1024).toFixed(1) + ' KiB';
    return Math.round(b) + ' B';
}

function readCpuSnapshot() {
    var text = readTextFile('/proc/stat');
    var parts;
    var total = 0;
    var idle = 0;
    var i;

    if (!text)
        return null;
    parts = text.split('\n')[0].trim().split(/\s+/);
    if (parts[0] !== 'cpu')
        return null;

    for (i = 1; i < parts.length; i++)
        total += parseNumber(parts[i]);
    idle = parseNumber(parts[4]) + parseNumber(parts[5]);
    return { total: total, idle: idle };
}

function readMemory() {
    var text = readTextFile('/proc/meminfo');
    var lines;
    var values = {};
    var i;
    var match;
    var total;
    var available;
    var used;

    if (!text)
        return { pct: 0, used: 0, total: 0 };
    lines = text.split('\n');
    for (i = 0; i < lines.length; i++) {
        match = lines[i].match(/^([A-Za-z_()]+):\s+(\d+)/);
        if (match)
            values[match[1]] = parseNumber(match[2]) * 1024;
    }
    total = values.MemTotal || 0;
    available = values.MemAvailable || 0;
    used = Math.max(0, total - available);
    return {
        pct: total > 0 ? used * 100 / total : 0,
        used: used,
        total: total,
    };
}

function shouldCountInterface(name) {
    if (!name || name === 'lo')
        return false;
    if (name.indexOf('docker') === 0 || name.indexOf('br-') === 0)
        return false;
    if (name.indexOf('veth') === 0 || name.indexOf('virbr') === 0)
        return false;
    if (name.indexOf('tun') === 0 || name.indexOf('tap') === 0)
        return false;
    return true;
}

function readNetSnapshot() {
    var text = readTextFile('/proc/net/dev');
    var lines;
    var i;
    var line;
    var pair;
    var name;
    var fields;
    var rx = 0;
    var tx = 0;
    var names = [];

    if (!text)
        return { rx: 0, tx: 0, names: [] };
    lines = text.split('\n');
    for (i = 2; i < lines.length; i++) {
        line = lines[i].trim();
        if (!line || line.indexOf(':') < 0)
            continue;
        pair = line.split(':');
        name = pair[0].trim();
        if (!shouldCountInterface(name))
            continue;
        fields = pair[1].trim().split(/\s+/);
        rx += parseNumber(fields[0]);
        tx += parseNumber(fields[8]);
        names.push(name);
    }
    return { rx: rx, tx: tx, names: names };
}

function hasNetworkInterface(interfaceName) {
    var text = readTextFile('/proc/net/dev');
    var lines;
    var i;
    var line;
    var pair;
    var name;
    var target = String(interfaceName || '').toLowerCase();

    if (!text || !target)
        return false;
    lines = text.split('\n');
    for (i = 2; i < lines.length; i++) {
        line = lines[i].trim();
        if (!line || line.indexOf(':') < 0)
            continue;
        pair = line.split(':');
        name = pair[0].trim().toLowerCase();
        if (name === target)
            return true;
    }
    return false;
}

function readGpuBusyFromSysfs() {
    var drmDir;
    var name;
    var path;
    var text;
    var value;

    try {
        drmDir = GLib.Dir.open('/sys/class/drm', 0);
        while ((name = drmDir.read_name()) !== null) {
            if (!/^card[0-9]+$/.test(name))
                continue;
            path = '/sys/class/drm/' + name + '/device/gpu_busy_percent';
            text = readTextFile(path);
            if (text !== null) {
                value = clampPercent(text.trim());
                return { pct: value, source: path };
            }
        }
    } catch (e) {
    }
    return null;
}

function readGpuBusyFromNvidiaSmi() {
    var result;
    var ok;
    var stdout;
    var first;

    try {
        result = GLib.spawn_command_line_sync(
            'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits');
        ok = result[0];
        if (!ok)
            return null;
        stdout = ByteArray.toString(result[1]).trim();
        if (!stdout)
            return null;
        first = stdout.split('\n')[0].trim();
        return { pct: clampPercent(first), source: 'nvidia-smi' };
    } catch (e) {
        return null;
    }
}

function QuotaHaloUsageIndicator() {
    this._init();
}

QuotaHaloUsageIndicator.prototype = {
    _init: function() {
        var self = this;
        var status = readStatus();
        var copilotStatus = readCopilotStatus();

        this._timeoutId = 0;
        this._refreshTimeoutId = 0;
        this._startupRefreshTimeoutId = 0;
        this._openChangedId = 0;
        this._buttonPressId = 0;
        this._keyPressId = 0;
        this._refreshing = false;
        this._selfUpdating = false;
        this._notifiedUpdateVersion = '';
        this._notificationSources = {};
        this._lastUpdateDebugKey = '';
        this._notifiedProviderErrorKeys = {};
        this._copilotLabel = new St.Label({
            text: copilotLabelText(copilotStatus),
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-copilot-label',
        });
        this._label = new St.Label({
            text: panelLabelText(status),
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-usage-label',
        });
        this._claudeLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-claude-label',
        });
        this._weeklyPct = usedPercent(status, 'weekly_used_pct');
        this._copilotPct = copilotUsedPercent(copilotStatus);
        this._claudeWeeklyPct = claudeWeeklyUsedPercent(status);
        this._copilotWrap = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: 24,
            height: 24,
            x_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-copilot-ring-wrap',
        });
        this._copilotRing = new St.DrawingArea({
            width: 24,
            height: 24,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-copilot-ring',
        });
        this._copilotRing.connect('repaint', function(area) {
            self._drawCopilotRing(area);
        });
        this._ringWrap = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: 26,
            height: 26,
            x_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-weekly-ring-wrap',
        });
        this._weeklyRing = new St.DrawingArea({
            width: 26,
            height: 26,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-weekly-ring',
        });
        this._weeklyRing.connect('repaint', function(area) {
            self._drawWeeklyRing(area);
        });
        this._claudeWrap = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: 24,
            height: 24,
            x_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-claude-ring-wrap',
        });
        this._claudeRing = new St.DrawingArea({
            width: 24,
            height: 24,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-claude-ring',
        });
        this._claudeRing.connect('repaint', function(area) {
            self._drawClaudeRing(area);
        });
        this._box = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._box.add_style_class_name('quotahalo-usage-box');

        if (GLib.file_test(COPILOT_ICON_PATH, GLib.FileTest.EXISTS)) {
            this._copilotIcon = new St.Icon({
                gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(COPILOT_ICON_PATH) }),
                icon_size: 20,
                style_class: 'system-status-icon quotahalo-copilot-icon',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
        } else {
            this._copilotIcon = new St.Label({
                text: 'CP',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'quotahalo-copilot-badge',
            });
        }
        if (GLib.file_test(OPENAI_ICON_PATH, GLib.FileTest.EXISTS)) {
            this._icon = new St.Icon({
                gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(OPENAI_ICON_PATH) }),
                icon_size: 22,
                style_class: 'system-status-icon quotahalo-usage-icon',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
        } else {
            this._icon = new St.Label({
                text: 'GPT',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'quotahalo-usage-badge',
            });
        }
        if (GLib.file_test(CLAUDE_ICON_PATH, GLib.FileTest.EXISTS)) {
            this._claudeIcon = new St.Icon({
                gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(CLAUDE_ICON_PATH) }),
                icon_size: 20,
                style_class: 'system-status-icon quotahalo-claude-icon',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
        } else {
            this._claudeIcon = new St.Label({
                text: 'C',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'quotahalo-claude-badge',
            });
        }
        this._copilotWrap.add_child(this._copilotRing);
        this._copilotWrap.add_child(this._copilotIcon);
        this._ringWrap.add_child(this._weeklyRing);
        this._ringWrap.add_child(this._icon);
        this._claudeWrap.add_child(this._claudeRing);
        this._claudeWrap.add_child(this._claudeIcon);
        this._box.add_child(this._copilotWrap);
        this._box.add_child(this._copilotLabel);
        this._box.add_child(this._ringWrap);
        this._box.add_child(this._label);
        this._box.add_child(this._claudeWrap);
        this._box.add_child(this._claudeLabel);
        this._setCopilotLabel(copilotStatus);
        this._setCodexLabel(status);
        this._setClaudeLabel(status);

        this._button = new St.Button({
            style_class: 'panel-button',
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
            can_focus: true,
            reactive: true,
            track_hover: true,
            x_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._button.add_style_class_name('quotahalo-usage-container');
        this._button.set_child(this._box);

        this.menu = new PopupMenu.PopupMenu(this._button, 0.0, St.Side.BOTTOM);
        this.menu.actor.hide();
        if (this.menu.actor.add_style_class_name)
            this.menu.actor.add_style_class_name('quotahalo-usage-menu');
        if (this.menu.box && this.menu.box.add_style_class_name)
            this.menu.box.add_style_class_name('quotahalo-menu-content');
        Main.uiGroup.add_actor(this.menu.actor);
        this._menuManager = new PopupMenu.PopupMenuManager(this._button);
        this._menuManager.addMenu(this.menu);

        this._copilotHeader = this._addProviderHeader('Copilot', COPILOT_ICON_PATH, 'copilot');
        this._copilotItem = this._addUsageDetailRow('AI Credits', 'copilot');
        this._copilotUnavailableItem = this._addMessageItem('Copilot usage unavailable');
        this._copilotSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._copilotSeparator);

        this._codexHeader = this._addProviderHeader('Codex', OPENAI_ICON_PATH, 'openai');
        this._sessionItem = this._addUsageDetailRow('5h Session', 'openai');
        this._weeklyItem = this._addUsageDetailRow('7d Usage', 'openai');
        this._codexUnavailableItem = this._addMessageItem('Codex usage unavailable');
        this._codexSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._codexSeparator);

        this._claudeHeader = this._addProviderHeader('Claude', CLAUDE_ICON_PATH, 'claude');
        this._claudeItem = this._addUsageDetailRow('5h Session', 'claude');
        this._claudeWeeklyItem = this._addUsageDetailRow('7d Usage', 'claude');
        this._claudeUnavailableItem = this._addMessageItem('Claude usage unavailable');
        this._claudeSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._claudeSeparator);

        this._updateItem = this._addUpdateItem(function() {
            var status = readStatus();
            var update = status && status.update ? status.update : null;

            if (updateAvailable(update))
                self._requestSelfUpdate(update.latest_version);
        });

        this._actionsControl = addUsageActionsControl(this.menu, function() {
            if (!self._refreshing) {
                self._requestCopilotRefresh();
                self._requestRefresh(true);
            }
        }, function(position) {
            movePanelActor(self._button, position);
            self._writeDebug('layout');
        });
        this._refreshItem = this._actionsControl.refreshButton;

        this._openChangedId = this.menu.connect('open-state-changed', function(menu, open) {
            if (open)
                self._update();
        });
        this._buttonPressId = this._button.connect('button-press-event', function(actor, event) {
            var button = event.get_button ? event.get_button() : 0;
            if (button === 1 || button === 3) {
                self._toggleMenu();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._keyPressId = this._button.connect('key-press-event', function(actor, event) {
            var symbol = event.get_key_symbol ? event.get_key_symbol() : 0;
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_space) {
                self._toggleMenu();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._centerBox = Main.panel._centerBox;
        this._sibling = null;
        movePanelActor(this._button, panelPosition('usage'));

        Main.panel.statusArea['quotahalo-usage'] = this;
        this._writeDebug('init');
        this._update();
        this._startupRefreshTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, function() {
            self._startupRefreshTimeoutId = 0;
            self._requestRefresh(false);
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, function() {
            return self._update();
        });
        this._refreshTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, USAGE_REFRESH_SECONDS, function() {
            self._requestRefresh(false);
            return true;
        });
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, function() {
            self._writeDebug('post-init');
            return GLib.SOURCE_REMOVE;
        });
    },

    _addInfoItem: function() {
        var item = new PopupMenu.PopupMenuItem('', { reactive: false });
        this.menu.addMenuItem(item);
        return item;
    },

    _addProviderHeader: function(title, iconPath, provider) {
        var item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'quotahalo-provider-header-item',
        });
        var box = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-header',
        });
        var badge = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: 28,
            height: 28,
            x_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-badge',
        });
        var labels = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-copy',
        });
        var titleRow = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-title-row',
        });
        var titleLabel = new St.Label({
            text: title,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-title',
        });
        var titleSpacer = new St.Widget({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-title-spacer',
        });
        var metaLabel = new St.Label({
            text: '',
            x_expand: false,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-meta',
        });
        var subtitleLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-subtitle',
        });
        var icon;

        badge.add_style_class_name('quotahalo-provider-badge-' + provider);
        if (GLib.file_test(iconPath, GLib.FileTest.EXISTS)) {
            icon = new St.Icon({
                gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) }),
                icon_size: 19,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'quotahalo-provider-icon',
            });
        } else {
            icon = new St.Label({
                text: String(title).charAt(0),
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'quotahalo-provider-letter',
            });
        }
        badge.add_child(icon);
        titleRow.add_child(titleLabel);
        titleRow.add_child(titleSpacer);
        titleRow.add_child(metaLabel);
        labels.add_child(titleRow);
        labels.add_child(subtitleLabel);
        setLabelEllipsize(titleLabel);
        setLabelEllipsize(metaLabel);
        setLabelEllipsize(subtitleLabel);
        metaLabel.hide();
        subtitleLabel.hide();
        box.add_child(badge);
        box.add_child(labels);
        item.add_child(box);
        this.menu.addMenuItem(item);
        return {
            item: item,
            titleLabel: titleLabel,
            metaLabel: metaLabel,
            subtitleLabel: subtitleLabel,
        };
    },

    _addUsageDetailRow: function(title, provider) {
        var item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'quotahalo-detail-row-item',
        });
        var outer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'quotahalo-detail-row',
        });
        var top = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-detail-row-top',
        });
        var titleLabel = new St.Label({
            text: title,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-detail-title',
        });
        var valueLabel = new St.Label({
            text: '--',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-detail-value',
        });
        var bar = new St.DrawingArea({
            width: 356,
            height: 11,
            x_expand: false,
            style_class: 'quotahalo-detail-progress',
        });
        var metaLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-detail-meta',
        });
        var row = {
            item: item,
            titleLabel: titleLabel,
            valueLabel: valueLabel,
            metaLabel: metaLabel,
            bar: bar,
            provider: provider,
            pct: 0,
            segments: [],
        };

        setLabelEllipsize(titleLabel);
        setLabelEllipsize(valueLabel);
        setLabelEllipsize(metaLabel);
        bar.connect('repaint', function(area) {
            drawProgressBar(area, row.pct, provider, row.segments);
        });
        top.add_child(titleLabel);
        top.add_child(valueLabel);
        outer.add_child(top);
        outer.add_child(bar);
        outer.add_child(metaLabel);
        item.add_child(outer);
        this.menu.addMenuItem(item);
        return row;
    },

    _addMessageItem: function(text) {
        var item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'quotahalo-message-item',
        });
        var label = new St.Label({
            text: text,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-message-label',
        });

        setLabelEllipsize(label);
        item.add_child(label);
        this.menu.addMenuItem(item);
        return { item: item, label: label };
    },

    _addUpdateItem: function(callback) {
        var item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'quotahalo-update-item',
        });
        var row = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-update-row',
        });
        var label = new St.Label({
            text: '',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-update-label',
        });
        var button = makeActionButton('Update', 'quotahalo-update-button');
        var clickedId = 0;

        setLabelEllipsize(label);
        clickedId = button.connect('clicked', function() {
            if (callback)
                callback();
        });
        row.add_child(label);
        row.add_child(button);
        item.add_child(row);
        this.menu.addMenuItem(item);
        return {
            item: item,
            label: label,
            button: button,
            clickedId: clickedId,
        };
    },

    _addMetaItem: function(key, value) {
        var item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'quotahalo-meta-item',
        });
        var keyLabel = new St.Label({
            text: key,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-meta-key',
        });
        var valueLabel = new St.Label({
            text: value,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-meta-value',
        });

        setLabelEllipsize(keyLabel);
        setLabelEllipsize(valueLabel);
        item.add_child(keyLabel);
        item.add_child(valueLabel);
        this.menu.addMenuItem(item);
        return {
            item: item,
            keyLabel: keyLabel,
            valueLabel: valueLabel,
        };
    },

    _toggleMenu: function() {
        this._update();
        if (this.menu.isOpen)
            this.menu.close();
        else
            this.menu.open();
    },

    _setCopilotLabel: function(status) {
        var text = copilotLabelText(status);

        this._copilotLabel.set_text(text);
        if (text) {
            this._copilotWrap.show();
            this._copilotLabel.show();
        } else {
            this._copilotWrap.hide();
            this._copilotLabel.hide();
        }
    },

    _setCopilotDetails: function(status, forceNotify) {
        var used;
        var today;
        var limit;
        var remaining;
        var unit;
        var segments;
        var modelsText;
        var metaText;

        if (!hasCopilotProvider(status)) {
            setItemVisible(this._copilotHeader.item, false);
            setItemVisible(this._copilotItem.item, false);
            setItemVisible(this._copilotUnavailableItem.item, false);
            return false;
        }

        setItemVisible(this._copilotHeader.item, true);
        this._setProviderHeaderLines(
            this._copilotHeader,
            providerHeaderMetaText(status, 'copilot'),
            '');

        if (status.state === 'error' || status.pct_used === undefined || status.pct_used === null) {
            setItemVisible(this._copilotItem.item, false);
            setItemVisible(this._copilotUnavailableItem.item, true);
            this._copilotUnavailableItem.label.set_text(unavailableDetailText(status));
            this._notifyProviderError('Copilot', status, forceNotify);
            return true;
        }

        used = status.usage_used !== undefined ? status.usage_used : status.requests_used;
        today = status.usage_used_today !== undefined ?
            status.usage_used_today : status.requests_used_today;
        limit = status.limit;
        remaining = status.usage_remaining !== undefined ?
            status.usage_remaining : status.remaining_requests;
        unit = copilotUnitText(status);
        segments = copilotModelSegments(status);
        modelsText = copilotModelBreakdownText(segments);
        metaText = usageNumberText(used, status) + '/' + usageNumberText(limit, status) +
            ' ' + unit;
        if (modelsText)
            metaText += '  ·  ' + modelsText;
        else
            metaText += '  ·  today ' + usageNumberText(today, status) +
                '  ·  left ' + usageNumberText(remaining, status);

        setItemVisible(this._copilotItem.item, true);
        setItemVisible(this._copilotUnavailableItem.item, false);
        this._setPlainUsageDetailRow(
            this._copilotItem,
            status.pct_used,
            String(Math.round(clampPercent(status.pct_remaining))) + '% remaining',
            metaText,
            segments);
        return true;
    },

    _setCodexLabel: function(status) {
        var text = codexLabelText(status);

        this._label.set_text(text);
        if (text) {
            this._ringWrap.show();
            this._label.show();
        } else {
            this._ringWrap.hide();
            this._label.hide();
        }
    },

    _setCodexDetails: function(status, forceNotify) {
        if (!hasCodexProvider(status)) {
            setItemVisible(this._codexHeader.item, false);
            setItemVisible(this._sessionItem.item, false);
            setItemVisible(this._weeklyItem.item, false);
            setItemVisible(this._codexUnavailableItem.item, false);
            return false;
        }

        setItemVisible(this._codexHeader.item, true);
        this._setProviderHeaderLines(
            this._codexHeader,
            providerHeaderMetaText(status, 'codex'),
            '');

        if (!hasCodexQuota(status)) {
            setItemVisible(this._sessionItem.item, false);
            setItemVisible(this._weeklyItem.item, false);
            setItemVisible(this._codexUnavailableItem.item, true);
            this._codexUnavailableItem.label.set_text(unavailableDetailText(status));
            this._notifyProviderError('Codex', status, forceNotify);
            return true;
        }

        setItemVisible(this._sessionItem.item, true);
        setItemVisible(this._weeklyItem.item, true);
        setItemVisible(this._codexUnavailableItem.item, false);
        this._setUsageDetailRow(
            this._sessionItem,
            status,
            'session_used_pct',
            'session_remaining_pct',
            status.session_reset,
            true);
        this._setUsageDetailRow(
            this._weeklyItem,
            status,
            'weekly_used_pct',
            'weekly_remaining_pct',
            status.weekly_reset,
            true);
        return true;
    },

    _setClaudeLabel: function(status) {
        var text = claudeLabelText(status);

        this._claudeLabel.set_text(text);
        if (text) {
            this._claudeWrap.show();
            this._claudeLabel.show();
        } else {
            this._claudeWrap.hide();
            this._claudeLabel.hide();
        }
    },

    _setClaudeDetails: function(status, forceNotify) {
        var claude = status && status.claude ? status.claude : null;

        if (!hasClaudeProvider(status)) {
            setItemVisible(this._claudeHeader.item, false);
            setItemVisible(this._claudeItem.item, false);
            setItemVisible(this._claudeWeeklyItem.item, false);
            setItemVisible(this._claudeUnavailableItem.item, false);
            return false;
        }
        setItemVisible(this._claudeHeader.item, true);
        this._setProviderHeaderLines(
            this._claudeHeader,
            providerHeaderMetaText(claude, 'claude'),
            '');
        if (!hasClaudeQuota(claude)) {
            setItemVisible(this._claudeItem.item, false);
            setItemVisible(this._claudeWeeklyItem.item, false);
            setItemVisible(this._claudeUnavailableItem.item, true);
            this._claudeUnavailableItem.label.set_text(unavailableDetailText(claude));
            this._notifyProviderError('Claude', claude, forceNotify);
            return true;
        }
        setItemVisible(this._claudeItem.item, true);
        setItemVisible(this._claudeWeeklyItem.item, true);
        setItemVisible(this._claudeUnavailableItem.item, false);
        this._setUsageDetailRow(
            this._claudeItem,
            claude,
            'session_used_pct',
            'session_remaining_pct',
            claude.session_reset,
            true);
        this._setUsageDetailRow(
            this._claudeWeeklyItem,
            claude,
            'weekly_used_pct',
            'weekly_remaining_pct',
            claude.weekly_reset,
            true);
        this._notifyProviderError('Claude', claude, forceNotify);
        return true;
    },

    _notifyProviderError: function(providerName, status, forceNotify) {
        var error = statusErrorText(status);
        var key;

        if (!error)
            return;
        key = String(providerName) + ':' + error;
        if (!forceNotify && this._notifiedProviderErrorKeys[key])
            return;
        this._notifiedProviderErrorKeys[key] = true;
        this._showPersistentNotification(
            'QuotaHalo ' + providerName,
            friendlyErrorText(error, providerName),
            null,
            null,
            providerIconPath(providerName));
    },

    _notifyRefreshFailure: function(message) {
        this._showPersistentNotification(
            'QuotaHalo refresh failed',
            friendlyErrorText(message, 'QuotaHalo'));
    },

    _ensureNotificationSource: function(sourceName, iconPath) {
        var key = String(sourceName || 'QuotaHalo');
        var source;

        if (!this._notificationSources)
            this._notificationSources = {};
        if (!this._notificationSources[key]) {
            source = new MessageTray.Source(key);
            if (iconPath && GLib.file_test(iconPath, GLib.FileTest.EXISTS)) {
                source.createIcon = function(size) {
                    return new St.Icon({
                        gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) }),
                        icon_size: size || 24,
                    });
                };
            }
            Main.messageTray.add(source);
            this._notificationSources[key] = source;
        }
        return this._notificationSources[key];
    },

    _showPersistentNotification: function(title, body, actionLabel, actionCallback, iconPath) {
        var source;
        var notification;

        try {
            source = this._ensureNotificationSource(title, iconPath);
            notification = new MessageTray.Notification(source, title, body);
            if (notification.setTransient)
                notification.setTransient(false);
            if (notification.setResident)
                notification.setResident(true);
            if (actionLabel && actionCallback && notification.addAction)
                notification.addAction(actionLabel, actionCallback);
            source.showNotification(notification);
        } catch (e) {
            try {
                Main.notify(title, body);
            } catch (notifyError) {
                log('quotahalo notification failed: ' + notifyError);
            }
        }
    },

    _setUpdateDetails: function(status) {
        var update = status && status.update ? status.update : null;
        var text = updateReminderText(update);

        if (!text) {
            setItemVisible(this._updateItem.item, false);
            return false;
        }
        this._updateItem.label.set_text(text);
        setButtonLabel(this._updateItem.button, this._selfUpdating ? 'Updating' : 'Update');
        setButtonEnabled(this._updateItem.button, !this._selfUpdating);
        setItemVisible(this._updateItem.item, true);
        return true;
    },

    _maybeNotifyUpdate: function(update, forceNotify) {
        var version;
        var dismissed;

        if (!updateAvailable(update))
            return;
        version = String(update.latest_version);
        dismissed = readDismissedUpdateVersion();
        if (dismissed === version)
            return;
        if (!forceNotify && this._notifiedUpdateVersion === version)
            return;
        this._notifiedUpdateVersion = version;
        this._showUpdateNotification(update);
    },

    _showUpdateNotification: function(update) {
        var version = String(update.latest_version);
        var title = 'QuotaHalo ' + version + ' is available';
        var body = updateChangelogText(update, 5) || 'A new GitHub tag is available.';

        this._showPersistentNotification(
            title,
            body,
            'Do not remind ' + version,
            function() {
                writeDismissedUpdateVersion(version);
            });
    },

    _writeUpdateDebug: function(update, showUpdate, showCopilot, showCodex, showClaude, footerVisible, forceNotify) {
        var info = {
            currentVersion: update && update.current_version ? String(update.current_version) : '',
            latestVersion: update && update.latest_version ? String(update.latest_version) : '',
            available: updateAvailable(update),
            dismissedVersion: readDismissedUpdateVersion(),
            notifiedVersion: this._notifiedUpdateVersion || '',
            showUpdate: !!showUpdate,
            showCopilot: !!showCopilot,
            showCodex: !!showCodex,
            showClaude: !!showClaude,
            footerVisible: !!footerVisible,
            forceNotify: !!forceNotify,
        };
        var key = JSON.stringify(info);

        if (key === this._lastUpdateDebugKey)
            return;
        this._lastUpdateDebugKey = key;
        writeUpdateUiDebug({
            reason: 'update',
            update: info,
        });
    },

    _setProviderHeaderLines: function(header, metaText, subtitleText) {
        metaText = metaText || '';
        subtitleText = subtitleText || '';
        header.metaLabel.set_text(metaText);
        header.subtitleLabel.set_text(subtitleText);
        setItemVisible(header.metaLabel, metaText.length > 0);
        setItemVisible(header.subtitleLabel, subtitleText.length > 0);
    },

    _setUsageDetailRow: function(row, status, usedKey, remainingKey, resetValue, available) {
        var remaining;
        var meta = [];

        if (!available) {
            row.pct = 0;
            row.segments = [];
            row.valueLabel.set_text('--');
            row.metaLabel.set_text('Usage unavailable');
            if (row.bar.queue_repaint)
                row.bar.queue_repaint();
            return;
        }

        row.pct = usedPercent(status, usedKey);
        row.segments = [];
        row.valueLabel.set_text(String(Math.round(row.pct)) + '%');
        remaining = remainingPercent(status, usedKey, remainingKey);
        if (remaining !== null)
            meta.push(String(remaining) + '% remaining');
        meta.push('resets ' + resetTextFor(status, usedKey, resetValue));
        row.metaLabel.set_text(meta.join('  ·  '));
        if (row.bar.queue_repaint)
            row.bar.queue_repaint();
    },

    _setPlainUsageDetailRow: function(row, pct, remainingText, metaText, segments) {
        row.pct = clampPercent(pct);
        row.segments = segments || [];
        row.valueLabel.set_text(String(Math.round(row.pct)) + '%');
        row.metaLabel.set_text(remainingText + '  ·  ' + metaText);
        if (row.bar.queue_repaint)
            row.bar.queue_repaint();
    },

    _drawCopilotRing: function(area) {
        this._drawUsageRing(area, this._copilotPct, 'copilot');
    },

    _drawWeeklyRing: function(area) {
        this._drawUsageRing(area, this._weeklyPct, 'openai');
    },

    _drawClaudeRing: function(area) {
        this._drawUsageRing(area, this._claudeWeeklyPct, 'claude');
    },

    _drawUsageRing: function(area, pctValue, provider) {
        var alloc = area.get_allocation_box();
        var width = alloc.x2 - alloc.x1;
        var height = alloc.y2 - alloc.y1;
        var size = Math.min(width, height);
        var radius = Math.max(1, size / 2 - 1.8);
        var cx = width / 2;
        var cy = height / 2;
        var pct = clampPercent(pctValue);
        var color = usageRingColor(pct, provider);
        var cr = area.get_context();

        cr.setLineWidth(2.0);
        cr.setLineCap(Cairo.LineCap.ROUND);

        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.18);
        cr.arc(cx, cy, radius, 0, Math.PI * 2);
        cr.stroke();

        if (pct > 0) {
            cr.setSourceRGBA(color[0], color[1], color[2], color[3]);
            cr.arc(
                cx,
                cy,
                radius,
                -Math.PI / 2,
                -Math.PI / 2 + Math.PI * 2 * pct / 100);
            cr.stroke();
        }

        cr.$dispose();
    },

    _writeDebug: function(reason) {
        var parent = this._button.get_parent ? this._button.get_parent() : null;
        var leftSiblings = Main.panel._leftBox && Main.panel._leftBox.get_children ?
            Main.panel._leftBox.get_children() : [];
        var siblings = this._centerBox && this._centerBox.get_children ? this._centerBox.get_children() : [];
        var rightSiblings = Main.panel._rightBox && Main.panel._rightBox.get_children ?
            Main.panel._rightBox.get_children() : [];
        writeDebug({
            reason: reason,
            button: actorSummary(this._button),
            buttonParent: actorSummary(parent),
            leftBox: actorSummary(Main.panel._leftBox),
            centerBox: actorSummary(Main.panel._centerBox),
            rightBox: actorSummary(Main.panel._rightBox),
            sibling: actorSummary(this._sibling),
            leftChildren: leftSiblings.map(actorSummary),
            centerChildren: siblings.map(actorSummary),
            rightChildren: rightSiblings.map(actorSummary),
        });
    },

    _requestRefresh: function(manual) {
        var self = this;
        var proc;
        var startedAt = new Date().toISOString();
        var command;

        manual = manual !== false;
        if (this._refreshing)
            return;
        command = manual
            ? [PYTHON_PATH, SCRIPT_PATH, '--refresh-once', '--force']
            : [PYTHON_PATH, SCRIPT_PATH, '--refresh-once'];

        this._refreshing = true;
        writeRefreshDebug({
            state: 'started',
            manual: manual,
            startedAt: startedAt,
            command: command,
        });
        if (manual)
            setButtonEnabled(this._refreshItem, false);
        if (manual)
            setButtonLabel(this._refreshItem, 'Refreshing...');

        try {
            proc = Gio.Subprocess.new(
                command,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            proc.communicate_utf8_async(null, null, function(subprocess, res) {
                var ok = false;
                var stdout = '';
                var stderr = '';
                var errorText = null;
                try {
                    var result = subprocess.communicate_utf8_finish(res);
                    ok = result[0] && subprocess.get_successful();
                    stdout = result[1] || '';
                    stderr = result[2] || '';
                } catch (e) {
                    errorText = String(e);
                    log('quotahalo-usage refresh failed: ' + e);
                }
                writeRefreshDebug({
                    state: ok ? 'finished' : 'failed',
                    manual: manual,
                    startedAt: startedAt,
                    finishedAt: new Date().toISOString(),
                    successful: ok,
                    exitStatus: subprocess.get_exit_status ? subprocess.get_exit_status() : null,
                    error: errorText,
                    stdoutTail: stdout.slice(-4000),
                    stderrTail: stderr.slice(-4000),
                });
                if (manual && !ok)
                    self._notifyRefreshFailure(errorText || stderr || stdout);
                self._refreshing = false;
                if (manual)
                    setButtonEnabled(self._refreshItem, true);
                if (manual)
                    setButtonLabel(self._refreshItem, 'Refresh now');
                self._update(manual);
            });
        } catch (e) {
            log('quotahalo-usage refresh spawn failed: ' + e);
            writeRefreshDebug({
                state: 'spawn-failed',
                manual: manual,
                startedAt: startedAt,
                finishedAt: new Date().toISOString(),
                error: String(e),
            });
            this._refreshing = false;
            if (manual)
                setButtonEnabled(this._refreshItem, true);
            if (manual)
                setButtonLabel(this._refreshItem, 'Refresh now');
            if (manual)
                this._notifyRefreshFailure(e);
        }
    },

    _requestCopilotRefresh: function() {
        var self = this;
        var proc;

        try {
            proc = Gio.Subprocess.new(
                [PYTHON_PATH, COPILOT_SCRIPT_PATH, '--once'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            proc.communicate_utf8_async(null, null, function(subprocess, res) {
                try {
                    subprocess.communicate_utf8_finish(res);
                } catch (e) {
                    log('quotahalo copilot refresh failed: ' + e);
                }
                self._update();
            });
        } catch (e) {
            log('quotahalo copilot refresh spawn failed: ' + e);
        }
    },

    _requestSelfUpdate: function(version) {
        var self = this;
        var proc;
        var command;

        version = String(version || '').trim();
        if (!version || this._selfUpdating)
            return;
        command = [PYTHON_PATH, SCRIPT_PATH, '--self-update', version];
        this._selfUpdating = true;
        setButtonLabel(this._updateItem.button, 'Updating');
        setButtonEnabled(this._updateItem.button, false);
        try {
            proc = Gio.Subprocess.new(
                command,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            proc.communicate_utf8_async(null, null, function(subprocess, res) {
                var stdout = '';
                var stderr = '';
                var ok = false;
                var payload = null;
                var message;

                try {
                    var result = subprocess.communicate_utf8_finish(res);
                    ok = result[0] && subprocess.get_successful();
                    stdout = result[1] || '';
                    stderr = result[2] || '';
                    try {
                        payload = JSON.parse(stdout);
                    } catch (parseError) {
                        payload = null;
                    }
                    if (ok && payload && payload.ok) {
                        message = payload.message || ('Updated to ' + version);
                        Main.notify('QuotaHalo update complete', message);
                    } else {
                        message = (payload && payload.error) || stderr || stdout || 'Update failed';
                        Main.notify('QuotaHalo update failed', message);
                    }
                } catch (e) {
                    log('quotahalo self update failed: ' + e);
                    Main.notify('QuotaHalo update failed', String(e));
                }
                self._selfUpdating = false;
                setButtonLabel(self._updateItem.button, 'Update');
                setButtonEnabled(self._updateItem.button, true);
                self._update();
            });
        } catch (e) {
            this._selfUpdating = false;
            setButtonLabel(this._updateItem.button, 'Update');
            setButtonEnabled(this._updateItem.button, true);
            Main.notify('QuotaHalo update failed', String(e));
        }
    },

    _update: function(forceNotify) {
        var status = readStatus();
        var copilotStatus = readCopilotStatus();
        var showCopilot;
        var showCodex;
        var showClaude;
        var showUpdate;
        var footerVisible;

        this._setCopilotLabel(copilotStatus);
        this._setCodexLabel(status);
        this._setClaudeLabel(status);
        this._copilotPct = copilotUsedPercent(copilotStatus);
        this._weeklyPct = usedPercent(status, 'weekly_used_pct');
        this._claudeWeeklyPct = claudeWeeklyUsedPercent(status);
        if (this._copilotRing.queue_repaint)
            this._copilotRing.queue_repaint();
        if (this._weeklyRing.queue_repaint)
            this._weeklyRing.queue_repaint();
        if (this._claudeRing.queue_repaint)
            this._claudeRing.queue_repaint();

        showCopilot = this._setCopilotDetails(copilotStatus, !!forceNotify);
        showCodex = this._setCodexDetails(status, !!forceNotify);
        showClaude = this._setClaudeDetails(status, !!forceNotify);
        showUpdate = this._setUpdateDetails(status);
        this._maybeNotifyUpdate(status.update, !!forceNotify);
        footerVisible = showCopilot || showCodex || showClaude || showUpdate;
        setItemVisible(this._updateItem.item, showUpdate);
        this._writeUpdateDebug(
            status.update,
            showUpdate,
            showCopilot,
            showCodex,
            showClaude,
            footerVisible,
            !!forceNotify);

        if (footerVisible)
            this._button.show();
        else
            this._button.hide();

        setItemVisible(this._copilotSeparator, showCopilot);
        setItemVisible(this._codexSeparator, showCodex);
        setItemVisible(this._claudeSeparator, showClaude);
        setItemVisible(this._actionsControl.item, footerVisible);
        this._actionsControl.render(panelPosition('usage'));

        if (!this._refreshing)
            setButtonLabel(this._refreshItem, 'Refresh now');
        return true;
    },

    destroy: function() {
        if (Main.panel.statusArea['quotahalo-usage'] === this)
            delete Main.panel.statusArea['quotahalo-usage'];
        if (this._actionsControl) {
            if (this._actionsControl.refreshClickedId) {
                this._actionsControl.refreshButton.disconnect(this._actionsControl.refreshClickedId);
                this._actionsControl.refreshClickedId = 0;
            }
            if (this._actionsControl.positionClickedId) {
                this._actionsControl.positionButton.disconnect(this._actionsControl.positionClickedId);
                this._actionsControl.positionClickedId = 0;
            }
        }
        if (this._keyPressId) {
            this._button.disconnect(this._keyPressId);
            this._keyPressId = 0;
        }
        if (this._buttonPressId) {
            this._button.disconnect(this._buttonPressId);
            this._buttonPressId = 0;
        }
        if (this._openChangedId) {
            this.menu.disconnect(this._openChangedId);
            this._openChangedId = 0;
        }
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._refreshTimeoutId) {
            GLib.Source.remove(this._refreshTimeoutId);
            this._refreshTimeoutId = 0;
        }
        if (this._startupRefreshTimeoutId) {
            GLib.Source.remove(this._startupRefreshTimeoutId);
            this._startupRefreshTimeoutId = 0;
        }
        if (this._updateItem && this._updateItem.clickedId) {
            this._updateItem.button.disconnect(this._updateItem.clickedId);
            this._updateItem.clickedId = 0;
        }
        if (this._notificationSources) {
            for (var key in this._notificationSources) {
                if (this._notificationSources[key])
                    this._notificationSources[key].destroy();
            }
            this._notificationSources = {};
        }
        if (this.menu) {
            this.menu.destroy();
            this.menu = null;
        }
        this._button.destroy();
    },
};

function QuotaHaloSystemIndicator() {
    this._init();
}

QuotaHaloSystemIndicator.prototype = {
    _init: function() {
        var self = this;

        this._timeoutId = 0;
        this._flclashTimeoutId = 0;
        this._buttonPressId = 0;
        this._keyPressId = 0;
        this._openChangedId = 0;
        this._prevCpu = null;
        this._prevNet = null;
        this._gpuCache = { pct: 0, source: 'unknown', at: 0 };
        this._ifaces = [];
        this._flclashInfo = null;
        this._flclashError = null;
        this._flclashInfoLoading = false;
        this._flclashAvailable = false;
        this._flclashProxy = null;
        this._lastNet = null;

        this._box = new St.BoxLayout({
            style_class: 'quotahalo-system-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._cpuValue = this._addSegment('CPU');
        this._memValue = this._addSegment('MEM');
        this._gpuValue = this._addSegment('GPU');
        this._netValue = new St.Label({
            text: '↓0B ↑0B',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-system-net',
        });
        this._box.add_child(this._netValue);

        this._button = new St.Button({
            style_class: 'panel-button quotahalo-system-container',
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
            can_focus: true,
            reactive: true,
            track_hover: true,
            x_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._button.set_child(this._box);

        this.menu = new PopupMenu.PopupMenu(this._button, 0.0, St.Side.BOTTOM);
        this.menu.actor.hide();
        if (this.menu.actor.add_style_class_name)
            this.menu.actor.add_style_class_name('quotahalo-system-menu');
        if (this.menu.box && this.menu.box.add_style_class_name)
            this.menu.box.add_style_class_name('quotahalo-menu-content');
        Main.uiGroup.add_actor(this.menu.actor);
        this._menuManager = new PopupMenu.PopupMenuManager(this._button);
        this._menuManager.addMenu(this.menu);

        this._systemHeader = this._addSystemHeader();
        this._cpuItem = this._addMetricDetailRow('CPU', 'openai');
        this._memItem = this._addMetricDetailRow('Memory', 'openai');
        this._gpuItem = this._addMetricDetailRow('GPU', 'openai');
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._netItem = this._addSystemMetaItem('Network', '--');
        this._ifaceItem = this._addSystemMetaItem('Interfaces', '--');
        this._flclashSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._flclashSeparator);
        this._flclashIpItem = this._addSystemMetaItem('Public IP', '--');
        this._flclashLocationItem = this._addSystemMetaItem('Location', '--');
        this._flclashOrgItem = this._addSystemMetaItem('Org', '--');
        this._flclashHostItem = this._addSystemMetaItem('Host', '--');
        this._flclashTzItem = this._addSystemMetaItem('Timezone', '--');
        this._layoutSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._layoutSeparator);
        this._positionControl = addPanelPositionControl(this.menu, 'system', function(position) {
            movePanelActor(self._button, position);
        });
        this._renderFlClashInfo();

        this._openChangedId = this.menu.connect('open-state-changed', function(menu, open) {
            if (open) {
                self._update();
                self._loadFlClashInfo(false);
            }
        });
        this._buttonPressId = this._button.connect('button-press-event', function(actor, event) {
            var button = event.get_button ? event.get_button() : 0;
            if (button === 1 || button === 3) {
                self._toggleMenu();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._keyPressId = this._button.connect('key-press-event', function(actor, event) {
            var symbol = event.get_key_symbol ? event.get_key_symbol() : 0;
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_space) {
                self._toggleMenu();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        movePanelActor(this._button, panelPosition('system'));

        Main.panel.statusArea['quotahalo-system'] = this;
        this._update();
        this._loadFlClashInfo(true);
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            SYSTEM_UPDATE_SECONDS,
            function() {
                return self._update();
            });
        this._flclashTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            PROXY_UPDATE_SECONDS,
            function() {
                self._loadFlClashInfo(false);
                return true;
            });
    },

    _addSegment: function(key) {
        var box = new St.BoxLayout({
            style_class: 'quotahalo-system-segment',
            y_align: Clutter.ActorAlign.CENTER,
        });
        var keyLabel = new St.Label({
            text: key,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-system-key',
        });
        var valueLabel = new St.Label({
            text: '--%',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-system-value',
        });
        box.add_child(keyLabel);
        box.add_child(valueLabel);
        this._box.add_child(box);
        valueLabel.segment = box;
        return valueLabel;
    },

    _addSystemHeader: function() {
        var item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'quotahalo-provider-header-item',
        });
        var box = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-header',
        });
        var badge = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: 28,
            height: 28,
            x_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-badge',
        });
        var icon = new St.Icon({
            icon_name: 'utilities-system-monitor-symbolic',
            icon_size: 17,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-icon',
        });
        var labels = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-copy',
        });
        var titleLabel = new St.Label({
            text: 'System',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-title',
        });
        var subtitleLabel = new St.Label({
            text: 'Live every ' + String(SYSTEM_UPDATE_SECONDS) + 's',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-provider-subtitle',
        });

        badge.add_style_class_name('quotahalo-system-badge');
        badge.add_child(icon);
        labels.add_child(titleLabel);
        labels.add_child(subtitleLabel);
        box.add_child(badge);
        box.add_child(labels);
        item.add_child(box);
        this.menu.addMenuItem(item);
        return {
            item: item,
            subtitleLabel: subtitleLabel,
        };
    },

    _addMetricDetailRow: function(title, provider) {
        var item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'quotahalo-detail-row-item',
        });
        var outer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'quotahalo-detail-row',
        });
        var top = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-detail-row-top',
        });
        var titleLabel = new St.Label({
            text: title,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-detail-title',
        });
        var valueLabel = new St.Label({
            text: '--',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-detail-value',
        });
        var bar = new St.DrawingArea({
            width: 356,
            height: 11,
            x_expand: false,
            style_class: 'quotahalo-detail-progress',
        });
        var metaLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-detail-meta',
        });
        var row = {
            item: item,
            valueLabel: valueLabel,
            metaLabel: metaLabel,
            bar: bar,
            provider: provider,
            pct: 0,
        };

        bar.connect('repaint', function(area) {
            drawProgressBar(area, row.pct, provider);
        });
        top.add_child(titleLabel);
        top.add_child(valueLabel);
        outer.add_child(top);
        outer.add_child(bar);
        outer.add_child(metaLabel);
        item.add_child(outer);
        this.menu.addMenuItem(item);
        return row;
    },

    _addSystemMetaItem: function(key, value) {
        var item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'quotahalo-meta-item',
        });
        var keyLabel = new St.Label({
            text: key,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-meta-key',
        });
        var valueLabel = new St.Label({
            text: value,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'quotahalo-meta-value',
        });

        item.add_child(keyLabel);
        item.add_child(valueLabel);
        this.menu.addMenuItem(item);
        return {
            item: item,
            keyLabel: keyLabel,
            valueLabel: valueLabel,
        };
    },

    _setMetricDetailRow: function(row, pct, valueText, metaText) {
        row.pct = clampPercent(pct);
        row.valueLabel.set_text(valueText);
        row.metaLabel.set_text(metaText);
        if (row.bar.queue_repaint)
            row.bar.queue_repaint();
    },

    _addInfoItem: function() {
        var item = new PopupMenu.PopupMenuItem('', { reactive: false });
        this.menu.addMenuItem(item);
        return item;
    },

    _toggleMenu: function() {
        this._update();
        if (this.menu.isOpen)
            this.menu.close();
        else {
            this.menu.open();
            this._loadFlClashInfo(false);
        }
    },

    _readCpuPercent: function() {
        var current = readCpuSnapshot();
        var prev = this._prevCpu;
        var totalDelta;
        var idleDelta;
        var pct = 0;

        this._prevCpu = current;
        if (!current || !prev)
            return 0;
        totalDelta = current.total - prev.total;
        idleDelta = current.idle - prev.idle;
        if (totalDelta <= 0)
            return 0;
        pct = (totalDelta - idleDelta) * 100 / totalDelta;
        return pct;
    },

    _readNetworkRates: function() {
        var current = readNetSnapshot();
        var prev = this._prevNet;
        var now = GLib.get_monotonic_time();
        var seconds;
        var rxRate = 0;
        var txRate = 0;

        this._prevNet = {
            rx: current.rx,
            tx: current.tx,
            names: current.names,
            at: now,
        };
        this._ifaces = current.names;
        if (!prev)
            return { rxRate: 0, txRate: 0 };
        seconds = Math.max(0.001, (now - prev.at) / 1000000);
        rxRate = Math.max(0, (current.rx - prev.rx) / seconds);
        txRate = Math.max(0, (current.tx - prev.tx) / seconds);
        return { rxRate: rxRate, txRate: txRate };
    },

    _readGpuPercent: function() {
        var now = GLib.get_monotonic_time();
        var gpu;

        if (this._gpuCache.at && now - this._gpuCache.at < GPU_CACHE_USEC)
            return this._gpuCache;
        gpu = readGpuBusyFromSysfs() || readGpuBusyFromNvidiaSmi() || {
            pct: 0,
            source: 'unavailable',
        };
        gpu.at = now;
        this._gpuCache = gpu;
        return gpu;
    },

    _locationText: function(info) {
        var parts = [];

        if (!info)
            return '--';
        if (info.city)
            parts.push(info.city);
        if (info.region)
            parts.push(info.region);
        if (info.country)
            parts.push(info.country);
        if (info.loc)
            parts.push(info.loc);
        return parts.length ? parts.join(', ') : '--';
    },

    _countryCode: function() {
        var info = this._flclashInfo;
        var code;

        if (!info || !info.country)
            return '--';
        code = String(info.country).trim().toUpperCase();
        if (!code.match(/^[A-Z][A-Z]$/))
            return '--';
        return code;
    },

    _countryFlag: function(code) {
        var base = 0x1F1E6;

        if (!code || code === '--')
            return '';
        try {
            return String.fromCodePoint(
                base + code.charCodeAt(0) - 65,
                base + code.charCodeAt(1) - 65);
        } catch (e) {
            return '';
        }
    },

    _flclashBadgeText: function() {
        var code = this._countryCode();
        var flag = this._countryFlag(code);

        if (code === '--')
            return '--';
        return (flag ? flag + ' ' : '') + code;
    },

    _proxyText: function() {
        if (!this._flclashProxy)
            return 'detecting public IP';
        if (this._flclashProxy.direct)
            return this._flclashProxy.name;
        return this._flclashProxy.name + ' ' + this._flclashProxy.url;
    },

    _setFlClashItemsVisible: function(visible) {
        var items = [
            this._flclashSeparator,
            this._flclashIpItem,
            this._flclashLocationItem,
            this._flclashOrgItem,
            this._flclashHostItem,
            this._flclashTzItem,
        ];
        var i;

        for (i = 0; i < items.length; i++) {
            if (!items[i])
                continue;
            if (items[i].item)
                setItemVisible(items[i].item, visible);
            else
                setItemVisible(items[i], visible);
        }
    },

    _detectFlClash: function() {
        return this._flclashAvailable;
    },

    _updateNetworkLabel: function(net) {
        var badge = this._flclashAvailable ? this._flclashBadgeText() : '';
        var prefix;

        net = net || this._lastNet || { rxRate: 0, txRate: 0 };
        if (badge === '--')
            badge = '';
        prefix = badge ? badge + ' ' : '';
        this._netValue.set_text(
            prefix +
            '↓' + formatRate(net.rxRate) +
            ' ↑' + formatRate(net.txRate));
    },

    _renderFlClashInfo: function() {
        var info = this._flclashInfo;
        var proxyText = this._proxyText();

        if (!this._flclashAvailable && !this._flclashInfoLoading) {
            this._setFlClashItemsVisible(false);
            this._updateNetworkLabel();
            return;
        }
        this._setFlClashItemsVisible(true);
        this._updateNetworkLabel();
        if (this._flclashInfoLoading) {
            this._flclashIpItem.valueLabel.set_text('loading ipinfo.io...');
            this._flclashLocationItem.valueLabel.set_text(proxyText);
            this._flclashOrgItem.valueLabel.set_text('--');
            this._flclashHostItem.valueLabel.set_text('--');
            this._flclashTzItem.valueLabel.set_text('--');
            return;
        }
        if (this._flclashError) {
            this._flclashIpItem.valueLabel.set_text('unavailable');
            this._flclashLocationItem.valueLabel.set_text(proxyText);
            this._flclashOrgItem.valueLabel.set_text(String(this._flclashError));
            this._flclashHostItem.valueLabel.set_text('--');
            this._flclashTzItem.valueLabel.set_text('--');
            return;
        }
        if (!info) {
            this._flclashIpItem.valueLabel.set_text('click to load');
            this._flclashLocationItem.valueLabel.set_text(proxyText);
            this._flclashOrgItem.valueLabel.set_text('--');
            this._flclashHostItem.valueLabel.set_text('--');
            this._flclashTzItem.valueLabel.set_text('--');
            return;
        }

        this._flclashIpItem.valueLabel.set_text(info.ip || '--');
        this._flclashLocationItem.valueLabel.set_text(this._locationText(info));
        this._flclashOrgItem.valueLabel.set_text(info.org || '--');
        this._flclashHostItem.valueLabel.set_text(info.hostname || '--');
        this._flclashTzItem.valueLabel.set_text(info.timezone || '--');
    },

    _loadFlClashInfo: function(showLoading) {
        if (this._flclashInfoLoading)
            return;
        this._flclashInfoLoading = true;
        this._flclashError = null;
        this._flclashAvailable = true;
        if (showLoading || !this._flclashInfo)
            this._renderFlClashInfo();
        this._loadProxyCandidate(0);
    },

    _loadProxyCandidate: function(index) {
        var self = this;
        var candidate;
        var proc;

        if (index >= PROXY_CANDIDATES.length) {
            this._flclashAvailable = false;
            this._flclashProxy = null;
            this._flclashInfo = null;
            this._flclashError = null;
            this._flclashInfoLoading = false;
            this._renderFlClashInfo();
            return;
        }
        candidate = PROXY_CANDIDATES[index];
        if (candidate.interfaceName && !hasNetworkInterface(candidate.interfaceName)) {
            this._loadProxyCandidate(index + 1);
            return;
        }
        try {
            var command;
            if (candidate.direct) {
                command = [
                    '/usr/bin/curl',
                    '-sS',
                    '--connect-timeout',
                    '2',
                    '--max-time',
                    '5',
                    '--noproxy',
                    '*',
                    PROXY_IPINFO_URL,
                ];
            } else {
                command = [
                    '/usr/bin/curl',
                    '-sS',
                    '--connect-timeout',
                    '2',
                    '--max-time',
                    '5',
                    '--proxy',
                    candidate.url,
                    PROXY_IPINFO_URL,
                ];
            }
            proc = Gio.Subprocess.new(
                command,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            proc.communicate_utf8_async(null, null, function(subprocess, res) {
                var result;
                var ok;
                var stdout;
                var stderr;
                var nextInfo;
                var currentIp;
                var nextIp;

                try {
                    result = subprocess.communicate_utf8_finish(res);
                    ok = result[0];
                    stdout = result[1] || '';
                    stderr = result[2] || '';
                    if (!ok || !subprocess.get_successful())
                        throw new Error(stderr || 'curl failed');
                    nextInfo = JSON.parse(stdout);
                    currentIp = self._flclashInfo && self._flclashInfo.ip ?
                        String(self._flclashInfo.ip) : '';
                    nextIp = nextInfo && nextInfo.ip ? String(nextInfo.ip) : '';
                    if (!nextIp)
                        throw new Error('ipinfo response missing ip');
                    self._flclashAvailable = true;
                    self._flclashProxy = candidate;
                    if (nextIp !== currentIp) {
                        self._flclashInfo = nextInfo;
                        self._flclashInfoLoading = false;
                        self._flclashError = null;
                        self._renderFlClashInfo();
                        return;
                    }
                    self._flclashError = null;
                    self._flclashInfoLoading = false;
                    self._renderFlClashInfo();
                } catch (e) {
                    self._loadProxyCandidate(index + 1);
                    return;
                }
            });
        } catch (e) {
            this._loadProxyCandidate(index + 1);
        }
    },

    _update: function() {
        var cpu = this._readCpuPercent();
        var mem = readMemory();
        var gpu = this._readGpuPercent();
        var net = this._readNetworkRates();
        var badge;
        var hasGpu = gpu.source !== 'unavailable';

        this._detectFlClash();
        this._cpuValue.set_text(pctText(cpu));
        this._memValue.set_text(pctText(mem.pct));
        this._gpuValue.set_text(hasGpu ? pctText(gpu.pct) : unavailablePctText());
        setItemVisible(this._gpuValue.segment, hasGpu);
        this._lastNet = net;
        this._updateNetworkLabel(net);

        badge = this._flclashAvailable ? this._flclashBadgeText() : '';
        if (badge === '--')
            badge = '';
        this._systemHeader.subtitleLabel.set_text(
            'Live every ' + String(SYSTEM_UPDATE_SECONDS) + 's' +
            (badge ? '  ·  ' + badge : ''));
        this._setMetricDetailRow(
            this._cpuItem,
            cpu,
            String(Math.round(clampPercent(cpu))) + '%',
            'Current processor load');
        this._setMetricDetailRow(
            this._memItem,
            mem.pct,
            String(Math.round(clampPercent(mem.pct))) + '%',
            formatBytes(mem.used) + ' / ' + formatBytes(mem.total));
        setItemVisible(this._gpuItem.item, hasGpu);
        this._setMetricDetailRow(
            this._gpuItem,
            hasGpu ? gpu.pct : 0,
            hasGpu ? String(Math.round(clampPercent(gpu.pct))) + '%' : '--',
            hasGpu ? gpu.source : 'Unavailable');
        this._netItem.valueLabel.set_text(
            '↓ ' + formatRate(net.rxRate) + '/s   ↑ ' + formatRate(net.txRate) + '/s');
        this._ifaceItem.valueLabel.set_text(
            this._ifaces.length ? this._ifaces.join(', ') : 'none');
        return true;
    },

    destroy: function() {
        if (Main.panel.statusArea['quotahalo-system'] === this)
            delete Main.panel.statusArea['quotahalo-system'];
        if (this._keyPressId) {
            this._button.disconnect(this._keyPressId);
            this._keyPressId = 0;
        }
        if (this._buttonPressId) {
            this._button.disconnect(this._buttonPressId);
            this._buttonPressId = 0;
        }
        if (this._openChangedId) {
            this.menu.disconnect(this._openChangedId);
            this._openChangedId = 0;
        }
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._flclashTimeoutId) {
            GLib.Source.remove(this._flclashTimeoutId);
            this._flclashTimeoutId = 0;
        }
        if (this.menu) {
            this.menu.destroy();
            this.menu = null;
        }
        this._button.destroy();
    },
};

function init() {
}

function enable() {
    usageIndicator = new QuotaHaloUsageIndicator();
    try {
        systemIndicator = new QuotaHaloSystemIndicator();
    } catch (e) {
        systemIndicator = null;
        log('quotahalo-system failed: ' + e);
    }
}

function disable() {
    if (systemIndicator) {
        systemIndicator.destroy();
        systemIndicator = null;
    }
    if (usageIndicator) {
        usageIndicator.destroy();
        usageIndicator = null;
    }
}
