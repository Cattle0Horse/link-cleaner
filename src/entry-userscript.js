import './GM_fetch.js';
import cleanLink from './link-cleaner.js';

const HOST_CLEAN_MODE_KEY = 'hostCleanMode';
const HOST_CLEAN_MODE_BLACKLIST = 'blacklist';
const HOST_CLEAN_MODE_WHITELIST = 'whitelist';
const DISABLED_HOSTS_KEY = 'disabledHosts';
const ENABLED_HOSTS_KEY = 'enabledHosts';

const getCurrentHostname = () => location.hostname.toLowerCase();

const getHostCleanMode = async () => {
    const mode = await GM.getValue(HOST_CLEAN_MODE_KEY, HOST_CLEAN_MODE_WHITELIST);
    return mode === HOST_CLEAN_MODE_WHITELIST ? HOST_CLEAN_MODE_WHITELIST : HOST_CLEAN_MODE_BLACKLIST;
}

const setHostCleanMode = async mode => GM.setValue(
    HOST_CLEAN_MODE_KEY,
    mode === HOST_CLEAN_MODE_WHITELIST ? HOST_CLEAN_MODE_WHITELIST : HOST_CLEAN_MODE_BLACKLIST
);

const isCurrentHostInList = async key => {
    const hostname = getCurrentHostname();
    return !!hostname && (await GM.getValue(key, [])).includes(hostname);
}

const setCurrentHostInList = async (key, included) => {
    const hostname = getCurrentHostname();
    const hosts = await GM.getValue(key, []);
    const nextHosts = included
        ? [...new Set([...hosts, hostname])].sort()
        : hosts.filter(host => host !== hostname);
    await GM.setValue(key, nextHosts);
}

const getCurrentHostCleanStatus = async () => {
    const hostname = getCurrentHostname();
    const mode = await getHostCleanMode();

    if (!hostname) {
        return {hostname, mode, disabled: false, enabled: false, shouldClean: true};
    }

    if (mode === HOST_CLEAN_MODE_WHITELIST) {
        const enabled = await isCurrentHostInList(ENABLED_HOSTS_KEY);
        return {hostname, mode, disabled: false, enabled, shouldClean: enabled};
    }

    const disabled = await isCurrentHostInList(DISABLED_HOSTS_KEY);
    return {hostname, mode, disabled, enabled: false, shouldClean: !disabled};
}

// 处理<a>标签

const cleanedLinkTargets = new WeakMap;

const getAnchorForEvent = event => {
    if (typeof event.composedPath === 'function') {
        return event.composedPath().find(e => e instanceof HTMLAnchorElement);
    }
    return event.target instanceof Element ? event.target.closest('a') : null;
}

const setupCleanedLinkClickProtection = () => {
    const protect = event => {
        const link = getAnchorForEvent(event);
        const target = link && cleanedLinkTargets.get(link);
        if (!target) return;

        if (link.href !== target) link.href = target;
        event.stopImmediatePropagation();
    };

    addEventListener('click', protect, true);
    addEventListener('auxclick', protect, true);
}

/**
 * @param {HTMLAnchorElement} e
 */
const cleanLinkForDOM = e => {
    if (!(e instanceof HTMLAnchorElement) || !e.href) return;
    return cleanLink(e.href)
        .then(t => {
            const r = t.toString()
            if (e.href === r) return;
            cleanedLinkTargets.set(e, r);
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
    setupCleanedLinkClickProtection();

    document.querySelectorAll('a').forEach(cleanLinkForDOM);

    setupMutationObserver();
});

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
                const enabled = await isCurrentHostInList(ENABLED_HOSTS_KEY);
                await setCurrentHostInList(ENABLED_HOSTS_KEY, !enabled);
            });
        } else {
            GM.registerMenuCommand((disabled ? '✅启用当前网站清洗' : '❌禁用当前网站清洗') + `（${hostname}）`, async () => {
                const disabled = await isCurrentHostInList(DISABLED_HOSTS_KEY);
                await setCurrentHostInList(DISABLED_HOSTS_KEY, !disabled);
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
}

(async () => {
    const currentHostStatus = await getCurrentHostCleanStatus();

    if (!currentHostStatus.shouldClean) {
        console.log('Link cleaner:', 'Disabled on current host:', currentHostStatus.hostname, 'Mode:', currentHostStatus.mode);
    } else {
        cleanSpmAttributes();
        startAutoClean();
    }

    await registerMenus(currentHostStatus);
})()
