import './GM_fetch.js';
import cleanLink from './link-cleaner.js';

const HOST_CLEAN_MODE_KEY = 'hostCleanMode';
const HOST_CLEAN_MODE_BLACKLIST = 'blacklist';
const HOST_CLEAN_MODE_WHITELIST = 'whitelist';
const DISABLED_HOST_KEY_PREFIX = 'disabledHost:';
const ENABLED_HOST_KEY_PREFIX = 'enabledHost:';

const getCurrentHostname = () => location.hostname.toLowerCase();

const getCurrentHostKey = prefix => {
    const hostname = getCurrentHostname();
    return hostname && prefix + hostname;
}

const getCurrentDisabledHostKey = () => getCurrentHostKey(DISABLED_HOST_KEY_PREFIX);

const getCurrentEnabledHostKey = () => getCurrentHostKey(ENABLED_HOST_KEY_PREFIX);

const getHostCleanMode = async () => {
    const mode = await GM.getValue(HOST_CLEAN_MODE_KEY, HOST_CLEAN_MODE_BLACKLIST);
    return mode === HOST_CLEAN_MODE_WHITELIST ? HOST_CLEAN_MODE_WHITELIST : HOST_CLEAN_MODE_BLACKLIST;
}

const setHostCleanMode = async mode => GM.setValue(
    HOST_CLEAN_MODE_KEY,
    mode === HOST_CLEAN_MODE_WHITELIST ? HOST_CLEAN_MODE_WHITELIST : HOST_CLEAN_MODE_BLACKLIST
);

const isCurrentHostDisabled = async () => {
    const key = getCurrentDisabledHostKey();
    return !!key && !!await GM.getValue(key, false);
}

const setCurrentHostDisabled = async disabled => {
    const key = getCurrentDisabledHostKey();
    if (!key) return false;
    await GM.setValue(key, !!disabled);
    return true;
}

const isCurrentHostEnabled = async () => {
    const key = getCurrentEnabledHostKey();
    return !!key && !!await GM.getValue(key, false);
}

const setCurrentHostEnabled = async enabled => {
    const key = getCurrentEnabledHostKey();
    if (!key) return false;
    await GM.setValue(key, !!enabled);
    return true;
}

const getCurrentHostCleanStatus = async () => {
    const hostname = getCurrentHostname();
    const mode = await getHostCleanMode();

    if (!hostname) {
        return {hostname, mode, disabled: false, enabled: false, shouldClean: true};
    }

    if (mode === HOST_CLEAN_MODE_WHITELIST) {
        const enabled = await isCurrentHostEnabled();
        return {hostname, mode, disabled: false, enabled, shouldClean: enabled};
    }

    const disabled = await isCurrentHostDisabled();
    return {hostname, mode, disabled, enabled: false, shouldClean: !disabled};
}

// 处理<a>标签

/**
 * @param {HTMLAnchorElement} e
 */
const cleanLinkForDOM = e => {
    if (!(e instanceof HTMLAnchorElement) || !e.href) return;
    return cleanLink(e.href)
        .then(t => {
            const r = t.toString()
            if (e.href === r) return;
            console.log('Link cleaner:', e, e.href, '->', (e.href = t.toString()));
        })
        .catch(err => console.warn('Link cleaner:', e, e.href, 'Failed to clean', err));
}

/**
 * @param {Node} e
 */
const cleanLinksForDOM = e => {
    if (e instanceof HTMLAnchorElement) cleanLinkForDOM(e);
    if (e instanceof Element) e.querySelectorAll('a').forEach(cleanLinkForDOM);
}

const cleanSpmAttributes = () => setTimeout(() => [
    ...document.querySelectorAll('[data-spm]'),
    ...document.querySelectorAll('[data-spm-anchor-id]'),
].forEach(e => {
    e.removeAttribute('data-spm');
    e.removeAttribute('data-spm-anchor-id');
}), 1000);

const cleanLocation = (replace = false) => cleanLink(location.href).then(e => {
    const cleaned = e.toString();
    if (cleaned === location.href) return false;
    if (replace) {
        history.replaceState(history.state, '', cleaned);
        return true;
    }
    location.href = cleaned;
    return true;
});

const setupHistoryHook = () => {
    for (const name of ['pushState', 'replaceState']) {
        const fn = history[name];
        history[name] = function () {
            const r = fn.apply(this, arguments);
            setTimeout(() => cleanLocation(true));
            return r;
        }
    }
    addEventListener('popstate', () => setTimeout(() => cleanLocation(true)));
}

const setupMutationObserver = () => {
    // Experimental
    const observerTarget = document.body || document.documentElement;
    if (observerTarget) new MutationObserver(mutationList => {
        for (const mutation of mutationList) {
            cleanLinksForDOM(mutation.target);
            mutation.addedNodes.forEach(cleanLinksForDOM);
        }
    }).observe(observerTarget, {
        attributes: true,
        attributeFilter: ['href'],
        // attributeOldValue: true,
        childList: true,
        subtree: true,
    });
}

const startAutoClean = () => cleanLocation().then(cleaned => {
    if (cleaned) return;

    setupHistoryHook();

    document.querySelectorAll('a').forEach(cleanLinkForDOM);

    setupMutationObserver();
});

// 处理fetch和XMLHttpRequest（使用xhook）
const startXhookIfEnabled = async () => {
    if (!await GM.getValue('xhookEnabled')) return;

    /** @type {String} */
    let xhookScript;
    if (await GM.getValue('xhookCacheBefore', 0) < Date.now() || !(xhookScript = await GM.getValue('xhookCached'))) {
        console.log('Link cleaner:', 'Fetching xhook from jsdelivr ...');
        await GM.setValue('xhookCached', (xhookScript = await fetch('https://cdn.jsdelivr.net/npm/xhook@1/dist/xhook.min.js').then(r => r.text())));
        await GM.setValue('xhookCacheBefore', Date.now() + 6048e5); // 86400 * 7 * 1000
    } else {
        console.log('Link cleaner:', 'Loading xhook from cache ...', 'Expire:', new Date(await GM.getValue('xhookCacheBefore')));
    }
    // Shamefully use eval to run code from string
    (0, unsafeWindow.eval)(xhookScript);
    console.log('Link cleaner:', 'xhook is loaded!');
    unsafeWindow.xhook.before(async (request, callback) => {
        let u = request.url;
        if (typeof u === 'string' && !URL.canParse(u)) {
            u = location.origin + (u.startsWith('/') ? '' : '/') + u;
            console.log(u);
        }
        const r = (await cleanLink(u)).toString();
        if (u.toString() !== r) {
            console.log('Link cleaner:', 'xhook', u.toString(), '->', (request.url = r));
        }
        callback();
    });
}

// 添加右键菜单
const registerMenus = async currentHostStatus => {
    const {hostname, mode, disabled, enabled, shouldClean} = currentHostStatus;

    GM.registerMenuCommand('手动输入链接进行清洗', async () => {
        if (window.top !== window.self) return;
        const url = prompt('请输入需要清洗的链接：');
        if (!url) return;
        try {
            const cleaned = await cleanLink(url);
            if (cleaned.toString() !== url) {
                confirm('链接已清洗，是否需要复制？\n' + cleaned) && GM.setClipboard(cleaned);
            } else {
                alert('链接无需清洗。');
            }
        } catch (err) {
            alert('链接清洗失败。\n' + err.stack);
        }
    });

    const isWhitelistMode = mode === HOST_CLEAN_MODE_WHITELIST;
    GM.registerMenuCommand(
        '网站清洗模式：' + (isWhitelistMode ? '白名单' : '黑名单'),
        async () => {
            const nextMode = isWhitelistMode ? HOST_CLEAN_MODE_BLACKLIST : HOST_CLEAN_MODE_WHITELIST;
            await setHostCleanMode(nextMode);
        }
    );

    if (hostname) {
        if (isWhitelistMode) {
            GM.registerMenuCommand((enabled ? '❌禁用当前网站清洗' : '✅启用当前网站清洗') + `（${hostname}）`, async () => {
                const enabled = await isCurrentHostEnabled();
                const succeeded = await setCurrentHostEnabled(!enabled);
                if (!succeeded) {
                    alert('当前页面不支持按网站设置清洗白名单');
                    return;
                }
            });
        } else {
            GM.registerMenuCommand((disabled ? '✅启用当前网站清洗' : '❌禁用当前网站清洗') + `（${hostname}）`, async () => {
                const disabled = await isCurrentHostDisabled();
                const succeeded = await setCurrentHostDisabled(!disabled);
                if (!succeeded) {
                    alert('当前页面不支持按网站禁用清洗');
                    return;
                }
            });
        }
    }

    if (shouldClean) {
        GM.registerMenuCommand('重新清洗网页上的所有链接', () => document.querySelectorAll('a').forEach(cleanLinkForDOM));
    }
    GM.registerMenuCommand('复制标题和网址', () => {
        if (window.top !== window.self) return;
        const text = `${document.title.trim()}\n${location.href}`;
        GM.setClipboard(text);
    });
    GM.registerMenuCommand('复制标题和网址（Markdown）', () => {
        if (window.top !== window.self) return;
        const text = `[${document.title.trim()}](${location.href})`;
        GM.setClipboard(text);
    });
    const xhookEnabled = await GM.getValue('xhookEnabled');
    GM.registerMenuCommand('增强清洗模式（xhr/fetch请求，切换后刷新生效）' + (xhookEnabled ? '✅' : '❌'), async () => GM.setValue('xhookEnabled', !xhookEnabled));
}

(async () => {
    const currentHostStatus = await getCurrentHostCleanStatus();

    if (!currentHostStatus.shouldClean) {
        console.log('Link cleaner:', 'Disabled on current host:', currentHostStatus.hostname, 'Mode:', currentHostStatus.mode);
    } else {
        cleanSpmAttributes();
        startAutoClean();
        startXhookIfEnabled().catch(err => console.warn('Link cleaner:', 'Failed to load xhook', err));
    }

    await registerMenus(currentHostStatus);
})()
